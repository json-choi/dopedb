//! Project Knowledge tools scoped to one immutable ACP resource revision set.

use dopedb_protocol::{
    EnvironmentConnectionScope, EnvironmentContextCommand, EnvironmentContextResult,
    EnvironmentRevisionScope, EnvironmentSourceScope, SourceFileMatch, SourceReadCommand,
    SourceSearchCommand, SourceSearchResult, MAX_KNOWLEDGE_QUERY_BYTES, MAX_KNOWLEDGE_RESULTS,
    MAX_SOURCE_PATH_BYTES, MAX_SOURCE_READ_LINES,
};

use super::*;
use crate::features::knowledge::{
    PinnedSourceAuthority, PinnedSourceReadRequest, PinnedSourceSearchRequest,
};

pub(super) async fn handle(
    dispatcher: &BrokerDispatcher,
    request: &RequestEnvelope,
) -> ResponseEnvelope {
    let request_id = request.request_id;
    let session = match dispatcher.authenticate(request, BrokerCapability::KnowledgeRead) {
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
    for scope in scopes {
        match services
            .knowledge
            .validate_knowledge_session_scope(
                scope,
                Uuid::from(session.workspace_id),
                session.knowledge_account_scope.as_str(),
            )
            .await
        {
            Ok(()) => {}
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
        _ => failure(request_id, ErrorCode::InvalidRequest, false),
    }
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
