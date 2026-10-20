//! Knowledge Environment binding command transport.

use super::*;
use crate::model::{Engine, Provider};

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

#[tauri::command]
pub(crate) async fn bind_knowledge_environment_connection(
    state: State<'_, AppState>,
    input: BindEnvironmentConnectionInput,
) -> AppResult<EnvironmentConnectionProjection> {
    let connection = state
        .services
        .knowledge
        .pin_connection_for_read(input.connection_id)
        .await?;
    let proposed_binding_id = Uuid::new_v4();
    let mut remote_binding_account = None;
    let mut remote_binding_workspace_id = None;
    let mut projected_remote_connection_id = None;
    let binding_id = if connection.scope.workspace_kind == WorkspaceKind::Team {
        let account = selected_team_account(&connection.scope)?;
        // Binding never publishes anything: a Project binds a team connection. A team-local
        // connection is published by the connection editor's save or by the next
        // synchronization of its creator's device.
        let Some(remote_connection_id) = state
            .services
            .knowledge
            .remote_connection_id(&connection)
            .await?
        else {
            return Err(AppError::Blocked {
                reason: if connection.profile.engine == Engine::Sqlite
                    && connection.profile.provider != Provider::CloudflareD1
                {
                    "SQLite files stay on one device and cannot be shared with a Team Project"
                        .into()
                } else {
                    "this connection is not a team connection yet; save it in the connection editor or refresh Explorer before assigning it to a Project"
                        .into()
                },
            });
        };
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
            Err(error) => return Err(error),
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
            return Err(error);
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
