//! Knowledge Project and Environment command transport.

use super::*;

#[tauri::command]
pub(crate) async fn list_knowledge_projects_command(
    state: State<'_, AppState>,
) -> AppResult<Vec<RemoteKnowledgeProject>> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    let projects = fetch_active_project_inventory(&state, &scope).await?;
    if let Err(error) = persist_team_project_inventory(&state, &scope, &projects).await {
        tracing::warn!(
            workspace_id = %scope.workspace_id,
            error_kind = error.kind(),
            "Project Knowledge inventory cache refresh deferred"
        );
    }
    Ok(projects)
}

#[tauri::command]
pub(crate) async fn create_knowledge_project_command(
    state: State<'_, AppState>,
    input: CreateProjectInput,
) -> AppResult<RemoteKnowledgeProject> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    if scope.workspace_kind == WorkspaceKind::Personal {
        let environments = input
            .environments
            .into_iter()
            .map(|environment| environment.kind)
            .collect::<Vec<_>>();
        return state
            .services
            .knowledge
            .create_knowledge_project(scope.workspace_id, &input.name, &environments)
            .await
            .map(project_projection);
    }
    let account = selected_team_account(&scope)?;
    let project = state
        .services
        .knowledge
        .create_remote_project(
            account.as_str(),
            scope.workspace_id,
            &CreateKnowledgeProjectRequest {
                name: input.name,
                environments: input.environments,
            },
        )
        .await?;
    state
        .services
        .knowledge
        .save_knowledge_project(&project_definition(scope.workspace_id, &project))
        .await?;
    Ok(project)
}

#[tauri::command]
pub(crate) async fn delete_knowledge_project_command(
    state: State<'_, AppState>,
    project_id: Uuid,
    expected_revision: u64,
) -> AppResult<()> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    let projects = active_project_inventory(&state, &scope).await?;
    let project = projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| AppError::NotFound("the active workspace Project".into()))?;
    if project.revision != expected_revision {
        return Err(AppError::Blocked {
            reason: "the Project revision changed before deletion".into(),
        });
    }
    let project_environment_ids = project
        .environments
        .iter()
        .map(|environment| environment.id)
        .collect::<HashSet<_>>();

    if scope.workspace_kind == WorkspaceKind::Personal {
        let has_hosted_source = state
            .services
            .knowledge
            .scopes(scope.workspace_id)
            .await?
            .iter()
            .any(|source| source.project.id == project_id);
        if has_hosted_source {
            let account = selected_remote_account(&scope)?;
            let remote = state
                .services
                .knowledge
                .ensure_personal_scope(account.as_str(), &projects)
                .await?;
            state
                .services
                .knowledge
                .delete_remote_project(
                    account.as_str(),
                    remote.workspace_id,
                    project_id,
                    expected_revision,
                )
                .await?;
        }
        if let Err(error) = state
            .services
            .knowledge
            .delete_knowledge_project(scope.workspace_id, project_id, expected_revision)
            .await
        {
            if has_hosted_source {
                return Err(AppError::OutcomeUnknown(format!(
                    "the hosted Project was deleted, but its local copy could not be removed: {error}"
                )));
            }
            return Err(error);
        }
    } else {
        let account = selected_team_account(&scope)?;
        state
            .services
            .knowledge
            .delete_remote_project(
                account.as_str(),
                scope.workspace_id,
                project_id,
                expected_revision,
            )
            .await?;
        if let Err(error) = state
            .services
            .knowledge
            .delete_knowledge_project(scope.workspace_id, project_id, expected_revision)
            .await
        {
            // The hosted deletion is already authoritative and confirmed. A later
            // inventory refresh will remove this bounded local cache entry, so do
            // not misreport a successful deletion as retry-safe failure.
            tracing::warn!(
                workspace_id = %scope.workspace_id,
                project_id = %project_id,
                error_kind = error.kind(),
                "deleted Project cache cleanup deferred"
            );
        }
    }
    let interrupted = state
        .agents_acp
        .stop_project_environments(&project_environment_ids);
    if interrupted > 0 {
        tracing::info!(
            workspace_id = %scope.workspace_id,
            project_id = %project_id,
            interrupted_sessions = interrupted,
            "deleted Project Agent sessions interrupted"
        );
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn create_knowledge_environment_command(
    state: State<'_, AppState>,
    input: CreateEnvironmentInput,
) -> AppResult<RemoteKnowledgeProject> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    let projects = active_project_inventory(&state, &scope).await?;
    let project = projects
        .iter()
        .find(|project| project.id == input.project_id)
        .ok_or_else(|| AppError::NotFound("the active workspace Project".into()))?;
    if scope.workspace_kind == WorkspaceKind::Personal {
        return state
            .services
            .knowledge
            .create_knowledge_environment(scope.workspace_id, input.project_id, input.kind)
            .await
            .map(project_projection);
    }
    let account = selected_team_account(&scope)?;
    let updated = state
        .services
        .knowledge
        .create_remote_environment(
            account.as_str(),
            scope.workspace_id,
            input.project_id,
            &AppendKnowledgeEnvironmentRequest {
                expected_project_revision: project.revision,
                kind: input.kind,
            },
        )
        .await?;
    state
        .services
        .knowledge
        .save_knowledge_project(&project_definition(scope.workspace_id, &updated))
        .await?;
    Ok(updated)
}

#[tauri::command]
pub(crate) async fn begin_knowledge_github_install_command(
    state: State<'_, AppState>,
) -> AppResult<String> {
    let remote = active_remote_scope(&state).await?;
    state
        .services
        .knowledge
        .begin_github_install(remote.account.as_str(), remote.remote_workspace_id)
        .await
}

#[tauri::command]
pub(crate) async fn list_knowledge_github_repositories_command(
    state: State<'_, AppState>,
) -> AppResult<Vec<RemoteGithubRepository>> {
    let remote = active_remote_scope(&state).await?;
    state
        .services
        .knowledge
        .list_github_repositories(remote.account.as_str(), remote.remote_workspace_id)
        .await
}

#[tauri::command]
pub(crate) async fn connect_knowledge_github_source(
    state: State<'_, AppState>,
    input: GithubSourceInput,
) -> AppResult<KnowledgeSourceProjection> {
    let remote = active_remote_scope(&state).await?;
    let (project, environment) = domain_scope(
        WorkspaceId::from(remote.local_scope.workspace_id),
        &remote.projects,
        input.project_id,
        input.project_environment_id,
    )?;
    let draft = SourceBindingDraft {
        source_id: Uuid::new_v4(),
        project_id: project.id,
        project_environment_id: environment.id,
        environment_revision: environment.revision,
        display_name: input.display_name,
        locator: SourceLocator::Github {
            installation_id: input.installation_id,
            repository_id: input.repository_id,
            repository: input.repository,
            ref_name: input.ref_name,
        },
    };
    let binding = state
        .services
        .knowledge
        .bind_github_source(
            remote.account.as_str(),
            remote.remote_workspace_id,
            &environment,
            &draft,
        )
        .await?;
    state
        .services
        .knowledge
        .save_scope(&project, &environment, &binding, environment.revision)
        .await?;
    project_source(
        &state,
        StoredKnowledgeScope {
            project,
            environment,
            binding,
        },
        None,
    )
    .await
}
