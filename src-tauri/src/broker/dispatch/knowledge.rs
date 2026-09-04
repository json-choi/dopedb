//! Project Knowledge tools scoped to one immutable ACP resource revision set.

use std::collections::BTreeSet;

use dopedb_protocol::{
    CatalogArguments, ConnectionSelector, EnvironmentConnectionScope, EnvironmentContextCommand,
    EnvironmentContextResult, EnvironmentRevisionScope, EnvironmentSourceScope,
    FunnelTraceArguments, FunnelTraceCommand, GraphBuildArtifactV1, KnowledgeDiffCommand,
    KnowledgeEvidenceCommand, KnowledgeEvidenceResult, KnowledgeExplainCommand,
    KnowledgeMappingProposalResult, KnowledgeMappingProposeArguments,
    KnowledgeMappingProposeCommand, KnowledgeMappingTargetKind, KnowledgeNeighborDirection,
    KnowledgeNeighborsArguments, KnowledgeNeighborsCommand, KnowledgeNodeArguments,
    KnowledgeNodeMatch, KnowledgePathCommand, KnowledgeSearchCommand, KnowledgeSearchResult,
    KnowledgeSubgraphResult, SourceFileMatch, SourceReadCommand, SourceSearchCommand,
    SourceSearchResult, MAX_KNOWLEDGE_EVIDENCE_IDS, MAX_KNOWLEDGE_NEIGHBORS,
    MAX_KNOWLEDGE_QUERY_BYTES, MAX_KNOWLEDGE_RESULTS, MAX_KNOWLEDGE_TARGET_IDENTITY_BYTES,
    MAX_SOURCE_PATH_BYTES, MAX_SOURCE_READ_LINES,
};
use serde_json::json;

use super::*;
use crate::features::knowledge::application::{graph_path, search_graphs};
use crate::features::knowledge::domain::{KnowledgeMappingProposal, MappingProposalState};
use crate::features::knowledge::{
    PinnedSourceAuthority, PinnedSourceReadRequest, PinnedSourceSearchRequest,
};

pub(super) async fn handle(
    dispatcher: &BrokerDispatcher,
    request: &RequestEnvelope,
) -> ResponseEnvelope {
    let request_id = request.request_id;
    let capability = match request.command {
        CommandName::KnowledgeMappingPropose => BrokerCapability::KnowledgePropose,
        _ => BrokerCapability::KnowledgeRead,
    };
    let session = match dispatcher.authenticate(request, capability) {
        Ok(session) => session,
        Err((code, retryable)) => return failure(request_id, code, retryable),
    };
    let scopes = &session.knowledge_scopes;
    let Some(project_id) = scopes.first().map(|scope| scope.project_id) else {
        return failure(request_id, ErrorCode::ScopeDenied, false);
    };
    let services = match dispatcher.services() {
        Ok(services) => services,
        Err(code) => return failure(request_id, code, false),
    };
    let mut graphs = Vec::new();
    for scope in scopes {
        match services
            .knowledge
            .exact_knowledge_session_graphs(
                scope,
                Uuid::from(session.workspace_id),
                session.knowledge_account_scope.as_str(),
            )
            .await
        {
            Ok(environment_graphs) => graphs.extend(environment_graphs),
            Err(error) => return failure(request_id, map_application_error(error), false),
        }
    }

    match request.command {
        CommandName::EnvironmentContext => {
            if decode_arguments::<EnvironmentContextCommand>(request).is_err() {
                return failure(request_id, ErrorCode::InvalidRequest, false);
            }
            respond(
                request_id,
                Ok::<_, ErrorCode>(EnvironmentContextResult {
                    project_id,
                    environments: scopes
                        .iter()
                        .map(|scope| EnvironmentRevisionScope {
                            project_environment_id: scope.project_environment_id,
                            environment_revision: scope.environment_revision,
                        })
                        .collect(),
                    connections: scopes
                        .iter()
                        .flat_map(|scope| {
                            scope
                                .connections
                                .iter()
                                .map(|connection| EnvironmentConnectionScope {
                                    project_environment_id: scope.project_environment_id,
                                    connection_id: connection.connection_id,
                                    connection_revision: connection.connection_revision,
                                    role: connection.role.clone(),
                                    alias: connection.alias.clone(),
                                })
                        })
                        .collect(),
                    sources: scopes
                        .iter()
                        .flat_map(|scope| {
                            scope.sources.iter().map(|source| EnvironmentSourceScope {
                                project_environment_id: scope.project_environment_id,
                                source_id: source.source_id,
                                display_name: source.display_name.clone(),
                                repository: source.repository.clone(),
                                ref_name: source.ref_name.clone(),
                                commit_sha: source.commit_sha.clone(),
                            })
                        })
                        .collect(),
                    graph_revision_ids: scopes
                        .iter()
                        .flat_map(|scope| scope.graph_revision_ids.iter().copied())
                        .collect(),
                    write_connection_id: session.write_connection_id.map(Uuid::from),
                }),
            )
        }
        CommandName::SourceSearch => {
            let arguments = match decode_arguments::<SourceSearchCommand>(request) {
                Ok(arguments) if valid_query(&arguments.query, arguments.limit) => arguments,
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            let available = scopes
                .iter()
                .flat_map(|scope| scope.sources.iter().map(move |source| (scope, source)))
                .collect::<Vec<_>>();
            let selected = if let Some(source_id) = arguments.source_id {
                match available
                    .iter()
                    .find(|(_, source)| source.source_id == source_id)
                {
                    Some(selected) => vec![*selected],
                    None => return failure(request_id, ErrorCode::ScopeDenied, false),
                }
            } else if available.len() <= 4 {
                available
            } else {
                return failure(request_id, ErrorCode::InvalidRequest, false);
            };
            if selected.is_empty() {
                return respond(
                    request_id,
                    Ok::<_, ErrorCode>(SourceSearchResult {
                        matches: Vec::new(),
                        truncated: false,
                    }),
                );
            }
            let mut matches = Vec::new();
            let mut truncated = false;
            for (scope, source) in selected {
                let remaining = usize::try_from(arguments.limit)
                    .unwrap_or(0)
                    .saturating_sub(matches.len());
                if remaining == 0 {
                    truncated = true;
                    break;
                }
                let remote = match services
                    .knowledge
                    .search_source(&PinnedSourceSearchRequest {
                        authority: PinnedSourceAuthority {
                            account_id: session.knowledge_account_scope.as_str(),
                            workspace_id: Uuid::from(session.workspace_id),
                            environment_id: scope.project_environment_id,
                            environment_revision: scope.environment_revision,
                            connection_id: scope.authority_connection_id,
                            connection_revision: scope.authority_connection_revision,
                            source,
                        },
                        query: &arguments.query,
                        limit: u32::try_from(remaining).unwrap_or(arguments.limit),
                    })
                    .await
                {
                    Ok(result) => result,
                    Err(error) => return failure(request_id, map_application_error(error), false),
                };
                truncated |= remote.truncated;
                matches.extend(remote.matches.into_iter().map(|item| SourceFileMatch {
                    source_id: source.source_id,
                    repository: source.repository.clone(),
                    commit_sha: source.commit_sha.clone(),
                    path: item.path,
                    bytes: item.bytes,
                }));
            }
            respond(
                request_id,
                Ok::<_, ErrorCode>(SourceSearchResult { matches, truncated }),
            )
        }
        CommandName::SourceRead => {
            let arguments = match decode_arguments::<SourceReadCommand>(request) {
                Ok(arguments)
                    if valid_source_path(&arguments.path)
                        && arguments.line_start > 0
                        && arguments.line_end >= arguments.line_start
                        && arguments.line_end - arguments.line_start < MAX_SOURCE_READ_LINES =>
                {
                    arguments
                }
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            let Some((scope, source)) = scopes.iter().find_map(|scope| {
                scope
                    .sources
                    .iter()
                    .find(|source| source.source_id == arguments.source_id)
                    .map(|source| (scope, source))
            }) else {
                return failure(request_id, ErrorCode::ScopeDenied, false);
            };
            let remote = match services
                .knowledge
                .read_source(&PinnedSourceReadRequest {
                    authority: PinnedSourceAuthority {
                        account_id: session.knowledge_account_scope.as_str(),
                        workspace_id: Uuid::from(session.workspace_id),
                        environment_id: scope.project_environment_id,
                        environment_revision: scope.environment_revision,
                        connection_id: scope.authority_connection_id,
                        connection_revision: scope.authority_connection_revision,
                        source,
                    },
                    path: &arguments.path,
                    line_start: arguments.line_start,
                    line_end: arguments.line_end,
                })
                .await
            {
                Ok(result) => result,
                Err(error) => return failure(request_id, map_application_error(error), false),
            };
            respond(
                request_id,
                Ok::<_, ErrorCode>(dopedb_protocol::SourceReadResult {
                    source_id: source.source_id,
                    repository: source.repository.clone(),
                    commit_sha: source.commit_sha.clone(),
                    path: remote.path,
                    line_start: remote.line_start,
                    line_end: remote.line_end,
                    total_lines: remote.total_lines,
                    truncated: remote.truncated,
                    text: remote.text,
                }),
            )
        }
        CommandName::KnowledgeSearch => {
            let arguments = match decode_arguments::<KnowledgeSearchCommand>(request) {
                Ok(arguments) if valid_query(&arguments.query, arguments.limit) => arguments,
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            let result = search_graphs(&graphs, &arguments.query, arguments.limit as usize)
                .map(|result| KnowledgeSearchResult {
                    graph_revision_ids: result.graph_revision_ids,
                    matches: result
                        .matches
                        .into_iter()
                        .map(|value| KnowledgeNodeMatch {
                            graph_revision_id: value.graph_revision_id,
                            node: value.node,
                        })
                        .collect(),
                })
                .map_err(map_application_error);
            respond(request_id, result)
        }
        CommandName::KnowledgeExplain => {
            let arguments = match decode_arguments::<KnowledgeExplainCommand>(request) {
                Ok(arguments) if valid_hash(&arguments.node_id) => arguments,
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                explain(&graphs, &arguments).ok_or(ErrorCode::InvalidRequest),
            )
        }
        CommandName::KnowledgeNeighbors => {
            let arguments = match decode_arguments::<KnowledgeNeighborsCommand>(request) {
                Ok(arguments)
                    if valid_hash(&arguments.node_id)
                        && arguments.limit > 0
                        && arguments.limit <= MAX_KNOWLEDGE_NEIGHBORS =>
                {
                    arguments
                }
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                neighbors(&graphs, &arguments).ok_or(ErrorCode::InvalidRequest),
            )
        }
        CommandName::KnowledgePath => {
            let arguments = match decode_arguments::<KnowledgePathCommand>(request) {
                Ok(arguments)
                    if valid_hash(&arguments.from_node_id) && valid_hash(&arguments.to_node_id) =>
                {
                    arguments
                }
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            let result = graphs
                .iter()
                .find(|graph| {
                    graph
                        .nodes
                        .iter()
                        .any(|node| node.id == arguments.from_node_id)
                        && graph
                            .nodes
                            .iter()
                            .any(|node| node.id == arguments.to_node_id)
                })
                .ok_or(ErrorCode::InvalidRequest)
                .and_then(|graph| {
                    graph_path(graph, &arguments.from_node_id, &arguments.to_node_id)
                        .map(|path| KnowledgeSubgraphResult {
                            graph_revision_ids: vec![path.graph_revision_id],
                            nodes: path.nodes,
                            edges: path.edges,
                            evidence: path.evidence,
                        })
                        .map_err(map_application_error)
                });
            respond(request_id, result)
        }
        CommandName::KnowledgeEvidence => {
            let arguments = match decode_arguments::<KnowledgeEvidenceCommand>(request) {
                Ok(arguments)
                    if !arguments.evidence_ids.is_empty()
                        && arguments.evidence_ids.len() <= MAX_KNOWLEDGE_EVIDENCE_IDS
                        && arguments.evidence_ids.iter().all(|value| valid_hash(value)) =>
                {
                    arguments
                }
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            let requested = arguments.evidence_ids.into_iter().collect::<BTreeSet<_>>();
            let evidence = graphs
                .iter()
                .flat_map(|graph| graph.evidence.iter())
                .filter(|value| requested.contains(&value.id))
                .cloned()
                .collect::<Vec<_>>();
            respond(
                request_id,
                Ok::<_, ErrorCode>(KnowledgeEvidenceResult {
                    graph_revision_ids: graphs
                        .iter()
                        .map(|graph| graph.graph_revision_id)
                        .collect(),
                    evidence,
                }),
            )
        }
        CommandName::KnowledgeDiff => {
            let arguments = match decode_arguments::<KnowledgeDiffCommand>(request) {
                Ok(arguments)
                    if scopes.iter().any(|scope| {
                        scope
                            .graph_revision_ids
                            .contains(&arguments.to_graph_revision_id)
                    }) =>
                {
                    arguments
                }
                _ => return failure(request_id, ErrorCode::ScopeDenied, false),
            };
            let current = match graphs
                .iter()
                .find(|graph| graph.graph_revision_id == arguments.to_graph_revision_id)
            {
                Some(graph)
                    if graph.parent_graph_revision_id == Some(arguments.from_graph_revision_id) =>
                {
                    graph
                }
                _ => return failure(request_id, ErrorCode::ScopeDenied, false),
            };
            let previous = match services
                .knowledge
                .by_revision(arguments.from_graph_revision_id)
                .await
            {
                Ok(Some(graph))
                    if graph.binding.source_id == current.binding.source_id
                        && graph.binding.project_environment_id
                            == current.binding.project_environment_id =>
                {
                    graph
                }
                Ok(_) => return failure(request_id, ErrorCode::ScopeDenied, false),
                Err(error) => {
                    return failure(request_id, map_application_error(error), false);
                }
            };
            drop(previous);
            respond(
                request_id,
                services
                    .knowledge
                    .diff(
                        arguments.from_graph_revision_id,
                        arguments.to_graph_revision_id,
                    )
                    .await
                    .map_err(map_application_error),
            )
        }
        CommandName::FunnelTrace => {
            let arguments = match decode_arguments::<FunnelTraceCommand>(request) {
                Ok(arguments) if valid_query(&arguments.query, arguments.limit) => arguments,
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                funnel_trace(&graphs, &arguments).map_err(map_application_error),
            )
        }
        CommandName::KnowledgeMappingPropose => {
            let arguments = match decode_arguments::<KnowledgeMappingProposeCommand>(request) {
                Ok(arguments) => arguments,
                _ => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            let Some(scope) = scopes
                .iter()
                .find(|scope| valid_mapping_arguments(scope, &graphs, &arguments))
            else {
                return failure(request_id, ErrorCode::ScopeDenied, false);
            };
            respond(
                request_id,
                propose_mapping(
                    dispatcher,
                    &session,
                    scope,
                    services,
                    arguments,
                    request.protocol_version,
                )
                .await,
            )
        }
        _ => failure(request_id, ErrorCode::InvalidRequest, false),
    }
}

fn valid_mapping_arguments(
    scope: &crate::features::knowledge::domain::KnowledgeSessionScope,
    graphs: &[GraphBuildArtifactV1],
    arguments: &KnowledgeMappingProposeArguments,
) -> bool {
    scope
        .graph_revision_ids
        .contains(&arguments.graph_revision_id)
        && scope
            .connections
            .iter()
            .any(|connection| connection.connection_id == arguments.connection_id)
        && graphs.iter().any(|graph| {
            graph.graph_revision_id == arguments.graph_revision_id
                && graph
                    .nodes
                    .iter()
                    .any(|node| node.id == arguments.from_node_id)
        })
        && valid_hash(&arguments.from_node_id)
        && !arguments.target_identity.trim().is_empty()
        && arguments.target_identity.len() <= MAX_KNOWLEDGE_TARGET_IDENTITY_BYTES
        && !arguments.target_identity.chars().any(char::is_control)
        && arguments.database.as_ref().is_none_or(|database| {
            !database.trim().is_empty()
                && database.len() <= MAX_TABLE_SELECTOR_BYTES
                && !database.chars().any(char::is_control)
        })
}

async fn propose_mapping(
    dispatcher: &BrokerDispatcher,
    session: &AuthenticatedSession,
    scope: &crate::features::knowledge::domain::KnowledgeSessionScope,
    services: &ApplicationServices,
    arguments: KnowledgeMappingProposeArguments,
    client_protocol_version: u16,
) -> Result<KnowledgeMappingProposalResult, ErrorCode> {
    // Personal GitHub graphs use a hidden account-backed cloud authority, while
    // Personal database bindings deliberately remain device-local. Until those
    // identities have one explicit shared mapping boundary, do not send a local
    // workspace id to the hosted mapping endpoint.
    if session.account_scope.as_str() == "personal" {
        return Err(ErrorCode::ScopeDenied);
    }
    let connection = scope
        .connections
        .iter()
        .find(|connection| connection.connection_id == arguments.connection_id)
        .ok_or(ErrorCode::ScopeDenied)?;
    let catalog = dispatcher
        .catalog(
            session,
            &CatalogArguments {
                connection: ConnectionSelector::Id(arguments.connection_id),
                database: arguments.database,
            },
            client_protocol_version,
        )
        .await?;
    let requested = arguments.target_identity.trim();
    let qualified_target = resolve_mapping_target(&catalog, arguments.target_kind, requested)
        .ok_or(ErrorCode::InvalidRequest)?;
    let stored_target = serde_json::to_string(&json!({
        "connectionId": arguments.connection_id,
        "connectionRevision": connection.connection_revision,
        "database": catalog.database(),
        "qualifiedTarget": qualified_target,
    }))
    .map_err(|_| ErrorCode::Internal)?;
    if stored_target.len() > MAX_KNOWLEDGE_TARGET_IDENTITY_BYTES {
        return Err(ErrorCode::InvalidRequest);
    }
    let proposal = KnowledgeMappingProposal {
        id: Uuid::new_v4(),
        project_environment_id: scope.project_environment_id,
        graph_revision_id: arguments.graph_revision_id,
        schema_fingerprint: catalog.fingerprint().to_owned(),
        from_node_id: arguments.from_node_id,
        target_kind: match arguments.target_kind {
            KnowledgeMappingTargetKind::Table => "table",
            KnowledgeMappingTargetKind::Column => "column",
        }
        .into(),
        target_identity: stored_target,
        state: MappingProposalState::Proposed,
        proposed_at: chrono::Utc::now(),
    };
    let proposal = services
        .knowledge
        .propose_remote_mapping(
            session.account_scope.as_str(),
            Uuid::from(session.workspace_id),
            scope.knowledge_grant_id.ok_or(ErrorCode::ScopeDenied)?,
            &proposal,
        )
        .await
        .map_err(map_application_error)?;
    services
        .knowledge
        .propose_mapping(&proposal)
        .await
        .map_err(map_application_error)?;
    Ok(KnowledgeMappingProposalResult {
        id: proposal.id,
        project_environment_id: proposal.project_environment_id,
        graph_revision_id: proposal.graph_revision_id,
        connection_id: arguments.connection_id,
        connection_revision: connection.connection_revision,
        database: catalog.database().to_owned(),
        schema_fingerprint: proposal.schema_fingerprint,
        from_node_id: proposal.from_node_id,
        target_kind: arguments.target_kind,
        target_identity: qualified_target,
        state: "proposed".into(),
    })
}

fn resolve_mapping_target(
    catalog: &dopedb_protocol::CatalogSnapshot,
    kind: KnowledgeMappingTargetKind,
    requested: &str,
) -> Option<String> {
    for relation in catalog.relations() {
        let relation_name = qualified_object_name(&relation.object);
        match kind {
            KnowledgeMappingTargetKind::Table if relation_name == requested => {
                return Some(relation_name);
            }
            KnowledgeMappingTargetKind::Column => {
                if let Some(column) = relation
                    .columns
                    .iter()
                    .find(|column| format!("{relation_name}.{}", column.name) == requested)
                {
                    return Some(format!("{relation_name}.{}", column.name));
                }
            }
            KnowledgeMappingTargetKind::Table => {}
        }
    }
    None
}

fn qualified_object_name(object: &dopedb_protocol::ObjectRef) -> String {
    [
        object.catalog.as_deref(),
        object.namespace.as_deref(),
        Some(&object.name),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(".")
}

fn valid_query(query: &str, limit: u32) -> bool {
    !query.trim().is_empty()
        && query.len() <= MAX_KNOWLEDGE_QUERY_BYTES
        && !query.chars().any(char::is_control)
        && limit > 0
        && limit <= MAX_KNOWLEDGE_RESULTS
}

fn valid_source_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_SOURCE_PATH_BYTES
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn explain(
    graphs: &[GraphBuildArtifactV1],
    arguments: &KnowledgeNodeArguments,
) -> Option<KnowledgeSubgraphResult> {
    neighbors(
        graphs,
        &KnowledgeNeighborsArguments {
            node_id: arguments.node_id.clone(),
            direction: KnowledgeNeighborDirection::Both,
            limit: MAX_KNOWLEDGE_NEIGHBORS,
        },
    )
}

fn neighbors(
    graphs: &[GraphBuildArtifactV1],
    arguments: &KnowledgeNeighborsArguments,
) -> Option<KnowledgeSubgraphResult> {
    let graph = graphs
        .iter()
        .find(|graph| graph.nodes.iter().any(|node| node.id == arguments.node_id))?;
    let edges = graph
        .edges
        .iter()
        .filter(|edge| match arguments.direction {
            KnowledgeNeighborDirection::Incoming => edge.to == arguments.node_id,
            KnowledgeNeighborDirection::Outgoing => edge.from == arguments.node_id,
            KnowledgeNeighborDirection::Both => {
                edge.from == arguments.node_id || edge.to == arguments.node_id
            }
        })
        .take(arguments.limit as usize)
        .cloned()
        .collect::<Vec<_>>();
    let node_ids = edges
        .iter()
        .flat_map(|edge| [edge.from.clone(), edge.to.clone()])
        .chain(std::iter::once(arguments.node_id.clone()))
        .collect::<BTreeSet<_>>();
    Some(subgraph(graph, node_ids, edges))
}

fn funnel_trace(
    graphs: &[GraphBuildArtifactV1],
    arguments: &FunnelTraceArguments,
) -> crate::error::AppResult<KnowledgeSubgraphResult> {
    let matches = search_graphs(graphs, &arguments.query, arguments.limit as usize)?;
    let matched = matches
        .matches
        .iter()
        .map(|value| value.node.id.as_str())
        .collect::<BTreeSet<_>>();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut evidence = Vec::new();
    let mut revisions = Vec::new();
    for graph in graphs {
        let related = graph
            .edges
            .iter()
            .filter(|edge| {
                matched.contains(edge.from.as_str()) || matched.contains(edge.to.as_str())
            })
            .take(MAX_KNOWLEDGE_NEIGHBORS as usize)
            .cloned()
            .collect::<Vec<_>>();
        if related.is_empty()
            && !graph
                .nodes
                .iter()
                .any(|node| matched.contains(node.id.as_str()))
        {
            continue;
        }
        let node_ids = related
            .iter()
            .flat_map(|edge| [edge.from.clone(), edge.to.clone()])
            .chain(matched.iter().map(|value| (*value).to_owned()))
            .collect::<BTreeSet<_>>();
        let part = subgraph(graph, node_ids, related);
        revisions.extend(part.graph_revision_ids);
        nodes.extend(part.nodes);
        edges.extend(part.edges);
        evidence.extend(part.evidence);
    }
    Ok(KnowledgeSubgraphResult {
        graph_revision_ids: revisions,
        nodes,
        edges,
        evidence,
    })
}

fn subgraph(
    graph: &GraphBuildArtifactV1,
    node_ids: BTreeSet<String>,
    edges: Vec<dopedb_protocol::KnowledgeEdgeV1>,
) -> KnowledgeSubgraphResult {
    let evidence_ids = edges
        .iter()
        .flat_map(|edge| edge.evidence_ids.iter().cloned())
        .collect::<BTreeSet<_>>();
    KnowledgeSubgraphResult {
        graph_revision_ids: vec![graph.graph_revision_id],
        nodes: graph
            .nodes
            .iter()
            .filter(|node| node_ids.contains(&node.id))
            .cloned()
            .collect(),
        edges,
        evidence: graph
            .evidence
            .iter()
            .filter(|value| evidence_ids.contains(&value.id))
            .cloned()
            .collect(),
    }
}
