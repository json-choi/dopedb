//! Knowledge graph search, mapping, and Environment binding command transport.

use super::*;
use crate::features::workspaces::WorkspaceConnectionCopyRequest;
use crate::kernel::identity::ConnectionId;
use crate::model::{Engine, WorkspaceConnectionAccess, WorkspaceCredentialMode};

async fn active_workspace_graphs(
    state: &AppState,
    project_environment_id: Uuid,
) -> AppResult<Vec<dopedb_protocol::GraphBuildArtifactV1>> {
    let active_scope = state.services.knowledge.active_resource_scope().await?;
    if active_scope.workspace_kind == WorkspaceKind::Team {
        state.services.knowledge.reconcile_current_access().await?;
    } else if active_scope.selected_account_id.is_some() {
        if let Err(error) = state.services.knowledge.reconcile_current_access().await {
            let has_remote_graph = state
                .services
                .knowledge
                .active_set(project_environment_id)
                .await?
                .iter()
                .any(|graph| graph.binding.provider == KnowledgeSourceProvider::Github);
            if has_remote_graph {
                return Err(error);
            }
            tracing::warn!(%error, "Personal GitHub Knowledge refresh deferred for a local-only graph");
        }
    }
    let allowed = state
        .services
        .knowledge
        .knowledge_environment_exists(active_scope.workspace_id, project_environment_id)
        .await?;
    if !allowed {
        return Err(AppError::NotFound(
            "the active workspace Project Environment".into(),
        ));
    }
    let mut graphs = state
        .services
        .knowledge
        .active_set(project_environment_id)
        .await?;
    if active_scope.selected_account_id.is_none() {
        graphs.retain(|graph| graph.binding.provider != KnowledgeSourceProvider::Github);
    }
    let environment_revision = graphs
        .first()
        .map(|graph| graph.environment_revision)
        .ok_or_else(|| AppError::NotFound("an active Knowledge graph revision set".into()))?;
    let remote_graph_revision_ids = graphs
        .iter()
        .filter(|graph| graph.binding.provider == KnowledgeSourceProvider::Github)
        .map(|graph| graph.graph_revision_id)
        .collect::<Vec<_>>();
    if !remote_graph_revision_ids.is_empty() {
        let account_id =
            active_scope
                .selected_account_id
                .as_deref()
                .ok_or_else(|| AppError::Blocked {
                    reason: "Project Knowledge requires an exact member grant".into(),
                })?;
        if state
            .services
            .knowledge
            .active_knowledge_grant(
                active_scope.workspace_id,
                account_id,
                project_environment_id,
                environment_revision,
                &remote_graph_revision_ids,
            )
            .await?
            .is_none()
        {
            return Err(AppError::Blocked {
                reason: "this member has no current grant for the active Knowledge revision set"
                    .into(),
            });
        }
    }
    Ok(graphs)
}

#[tauri::command]
pub(crate) async fn search_knowledge_graph(
    state: State<'_, AppState>,
    project_environment_id: Uuid,
    query: String,
    limit: Option<usize>,
) -> AppResult<KnowledgeSearchResult> {
    let graphs = active_workspace_graphs(&state, project_environment_id).await?;
    if graphs.is_empty() {
        return Err(AppError::NotFound(
            "an active Knowledge graph revision set".into(),
        ));
    }
    search_graphs(&graphs, &query, limit.unwrap_or(20))
}

#[tauri::command]
pub(crate) async fn list_knowledge_mappings(
    state: State<'_, AppState>,
    project_environment_id: Uuid,
) -> AppResult<Vec<KnowledgeMappingProjection>> {
    let graphs = active_workspace_graphs(&state, project_environment_id).await?;
    let active_scope = state.services.knowledge.active_resource_scope().await?;
    if active_scope.workspace_kind == WorkspaceKind::Team {
        let account = selected_team_account(&active_scope)?;
        for mapping in state
            .services
            .knowledge
            .list_remote_mappings(account.as_str(), active_scope.workspace_id)
            .await?
        {
            if mapping.project_environment_id == project_environment_id
                && graphs
                    .iter()
                    .any(|graph| graph.graph_revision_id == mapping.graph_revision_id)
            {
                state
                    .services
                    .knowledge
                    .sync_remote_knowledge_mapping(&mapping)
                    .await?;
            }
        }
    }
    let mut result = Vec::new();
    for graph in graphs {
        let proposals = state
            .services
            .knowledge
            .mappings_for_revision(project_environment_id, graph.graph_revision_id)
            .await?;
        for proposal in proposals {
            result.push(mapping_projection(proposal, &graph)?);
        }
    }
    result.sort_by(|left, right| {
        right
            .proposed_at
            .cmp(&left.proposed_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(result)
}

#[tauri::command]
pub(crate) async fn decide_knowledge_mapping(
    state: State<'_, AppState>,
    project_environment_id: Uuid,
    proposal_id: Uuid,
    expected_graph_revision_id: Uuid,
    decision: KnowledgeMappingDecision,
) -> AppResult<()> {
    let graphs = active_workspace_graphs(&state, project_environment_id).await?;
    if !graphs
        .iter()
        .any(|graph| graph.graph_revision_id == expected_graph_revision_id)
    {
        return Err(AppError::Blocked {
            reason: "the Knowledge mapping proposal no longer belongs to the active graph".into(),
        });
    }
    let state_value = match decision {
        KnowledgeMappingDecision::Approved => MappingProposalState::Approved,
        KnowledgeMappingDecision::Rejected => MappingProposalState::Rejected,
    };
    let active_scope = state.services.knowledge.active_resource_scope().await?;
    if active_scope.workspace_kind == WorkspaceKind::Team {
        let account = selected_team_account(&active_scope)?;
        state
            .services
            .knowledge
            .decide_remote_mapping(
                account.as_str(),
                active_scope.workspace_id,
                proposal_id,
                expected_graph_revision_id,
                state_value,
            )
            .await?;
    }
    state
        .services
        .knowledge
        .decide_mapping(proposal_id, expected_graph_revision_id, state_value)
        .await
}

#[tauri::command]
pub(crate) async fn list_knowledge_environment_connections(
    state: State<'_, AppState>,
    project_environment_id: Option<Uuid>,
) -> AppResult<Vec<EnvironmentConnectionProjection>> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    if scope.workspace_kind == WorkspaceKind::Team {
        let account = selected_team_account(&scope)?;
        let remote = state
            .services
            .knowledge
            .list_remote_environment_connections(
                account.as_str(),
                scope.workspace_id,
                project_environment_id,
            )
            .await?;
        let local_connection_ids = state
            .services
            .knowledge
            .local_connection_ids_for_remote(scope.workspace_id)
            .await?
            .into_iter()
            .collect::<BTreeMap<_, _>>();
        let mut projections = Vec::with_capacity(remote.len());
        for binding in remote {
            let local_connection_id = local_connection_ids.get(&binding.connection_id).copied();
            projections.push(EnvironmentConnectionProjection {
                id: binding.id,
                project_environment_id: binding.project_environment_id,
                environment_revision: binding.environment_revision,
                connection_id: local_connection_id,
                remote_connection_id: Some(binding.connection_id),
                connection_revision: binding.connection_revision,
                current_connection_revision: binding.current_connection_revision,
                connection_content_revision: binding.connection_content_revision,
                connection_name: binding.connection_name,
                role: binding.role,
                alias: binding.alias,
                stale: binding.stale,
            });
        }
        return Ok(projections);
    }
    let bindings = state
        .services
        .knowledge
        .environment_connections(scope.workspace_id, project_environment_id)
        .await?;
    Ok(bindings
        .into_iter()
        .map(|binding| EnvironmentConnectionProjection {
            id: binding.id,
            project_environment_id: binding.project_environment_id,
            environment_revision: binding.environment_revision,
            connection_id: Some(binding.connection_id),
            remote_connection_id: None,
            connection_revision: binding.connection_revision,
            current_connection_revision: binding.current_connection_revision,
            connection_content_revision: binding.connection_content_revision,
            connection_name: binding.connection_name,
            role: binding.role,
            alias: binding.alias,
            stale: binding.connection_revision != binding.current_connection_revision,
        })
        .collect())
}

async fn rollback_promoted_connection(
    state: &AppState,
    promoted_connection_id: Option<ConnectionId>,
    original_error: AppError,
) -> AppError {
    let Some(connection_id) = promoted_connection_id else {
        return original_error;
    };
    if let Err(rollback_error) = state
        .services
        .workspace
        .delete_connection(connection_id)
        .await
    {
        tracing::warn!(
            connection_id = %connection_id,
            error_kind = rollback_error.kind(),
            "temporary shared connection cleanup deferred after Project binding failure"
        );
        return AppError::Blocked {
            reason: format!(
                "{original_error}; the temporary shared connection could not be removed. Refresh Explorer and remove its Unassigned copy before retrying"
            ),
        };
    }
    original_error
}

#[tauri::command]
pub(crate) async fn bind_knowledge_environment_connection(
    state: State<'_, AppState>,
    input: BindEnvironmentConnectionInput,
) -> AppResult<EnvironmentConnectionProjection> {
    let mut connection = state
        .services
        .knowledge
        .pin_connection_for_read(input.connection_id)
        .await?;
    let proposed_binding_id = Uuid::new_v4();
    let mut promoted_connection_id = None;
    let mut remote_binding_account = None;
    let mut remote_binding_workspace_id = None;
    let mut projected_remote_connection_id = None;
    let binding_id = if connection.scope.workspace_kind == WorkspaceKind::Team {
        let account = selected_team_account(&connection.scope)?;
        let mut remote_connection_id = state
            .services
            .knowledge
            .remote_connection_id(&connection)
            .await?;
        if remote_connection_id.is_none() {
            if connection.profile.workspace_access != WorkspaceConnectionAccess::Local
                || connection.profile.credential_mode != WorkspaceCredentialMode::Local
            {
                return Err(AppError::Blocked {
                    reason: "the workspace connection identity is unavailable; refresh Explorer before assigning it to a Project"
                        .into(),
                });
            }
            if connection.profile.engine == Engine::Sqlite {
                return Err(AppError::Blocked {
                    reason:
                        "SQLite files stay on one device and cannot be shared with a Team Project"
                            .into(),
                });
            }
            let source_connection_id = ConnectionId::from(connection.connection_id);
            let workspace_id = WorkspaceId::from(connection.scope.workspace_id);
            drop(connection);
            let shared = state
                .services
                .workspace
                .copy_connection(WorkspaceConnectionCopyRequest {
                    connection_id: source_connection_id,
                    workspace_id,
                    account_user_id: account.clone(),
                    allow_active_workspace: true,
                })
                .await?;
            let shared_connection_id = ConnectionId::from(shared.id);
            promoted_connection_id = Some(shared_connection_id);
            connection = match state
                .services
                .knowledge
                .pin_connection_for_read(shared.id)
                .await
            {
                Ok(connection) => connection,
                Err(error) => {
                    return Err(rollback_promoted_connection(
                        &state,
                        promoted_connection_id,
                        error,
                    )
                    .await);
                }
            };
            remote_connection_id = match state
                .services
                .knowledge
                .remote_connection_id(&connection)
                .await
            {
                Ok(Some(remote_connection_id)) => Some(remote_connection_id),
                Ok(None) => {
                    drop(connection);
                    return Err(rollback_promoted_connection(
                        &state,
                        promoted_connection_id,
                        AppError::Blocked {
                            reason: "the new shared connection identity was not synchronized"
                                .into(),
                        },
                    )
                    .await);
                }
                Err(error) => {
                    drop(connection);
                    return Err(rollback_promoted_connection(
                        &state,
                        promoted_connection_id,
                        error,
                    )
                    .await);
                }
            };
        }
        let remote_connection_id = remote_connection_id.ok_or_else(|| AppError::Blocked {
            reason: "the shared workspace connection identity is unavailable".into(),
        })?;
        let remote_binding = state
            .services
            .knowledge
            .bind_remote_environment_connection(
                account.as_str(),
                connection.scope.workspace_id,
                input.project_environment_id,
                proposed_binding_id,
                remote_connection_id,
                connection.connection_revision,
                &input.role,
                &input.alias,
            )
            .await;
        match remote_binding {
            Ok(binding) => {
                remote_binding_account = Some(account);
                remote_binding_workspace_id = Some(connection.scope.workspace_id);
                projected_remote_connection_id = Some(remote_connection_id);
                binding.id
            }
            Err(error) => {
                drop(connection);
                return Err(
                    rollback_promoted_connection(&state, promoted_connection_id, error).await,
                );
            }
        }
    } else {
        proposed_binding_id
    };
    let local_binding = state
        .services
        .knowledge
        .bind_environment_connection(
            binding_id,
            &connection,
            input.project_environment_id,
            &input.role,
            &input.alias,
        )
        .await;
    let binding = match local_binding {
        Ok(binding) => binding,
        Err(error) => {
            drop(connection);
            if let (Some(account), Some(workspace_id)) =
                (remote_binding_account, remote_binding_workspace_id)
            {
                if let Err(rollback_error) = state
                    .services
                    .knowledge
                    .revoke_remote_environment_connection(
                        account.as_str(),
                        workspace_id,
                        input.project_environment_id,
                        binding_id,
                    )
                    .await
                {
                    tracing::warn!(
                        binding_id = %binding_id,
                        error_kind = rollback_error.kind(),
                        "remote Project binding cleanup could not be confirmed"
                    );
                    return Err(AppError::Blocked {
                        reason: format!(
                            "{error}; the remote Project binding cleanup could not be confirmed. Refresh Explorer before retrying"
                        ),
                    });
                }
            }
            return Err(rollback_promoted_connection(&state, promoted_connection_id, error).await);
        }
    };
    Ok(EnvironmentConnectionProjection {
        id: binding.id,
        project_environment_id: binding.project_environment_id,
        environment_revision: binding.environment_revision,
        connection_id: Some(binding.connection_id),
        remote_connection_id: projected_remote_connection_id,
        connection_revision: binding.connection_revision,
        current_connection_revision: binding.current_connection_revision,
        connection_content_revision: binding.connection_content_revision,
        connection_name: binding.connection_name,
        role: binding.role,
        alias: binding.alias,
        stale: binding.connection_revision != binding.current_connection_revision,
    })
}

#[tauri::command]
pub(crate) async fn revoke_knowledge_environment_connection(
    state: State<'_, AppState>,
    project_environment_id: Uuid,
    binding_id: Uuid,
) -> AppResult<()> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    if scope.workspace_kind == WorkspaceKind::Team {
        let account = selected_team_account(&scope)?;
        state
            .services
            .knowledge
            .revoke_remote_environment_connection(
                account.as_str(),
                scope.workspace_id,
                project_environment_id,
                binding_id,
            )
            .await?;
    }
    let local_result = state
        .services
        .knowledge
        .revoke_environment_connection(scope.workspace_id, binding_id)
        .await;
    if scope.workspace_kind == WorkspaceKind::Team
        && matches!(local_result, Err(AppError::NotFound(_)))
    {
        // The hosted binding is authoritative. A member may not have a local
        // credential projection for it, so a successful remote DELETE must not
        // be reported as a failed removal merely because the local cache is absent.
        return Ok(());
    }
    local_result
}
