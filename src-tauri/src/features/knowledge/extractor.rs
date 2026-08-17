//! Bounded deterministic code extraction for immutable Knowledge revisions.
//!
//! This is deliberately structural: no provider API, model, prompt, or inferred
//! semantic edge participates. Unsupported files remain visible in build health
//! as skipped input, while a parser error rejects the candidate before activation.

use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;
use dopedb_protocol::{
    GraphBuildArtifactV1, GraphBuildHealthV1, GraphExtractorIdentityV1, KnowledgeEdgeV1,
    KnowledgeEvidenceState, KnowledgeEvidenceV1, KnowledgeNodeKind, KnowledgeNodeV1,
    KnowledgeRelation, GRAPH_BUILD_ARTIFACT_SCHEMA_VERSION,
};
use sha2::{Digest, Sha256};
use sqlparser::{
    ast::{FromTable, Query, SetExpr, Statement, TableFactor, TableWithJoins},
    dialect::GenericDialect,
    parser::Parser as SqlParser,
};
use tree_sitter::{Language, Node, Parser as TreeParser};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::domain::{sync_cancelled, SourceSnapshot, SyncCancellation};
use super::ports::LocalKnowledgeSourcePort;

const EXTRACTOR_ID: &str = "dopedb.structural-code";
const EXTRACTOR_VERSION: &str = "1.0.0";
const MAX_PARSED_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
enum SupportedLanguage {
    TypeScript,
    Tsx,
    Rust,
}

impl SupportedLanguage {
    fn for_path(path: &str) -> Option<Self> {
        if path.ends_with(".tsx") {
            Some(Self::Tsx)
        } else if path.ends_with(".ts") || path.ends_with(".js") || path.ends_with(".jsx") {
            Some(Self::TypeScript)
        } else if path.ends_with(".rs") {
            Some(Self::Rust)
        } else {
            None
        }
    }

    fn parser(self) -> Language {
        match self {
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Tsx => "tsx",
            Self::Rust => "rust",
        }
    }
}

#[derive(Debug, Clone)]
struct PendingEdge {
    from: String,
    to: String,
    relation: KnowledgeRelation,
    file_path: String,
    line_start: u32,
    line_end: u32,
}

struct Extraction {
    nodes: BTreeMap<String, KnowledgeNodeV1>,
    edges: Vec<PendingEdge>,
}

impl Extraction {
    fn new() -> Self {
        Self {
            nodes: BTreeMap::new(),
            edges: Vec::new(),
        }
    }

    fn node(
        &mut self,
        source_revision: &str,
        kind: KnowledgeNodeKind,
        name: &str,
        qualified_name: &str,
        language: &str,
    ) -> AppResult<String> {
        let name = safe_text(name)?;
        let qualified_name = safe_text(qualified_name)?;
        let id = hash(&format!(
            "node\0{source_revision}\0{kind:?}\0{qualified_name}"
        ));
        self.nodes
            .entry(id.clone())
            .or_insert_with(|| KnowledgeNodeV1 {
                id: id.clone(),
                kind,
                name,
                qualified_name,
                attributes: BTreeMap::from([("language".into(), language.into())]),
            });
        Ok(id)
    }

    fn edge(
        &mut self,
        from: String,
        to: String,
        relation: KnowledgeRelation,
        file_path: &str,
        node: Node<'_>,
    ) {
        self.edges.push(PendingEdge {
            from,
            to,
            relation,
            file_path: file_path.to_owned(),
            line_start: node.start_position().row.saturating_add(1) as u32,
            line_end: node.end_position().row.saturating_add(1) as u32,
        });
    }
}

pub(crate) async fn build_graph<A: LocalKnowledgeSourcePort>(
    adapter: &A,
    snapshot: &SourceSnapshot,
    parent_graph_revision_id: Option<Uuid>,
    previous: Option<&GraphBuildArtifactV1>,
    cancellation: &SyncCancellation,
) -> AppResult<GraphBuildArtifactV1> {
    if !snapshot.binding.validate() || snapshot.environment_revision == 0 {
        return Err(AppError::Blocked {
            reason: "the Knowledge source snapshot is invalid".into(),
        });
    }
    let generated_at = Utc::now();
    let mut extraction = Extraction::new();
    let mut parsed_files = 0_u64;
    let mut skipped_files = 0_u64;
    let changed = snapshot
        .changed_files
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let incremental = previous.is_some()
        && !changed.is_empty()
        && changed.len() < snapshot.files.len()
        && previous.is_some_and(|artifact| {
            artifact.binding.source_id == snapshot.binding.source_id
                && artifact.binding.project_environment_id
                    == snapshot.binding.project_environment_id
        });
    if incremental {
        seed_unchanged_graph(
            &mut extraction,
            previous.expect("incremental graph has a previous revision"),
            &changed,
        )?;
    }
    for file in &snapshot.files {
        if cancellation.is_cancelled() {
            return Err(sync_cancelled());
        }
        if incremental && !changed.contains(&file.path) {
            continue;
        }
        let Some(language) = SupportedLanguage::for_path(&file.path) else {
            skipped_files += 1;
            continue;
        };
        if file.bytes > MAX_PARSED_FILE_BYTES {
            skipped_files += 1;
            continue;
        }
        let bytes = adapter
            .read_file_at_revision(&snapshot.binding, &snapshot.binding.revision, &file.path)
            .await?;
        let content_hash = hash_bytes(&bytes);
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) != file.bytes
            || content_hash != file.content_hash
        {
            return Err(AppError::Blocked {
                reason: "a Knowledge source file changed inside its pinned revision".into(),
            });
        }
        extract_file(
            &mut extraction,
            &snapshot.binding.source_id.to_string(),
            &file.path,
            &bytes,
            language,
        )?;
        parsed_files += 1;
    }
    let mut evidence = Vec::with_capacity(extraction.edges.len());
    let mut edges = Vec::with_capacity(extraction.edges.len());
    let mut seen_edges = BTreeSet::new();
    for candidate in extraction.edges {
        let evidence_id = hash(&format!(
            "evidence\0{}\0{}\0{}\0{}\0{:?}\0{}\0{}",
            snapshot.source_revision_sha256,
            candidate.file_path,
            candidate.line_start,
            candidate.line_end,
            candidate.relation,
            candidate.from,
            candidate.to,
        ));
        let edge_id = hash(&format!(
            "edge\0{}\0{}\0{:?}\0{evidence_id}",
            candidate.from, candidate.to, candidate.relation
        ));
        if !seen_edges.insert(edge_id.clone()) {
            continue;
        }
        evidence.push(KnowledgeEvidenceV1 {
            id: evidence_id.clone(),
            source_id: snapshot.binding.source_id,
            source_revision_sha256: snapshot.source_revision_sha256.clone(),
            file_path: candidate.file_path,
            line_start: candidate.line_start,
            line_end: candidate.line_end,
            extraction_method: "tree_sitter".into(),
            observed_at: generated_at,
        });
        edges.push(KnowledgeEdgeV1 {
            id: edge_id,
            from: candidate.from,
            to: candidate.to,
            relation: candidate.relation,
            state: KnowledgeEvidenceState::Extracted,
            evidence_ids: vec![evidence_id],
        });
    }
    let mut nodes = extraction.nodes.into_values().collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    evidence.sort_by(|left, right| left.id.cmp(&right.id));
    let identity = serde_json::to_vec(&(
        snapshot.environment_revision,
        &snapshot.binding,
        &snapshot.source_revision_sha256,
        parent_graph_revision_id,
        &nodes,
        &edges,
    ))?;
    let artifact = GraphBuildArtifactV1 {
        schema_version: GRAPH_BUILD_ARTIFACT_SCHEMA_VERSION,
        graph_revision_id: uuid_from_hash(&hash_bytes(&identity)),
        environment_revision: snapshot.environment_revision,
        binding: snapshot.binding.clone(),
        source_revision_sha256: snapshot.source_revision_sha256.clone(),
        parent_graph_revision_id,
        extractor: GraphExtractorIdentityV1 {
            id: EXTRACTOR_ID.into(),
            version: EXTRACTOR_VERSION.into(),
            source_sha256: hash_bytes(include_bytes!("extractor.rs")),
        },
        generated_at,
        health: GraphBuildHealthV1 {
            complete: true,
            parsed_files,
            skipped_files,
            failed_files: 0,
        },
        changed_files: snapshot.changed_files.clone(),
        nodes,
        edges,
        evidence,
    };
    if !artifact.validate() {
        return Err(AppError::Blocked {
            reason: "the deterministic Knowledge graph failed its health gate".into(),
        });
    }
    Ok(artifact)
}

fn seed_unchanged_graph(
    extraction: &mut Extraction,
    previous: &GraphBuildArtifactV1,
    changed: &BTreeSet<String>,
) -> AppResult<()> {
    for node in &previous.nodes {
        let belongs_to_changed_file = changed.iter().any(|path| {
            node.qualified_name == *path
                || node
                    .qualified_name
                    .strip_prefix(path)
                    .is_some_and(|suffix| suffix.starts_with('#'))
        });
        if !belongs_to_changed_file {
            extraction.nodes.insert(node.id.clone(), node.clone());
        }
    }
    let evidence_by_id = previous
        .evidence
        .iter()
        .map(|evidence| (evidence.id.as_str(), evidence))
        .collect::<BTreeMap<_, _>>();
    for edge in &previous.edges {
        for evidence_id in &edge.evidence_ids {
            let evidence = evidence_by_id.get(evidence_id.as_str()).ok_or_else(|| {
                AppError::Config("the previous Knowledge graph lost evidence".into())
            })?;
            if changed.contains(&evidence.file_path) {
                continue;
            }
            if extraction.nodes.contains_key(&edge.from) && extraction.nodes.contains_key(&edge.to)
            {
                extraction.edges.push(PendingEdge {
                    from: edge.from.clone(),
                    to: edge.to.clone(),
                    relation: edge.relation,
                    file_path: evidence.file_path.clone(),
                    line_start: evidence.line_start,
                    line_end: evidence.line_end,
                });
            }
        }
    }
    Ok(())
}

fn extract_file(
    extraction: &mut Extraction,
    source_revision: &str,
    path: &str,
    source: &[u8],
    language: SupportedLanguage,
) -> AppResult<()> {
    let mut parser = TreeParser::new();
    parser
        .set_language(&language.parser())
        .map_err(|_| AppError::Config("the bundled Knowledge parser is unavailable".into()))?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| AppError::Config("the bundled Knowledge parser stopped".into()))?;
    if tree.root_node().has_error() {
        return Err(AppError::Blocked {
            reason: format!("Knowledge parsing failed for {path}"),
        });
    }
    let file_id = extraction.node(
        source_revision,
        KnowledgeNodeKind::File,
        path.rsplit('/').next().unwrap_or(path),
        path,
        language.label(),
    )?;
    walk(
        extraction,
        source_revision,
        path,
        source,
        language,
        tree.root_node(),
        &file_id,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn walk(
    extraction: &mut Extraction,
    source_revision: &str,
    path: &str,
    source: &[u8],
    language: SupportedLanguage,
    node: Node<'_>,
    file_id: &str,
    owner_id: Option<&str>,
) -> AppResult<()> {
    let definition_kind = definition_kind(language, node.kind());
    let mut next_owner = owner_id.map(ToOwned::to_owned);
    if let Some(kind) = definition_kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(name_node, source)?;
            if !name.is_empty() {
                let qualified = format!("{path}#{name}");
                let id =
                    extraction.node(source_revision, kind, &name, &qualified, language.label())?;
                extraction.edge(
                    owner_id.unwrap_or(file_id).to_owned(),
                    id.clone(),
                    KnowledgeRelation::Defines,
                    path,
                    node,
                );
                next_owner = Some(id);
            }
        }
    } else if import_kind(language, node.kind()) {
        let target = import_target(node, source)?;
        if !target.is_empty() {
            let id = extraction.node(
                source_revision,
                KnowledgeNodeKind::Module,
                &target,
                &format!("module:{target}"),
                language.label(),
            )?;
            extraction.edge(
                owner_id.unwrap_or(file_id).to_owned(),
                id,
                KnowledgeRelation::Imports,
                path,
                node,
            );
        }
    } else if node.kind() == "call_expression" {
        if let Some(function) = node.child_by_field_name("function") {
            let target = node_text(function, source)?;
            if valid_symbol(&target) {
                extract_named_call(
                    extraction,
                    source_revision,
                    path,
                    source,
                    language,
                    node,
                    owner_id.unwrap_or(file_id),
                    &target,
                )?;
                let id = extraction.node(
                    source_revision,
                    KnowledgeNodeKind::Function,
                    &target,
                    &format!("call:{target}"),
                    language.label(),
                )?;
                extraction.edge(
                    owner_id.unwrap_or(file_id).to_owned(),
                    id,
                    KnowledgeRelation::Calls,
                    path,
                    node,
                );
            }
        }
    }
    if string_literal_kind(language, node.kind()) {
        extract_sql_literal(
            extraction,
            source_revision,
            path,
            source,
            language,
            node,
            owner_id.unwrap_or(file_id),
        )?;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk(
            extraction,
            source_revision,
            path,
            source,
            language,
            child,
            file_id,
            next_owner.as_deref(),
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn extract_named_call(
    extraction: &mut Extraction,
    source_revision: &str,
    path: &str,
    source: &[u8],
    language: SupportedLanguage,
    call: Node<'_>,
    owner_id: &str,
    target: &str,
) -> AppResult<()> {
    let Some(argument) = first_call_argument(call) else {
        return Ok(());
    };
    let Some(value) = literal_text(argument, source)? else {
        return Ok(());
    };
    let method = target.rsplit(['.', ':']).next().unwrap_or(target);
    if matches!(method, "get" | "post" | "put" | "patch" | "delete") && value.starts_with('/') {
        let label = format!("{} {value}", method.to_ascii_uppercase());
        let route_id = extraction.node(
            source_revision,
            KnowledgeNodeKind::Route,
            &label,
            &format!("route:{label}"),
            language.label(),
        )?;
        extraction.edge(
            owner_id.to_owned(),
            route_id,
            KnowledgeRelation::HandlesRoute,
            path,
            call,
        );
    }
    if matches!(method, "track" | "emit" | "publish" | "capture") && valid_event_name(&value) {
        let event_id = extraction.node(
            source_revision,
            KnowledgeNodeKind::Event,
            &value,
            &format!("event:{value}"),
            language.label(),
        )?;
        extraction.edge(
            owner_id.to_owned(),
            event_id,
            KnowledgeRelation::EmitsEvent,
            path,
            call,
        );
    }
    Ok(())
}

fn first_call_argument(call: Node<'_>) -> Option<Node<'_>> {
    call.child_by_field_name("arguments")?.named_child(0)
}

fn string_literal_kind(language: SupportedLanguage, kind: &str) -> bool {
    match language {
        SupportedLanguage::TypeScript | SupportedLanguage::Tsx => {
            matches!(kind, "string" | "template_string")
        }
        SupportedLanguage::Rust => matches!(kind, "string_literal" | "raw_string_literal"),
    }
}

fn literal_text(node: Node<'_>, source: &[u8]) -> AppResult<Option<String>> {
    let raw = node_text(node, source)?;
    if raw.len() < 2 || raw.len() > MAX_PARSED_FILE_BYTES as usize {
        return Ok(None);
    }
    let unquoted = if (raw.starts_with('"') && raw.ends_with('"'))
        || (raw.starts_with('\'') && raw.ends_with('\''))
        || (raw.starts_with('`') && raw.ends_with('`') && !raw.contains("${"))
    {
        &raw[1..raw.len() - 1]
    } else if raw.starts_with('r') {
        let Some(start) = raw.find('"') else {
            return Ok(None);
        };
        let Some(end) = raw.rfind('"') else {
            return Ok(None);
        };
        if start >= end {
            return Ok(None);
        }
        &raw[start + 1..end]
    } else {
        return Ok(None);
    };
    if unquoted.is_empty() || unquoted.chars().any(|character| character == '\0') {
        return Ok(None);
    }
    Ok(Some(unquoted.to_owned()))
}

fn valid_event_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .chars()
            .all(|character| character.is_alphanumeric() || "_.:-/ ".contains(character))
}

#[allow(clippy::too_many_arguments)]
fn extract_sql_literal(
    extraction: &mut Extraction,
    source_revision: &str,
    path: &str,
    source: &[u8],
    language: SupportedLanguage,
    literal: Node<'_>,
    owner_id: &str,
) -> AppResult<()> {
    let Some(sql) = literal_text(literal, source)? else {
        return Ok(());
    };
    let Ok(statements) = SqlParser::parse_sql(&GenericDialect {}, &sql) else {
        return Ok(());
    };
    for statement in statements {
        extract_sql_statement(
            extraction,
            source_revision,
            path,
            language,
            literal,
            owner_id,
            &statement,
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn extract_sql_statement(
    extraction: &mut Extraction,
    source_revision: &str,
    path: &str,
    language: SupportedLanguage,
    literal: Node<'_>,
    owner_id: &str,
    statement: &Statement,
) -> AppResult<()> {
    let mut reads = Vec::new();
    let mut writes = Vec::new();
    match statement {
        Statement::Query(query) => collect_query_tables(query, &mut reads),
        Statement::Insert(insert) => {
            writes.push(insert.table.to_string());
            if let Some(query) = &insert.source {
                collect_query_tables(query, &mut reads);
            }
        }
        Statement::Update(update) => collect_table_with_joins(&update.table, &mut writes),
        Statement::Delete(delete) => match &delete.from {
            FromTable::WithFromKeyword(tables) | FromTable::WithoutKeyword(tables) => {
                for table in tables {
                    collect_table_with_joins(table, &mut writes);
                }
            }
        },
        Statement::CreateTable(create) => {
            let migration_name = format!("{}:{}", path, literal.start_position().row + 1);
            let migration_id = extraction.node(
                source_revision,
                KnowledgeNodeKind::Migration,
                &migration_name,
                &format!("migration:{migration_name}"),
                language.label(),
            )?;
            extraction.edge(
                owner_id.to_owned(),
                migration_id.clone(),
                KnowledgeRelation::Defines,
                path,
                literal,
            );
            let table_name = create.name.to_string();
            let table_id = table_node(extraction, source_revision, language, &table_name)?;
            extraction.edge(
                migration_id.clone(),
                table_id,
                KnowledgeRelation::MigrationDefinesTable,
                path,
                literal,
            );
            for column in &create.columns {
                let column_name = column.name.to_string();
                let column_id = extraction.node(
                    source_revision,
                    KnowledgeNodeKind::Column,
                    &column_name,
                    &format!("column:{table_name}.{column_name}"),
                    language.label(),
                )?;
                extraction.edge(
                    migration_id.clone(),
                    column_id,
                    KnowledgeRelation::MigrationDefinesColumn,
                    path,
                    literal,
                );
            }
        }
        _ => {}
    }
    reads.sort();
    reads.dedup();
    writes.sort();
    writes.dedup();
    for table in reads {
        let table_id = table_node(extraction, source_revision, language, &table)?;
        extraction.edge(
            owner_id.to_owned(),
            table_id,
            KnowledgeRelation::ReadsTable,
            path,
            literal,
        );
    }
    for table in writes {
        let table_id = table_node(extraction, source_revision, language, &table)?;
        extraction.edge(
            owner_id.to_owned(),
            table_id,
            KnowledgeRelation::WritesTable,
            path,
            literal,
        );
    }
    Ok(())
}

fn table_node(
    extraction: &mut Extraction,
    source_revision: &str,
    language: SupportedLanguage,
    table: &str,
) -> AppResult<String> {
    extraction.node(
        source_revision,
        KnowledgeNodeKind::Table,
        table,
        &format!("table:{table}"),
        language.label(),
    )
}

fn collect_query_tables(query: &Query, tables: &mut Vec<String>) {
    if let Some(with) = &query.with {
        for cte in &with.cte_tables {
            collect_query_tables(&cte.query, tables);
        }
    }
    collect_set_expression_tables(&query.body, tables);
}

fn collect_set_expression_tables(expression: &SetExpr, tables: &mut Vec<String>) {
    match expression {
        SetExpr::Select(select) => {
            for table in &select.from {
                collect_table_with_joins(table, tables);
            }
        }
        SetExpr::Query(query) => collect_query_tables(query, tables),
        SetExpr::SetOperation { left, right, .. } => {
            collect_set_expression_tables(left, tables);
            collect_set_expression_tables(right, tables);
        }
        SetExpr::Insert(statement) | SetExpr::Update(statement) => {
            extract_nested_statement_tables(statement, tables)
        }
        _ => {}
    }
}

fn extract_nested_statement_tables(statement: &Statement, tables: &mut Vec<String>) {
    match statement {
        Statement::Query(query) => collect_query_tables(query, tables),
        Statement::Insert(insert) => {
            if let Some(query) = &insert.source {
                collect_query_tables(query, tables);
            }
        }
        Statement::Update(update) => collect_table_with_joins(&update.table, tables),
        _ => {}
    }
}

fn collect_table_with_joins(table: &TableWithJoins, tables: &mut Vec<String>) {
    collect_table_factor(&table.relation, tables);
    for join in &table.joins {
        collect_table_factor(&join.relation, tables);
    }
}

fn collect_table_factor(table: &TableFactor, tables: &mut Vec<String>) {
    match table {
        TableFactor::Table { name, .. } => tables.push(name.to_string()),
        TableFactor::Derived { subquery, .. } => collect_query_tables(subquery, tables),
        _ => {}
    }
}

fn definition_kind(language: SupportedLanguage, kind: &str) -> Option<KnowledgeNodeKind> {
    match language {
        SupportedLanguage::TypeScript | SupportedLanguage::Tsx => match kind {
            "function_declaration" | "method_definition" => Some(KnowledgeNodeKind::Function),
            "class_declaration"
            | "interface_declaration"
            | "type_alias_declaration"
            | "enum_declaration" => Some(KnowledgeNodeKind::Type),
            _ => None,
        },
        SupportedLanguage::Rust => match kind {
            "function_item" => Some(KnowledgeNodeKind::Function),
            "struct_item" | "enum_item" | "trait_item" | "type_item" => {
                Some(KnowledgeNodeKind::Type)
            }
            "mod_item" => Some(KnowledgeNodeKind::Module),
            _ => None,
        },
    }
}

fn import_kind(language: SupportedLanguage, kind: &str) -> bool {
    match language {
        SupportedLanguage::TypeScript | SupportedLanguage::Tsx => kind == "import_statement",
        SupportedLanguage::Rust => kind == "use_declaration",
    }
}

fn import_target(node: Node<'_>, source: &[u8]) -> AppResult<String> {
    if let Some(target) = node.child_by_field_name("source") {
        return Ok(node_text(target, source)?
            .trim_matches(|character| character == '\'' || character == '"')
            .to_owned());
    }
    Ok(node_text(node, source)?
        .trim_start_matches("use")
        .trim()
        .trim_end_matches(';')
        .to_owned())
}

fn node_text(node: Node<'_>, source: &[u8]) -> AppResult<String> {
    let bytes = source
        .get(node.byte_range())
        .ok_or_else(|| AppError::Blocked {
            reason: "the Knowledge parser returned an invalid source range".into(),
        })?;
    let value = std::str::from_utf8(bytes)
        .map_err(|_| AppError::Config("Knowledge source text must be UTF-8".into()))?;
    Ok(value.trim().to_owned())
}

fn valid_symbol(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .chars()
            .all(|character| character.is_alphanumeric() || "_.$:?<>".contains(character))
}

fn safe_text(value: &str) -> AppResult<String> {
    if value.is_empty() || value.len() > 16 * 1024 || value.chars().any(char::is_control) {
        return Err(AppError::Blocked {
            reason: "Knowledge extraction produced an unsafe identifier".into(),
        });
    }
    Ok(value.to_owned())
}

fn hash(value: &str) -> String {
    hash_bytes(value.as_bytes())
}

fn hash_bytes(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn uuid_from_hash(hash: &str) -> Uuid {
    let mut bytes = [0_u8; 16];
    hex::decode_to_slice(&hash[..32], &mut bytes).expect("SHA-256 UUID bytes");
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

#[cfg(test)]
pub(crate) fn assert_extractor_contract() {
    let source = br#"
      import { query } from "./db";
      export function loadUsers() {
        analytics.track("users_loaded");
        return query("select * from users");
      }
      router.get("/users", loadUsers);
      migrate("create table accounts (id bigint, email text)");
    "#;
    let mut first = Extraction::new();
    extract_file(
        &mut first,
        &"a".repeat(64),
        "src/users.ts",
        source,
        SupportedLanguage::TypeScript,
    )
    .unwrap();
    let mut second = Extraction::new();
    extract_file(
        &mut second,
        &"a".repeat(64),
        "src/users.ts",
        source,
        SupportedLanguage::TypeScript,
    )
    .unwrap();
    assert_eq!(first.nodes, second.nodes);
    assert_eq!(first.edges.len(), second.edges.len());
    assert!(first
        .edges
        .iter()
        .any(|edge| edge.relation == KnowledgeRelation::Defines));
    assert!(first
        .edges
        .iter()
        .any(|edge| edge.relation == KnowledgeRelation::Imports));
    assert!(first
        .edges
        .iter()
        .any(|edge| edge.relation == KnowledgeRelation::Calls));
    assert!(first
        .edges
        .iter()
        .any(|edge| edge.relation == KnowledgeRelation::HandlesRoute));
    assert!(first
        .edges
        .iter()
        .any(|edge| edge.relation == KnowledgeRelation::ReadsTable));
    assert!(first
        .edges
        .iter()
        .any(|edge| edge.relation == KnowledgeRelation::EmitsEvent));
    assert!(first
        .edges
        .iter()
        .any(|edge| edge.relation == KnowledgeRelation::MigrationDefinesTable));
    assert!(first
        .edges
        .iter()
        .any(|edge| edge.relation == KnowledgeRelation::MigrationDefinesColumn));
}
