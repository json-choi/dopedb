//! Bounded read adapter for the retired expanded Analysis Article DTO.
//!
//! This module is intentionally private. It accepts only the already-normalized
//! manual shape emitted by the previous control plane and immediately projects
//! it into the current one-query definition. Retired behavior never reaches the
//! execution model and is never serialized again.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    AnalysisArticleConnection, AnalysisArticleDefinition, AnalysisArticleRecord,
    AnalysisArticleSource, AnalysisArticleVersionPayload, AnalysisColumn, AnalysisQueryNode,
};

#[derive(Deserialize)]
#[serde(untagged)]
enum DefinitionWire {
    Current(CurrentDefinition),
    Legacy(Box<LegacyExpandedDefinition>),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CurrentDefinition {
    version: u32,
    source: AnalysisArticleSource,
    title: String,
    html: String,
    query: AnalysisQueryNode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyExpandedDefinition {
    version: u32,
    source: AnalysisArticleSource,
    title: String,
    html: String,
    question: String,
    summary: String,
    timezone: String,
    parameters: Vec<Value>,
    queries: Vec<LegacyAnalysisQueryNode>,
    transforms: Vec<Value>,
    metrics: Vec<Value>,
    blocks: Vec<LegacyQueryResultBlock>,
    claims: Vec<Value>,
    refresh: LegacyRefreshPolicy,
    warnings: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyQueryResultBlock {
    id: String,
    kind: String,
    title: String,
    source_node_id: Value,
    width: u8,
    config: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyRefreshPolicy {
    mode: String,
    cron: Value,
    timezone: String,
    runner_id: Value,
    max_staleness_seconds: u64,
    result_retention_days: u16,
    share_reviewed_results: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyAnalysisQueryNode {
    id: String,
    title: String,
    connection_role: String,
    sql: String,
    parameter_ids: Vec<String>,
    max_rows: u64,
    max_bytes: usize,
    cache_ttl_seconds: u64,
    columns: Vec<AnalysisColumn>,
}

impl TryFrom<LegacyAnalysisQueryNode> for AnalysisQueryNode {
    type Error = &'static str;

    fn try_from(legacy: LegacyAnalysisQueryNode) -> Result<Self, Self::Error> {
        if !legacy.parameter_ids.is_empty() || legacy.cache_ttl_seconds != 0 {
            return Err(
                "parameterized or cached retired Analysis queries require manual migration",
            );
        }
        Ok(Self {
            id: legacy.id,
            title: legacy.title,
            connection_role: legacy.connection_role,
            sql: legacy.sql,
            max_rows: legacy.max_rows,
            max_bytes: legacy.max_bytes,
            columns: legacy.columns,
        })
    }
}

pub(crate) fn deserialize_definition<'de, D>(
    deserializer: D,
) -> Result<AnalysisArticleDefinition, D::Error>
where
    D: Deserializer<'de>,
{
    match DefinitionWire::deserialize(deserializer)? {
        DefinitionWire::Current(current) => {
            if current.version != 3 {
                return Err(serde::de::Error::custom(
                    "unsupported current Analysis Article version",
                ));
            }
            Ok(AnalysisArticleDefinition {
                version: current.version,
                source: current.source,
                title: current.title,
                html: current.html,
                query: current.query,
            })
        }
        DefinitionWire::Legacy(legacy) => (*legacy).try_into().map_err(serde::de::Error::custom),
    }
}

impl TryFrom<LegacyExpandedDefinition> for AnalysisArticleDefinition {
    type Error = &'static str;

    fn try_from(mut legacy: LegacyExpandedDefinition) -> Result<Self, Self::Error> {
        if legacy.version != 2
            || !legacy.question.is_empty()
            || !legacy.summary.is_empty()
            || legacy.timezone != "UTC"
            || !legacy.parameters.is_empty()
            || legacy.queries.len() != 1
            || !legacy.transforms.is_empty()
            || !legacy.metrics.is_empty()
            || legacy.blocks.len() != 1
            || !legacy.claims.is_empty()
            || !legacy.warnings.is_empty()
            || legacy.refresh.mode != "manual"
            || !legacy.refresh.cron.is_null()
            || legacy.refresh.timezone != "UTC"
            || !legacy.refresh.runner_id.is_null()
            || legacy.refresh.max_staleness_seconds == 0
            || legacy.refresh.result_retention_days == 0
            || legacy.refresh.share_reviewed_results
        {
            return Err("retired Analysis Article definition is not a normalized manual article");
        }
        let legacy_query = legacy.queries.pop().expect("length checked");
        let block = legacy.blocks.pop().expect("length checked");
        let source_node_id = block.source_node_id.as_str();
        if block.id != "query_result"
            || block.kind != "table"
            || block.title.trim().is_empty()
            || source_node_id != Some(legacy_query.id.as_str())
            || block.width != 12
            || !block.config.is_object()
        {
            return Err("retired Analysis Article result block is invalid");
        }
        let query = legacy_query.try_into()?;
        Ok(AnalysisArticleDefinition {
            version: 3,
            source: legacy.source,
            title: legacy.title,
            html: legacy.html,
            query,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RetiredArticleState {
    Draft,
    Review,
    Live,
    Archived,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum VersionPayloadWire {
    Current(CurrentVersionPayload),
    Retired(RetiredVersionPayload),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CurrentVersionPayload {
    id: Uuid,
    project_environment_id: Uuid,
    environment_revision: i64,
    source_knowledge_grant_id: Option<Uuid>,
    graph_revision_ids: Vec<Uuid>,
    connections: Vec<AnalysisArticleConnection>,
    definition: AnalysisArticleDefinition,
    owner_member_id: String,
    deleted: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RetiredVersionPayload {
    id: Uuid,
    project_environment_id: Uuid,
    environment_revision: i64,
    source_knowledge_grant_id: Option<Uuid>,
    graph_revision_ids: Vec<Uuid>,
    connections: Vec<AnalysisArticleConnection>,
    definition: AnalysisArticleDefinition,
    #[serde(rename = "state")]
    _state: RetiredArticleState,
    owner_member_id: String,
    deleted: bool,
}

impl From<CurrentVersionPayload> for AnalysisArticleVersionPayload {
    fn from(value: CurrentVersionPayload) -> Self {
        Self {
            id: value.id,
            project_environment_id: value.project_environment_id,
            environment_revision: value.environment_revision,
            source_knowledge_grant_id: value.source_knowledge_grant_id,
            graph_revision_ids: value.graph_revision_ids,
            connections: value.connections,
            definition: value.definition,
            owner_member_id: value.owner_member_id,
            deleted: value.deleted,
        }
    }
}

impl From<RetiredVersionPayload> for AnalysisArticleVersionPayload {
    fn from(value: RetiredVersionPayload) -> Self {
        let RetiredVersionPayload {
            id,
            project_environment_id,
            environment_revision,
            source_knowledge_grant_id,
            graph_revision_ids,
            connections,
            definition,
            _state: _,
            owner_member_id,
            deleted,
        } = value;
        Self {
            id,
            project_environment_id,
            environment_revision,
            source_knowledge_grant_id,
            graph_revision_ids,
            connections,
            definition,
            owner_member_id,
            deleted,
        }
    }
}

pub(crate) fn deserialize_version_payload<'de, D>(
    deserializer: D,
) -> Result<AnalysisArticleVersionPayload, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(match VersionPayloadWire::deserialize(deserializer)? {
        VersionPayloadWire::Current(value) => value.into(),
        VersionPayloadWire::Retired(value) => value.into(),
    })
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ArticleRecordWire {
    Current(CurrentArticleRecord),
    Retired(RetiredArticleRecord),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CurrentArticleRecord {
    id: Uuid,
    project_environment_id: Uuid,
    environment_revision: i64,
    source_knowledge_grant_id: Option<Uuid>,
    graph_revision_ids: Vec<Uuid>,
    connections: Vec<AnalysisArticleConnection>,
    definition: AnalysisArticleDefinition,
    owner_member_id: String,
    updated_by_member_id: String,
    revision: i64,
    latest_successful_run_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RetiredArticleRecord {
    id: Uuid,
    project_environment_id: Uuid,
    environment_revision: i64,
    source_knowledge_grant_id: Option<Uuid>,
    graph_revision_ids: Vec<Uuid>,
    connections: Vec<AnalysisArticleConnection>,
    definition: AnalysisArticleDefinition,
    #[serde(rename = "state")]
    _state: RetiredArticleState,
    owner_member_id: String,
    updated_by_member_id: String,
    revision: i64,
    live_revision: Option<i64>,
    #[serde(rename = "liveRunId")]
    _live_run_id: Option<Uuid>,
    latest_successful_run_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<CurrentArticleRecord> for AnalysisArticleRecord {
    fn from(value: CurrentArticleRecord) -> Self {
        Self {
            id: value.id,
            project_environment_id: value.project_environment_id,
            environment_revision: value.environment_revision,
            source_knowledge_grant_id: value.source_knowledge_grant_id,
            graph_revision_ids: value.graph_revision_ids,
            connections: value.connections,
            definition: value.definition,
            owner_member_id: value.owner_member_id,
            updated_by_member_id: value.updated_by_member_id,
            revision: value.revision,
            latest_successful_run_id: value.latest_successful_run_id,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl TryFrom<RetiredArticleRecord> for AnalysisArticleRecord {
    type Error = &'static str;

    fn try_from(value: RetiredArticleRecord) -> Result<Self, Self::Error> {
        if value
            .live_revision
            .is_some_and(|revision| revision < 1 || revision > value.revision)
        {
            return Err("retired Analysis Article revision markers are invalid");
        }
        let RetiredArticleRecord {
            id,
            project_environment_id,
            environment_revision,
            source_knowledge_grant_id,
            graph_revision_ids,
            connections,
            definition,
            _state: _,
            owner_member_id,
            updated_by_member_id,
            revision,
            live_revision: _,
            _live_run_id: _,
            latest_successful_run_id,
            created_at,
            updated_at,
        } = value;
        Ok(Self {
            id,
            project_environment_id,
            environment_revision,
            source_knowledge_grant_id,
            graph_revision_ids,
            connections,
            definition,
            owner_member_id,
            updated_by_member_id,
            revision,
            latest_successful_run_id,
            created_at,
            updated_at,
        })
    }
}

pub(crate) fn deserialize_record<'de, D>(deserializer: D) -> Result<AnalysisArticleRecord, D::Error>
where
    D: Deserializer<'de>,
{
    match ArticleRecordWire::deserialize(deserializer)? {
        ArticleRecordWire::Current(value) => Ok(value.into()),
        ArticleRecordWire::Retired(value) => value.try_into().map_err(serde::de::Error::custom),
    }
}
