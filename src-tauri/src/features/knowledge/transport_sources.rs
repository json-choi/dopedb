//! Knowledge source inventory, sync, and revocation command transport.

use super::*;

async fn knowledge_sources_for_scope(
    state: &AppState,
    scope: &ActiveResourceScope,
    prefetched_remote: Option<(Vec<RemoteKnowledgeProject>, Vec<RemoteKnowledgeSource>)>,
) -> AppResult<Vec<KnowledgeSourceProjection>> {
    let (remote_projects, remote_sources, remote_authoritative) = if let Some((projects, sources)) =
        prefetched_remote
    {
        (projects, sources, true)
    } else if scope.workspace_kind == WorkspaceKind::Team {
        let account = selected_team_account(scope)?;
        let projects = state
            .services
            .knowledge
            .list_remote_projects(account.as_str(), scope.workspace_id)
            .await?;
        let sources = state
            .services
            .knowledge
            .list_remote_sources(account.as_str(), scope.workspace_id)
            .await?;
        (projects, sources, true)
    } else if scope.selected_account_id.is_some() {
        match active_remote_scope(state).await {
            Ok(remote) => match state
                .services
                .knowledge
                .list_remote_sources(remote.account.as_str(), remote.remote_workspace_id)
                .await
            {
                Ok(sources) => (remote.projects, sources, true),
                Err(error) => {
                    tracing::warn!(%error, "Personal GitHub Knowledge inventory refresh deferred");
                    (Vec::new(), Vec::new(), false)
                }
            },
            Err(error) => {
                tracing::warn!(%error, "Personal GitHub Knowledge authority refresh deferred");
                (Vec::new(), Vec::new(), false)
            }
        }
    } else {
        (Vec::new(), Vec::new(), false)
    };
    if remote_authoritative {
        for source in remote_sources
            .iter()
            .filter(|source| source.provider == "github")
        {
            let (project, environment) = domain_scope(
                WorkspaceId::from(scope.workspace_id),
                &remote_projects,
                source.project_id,
                source.project_environment_id,
            )?;
            if source.environment_revision != environment.revision {
                return Err(AppError::Network(
                    "Project Knowledge source crossed its Environment revision".into(),
                ));
            }
            let binding = remote_github_binding(source)?;
            state
                .services
                .knowledge
                .save_scope(&project, &environment, &binding, environment.revision)
                .await?;
        }
    }
    let sources = state.services.knowledge.scopes(scope.workspace_id).await?;
    let mut projections = Vec::with_capacity(sources.len());
    for source in sources {
        let remote = remote_sources
            .iter()
            .find(|candidate| candidate.id == source.binding.source_id);
        if source.binding.provider == KnowledgeSourceProvider::Github && remote.is_none() {
            if remote_authoritative && scope.workspace_kind == WorkspaceKind::Team {
                state
                    .services
                    .knowledge
                    .remove_scope(source.binding.source_id)
                    .await?;
            }
            continue;
        }
        projections.push(project_source(state, source, remote).await?);
    }
    Ok(projections)
}

#[tauri::command]
pub(crate) async fn list_knowledge_sources(
    state: State<'_, AppState>,
) -> AppResult<Vec<KnowledgeSourceProjection>> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    knowledge_sources_for_scope(&state, &scope, None).await
}

#[tauri::command]
pub(crate) async fn list_knowledge_inventory_command(
    state: State<'_, AppState>,
) -> AppResult<KnowledgeInventoryProjection> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    if scope.workspace_kind == WorkspaceKind::Team {
        let account = selected_team_account(&scope)?;
        let inventory = state
            .services
            .knowledge
            .list_remote_inventory(account.as_str(), scope.workspace_id)
            .await?;
        if let Err(error) =
            persist_team_project_inventory(&state, &scope, &inventory.projects).await
        {
            tracing::warn!(
                workspace_id = %scope.workspace_id,
                error_kind = error.kind(),
                "Project Knowledge inventory cache refresh deferred"
            );
        }
        let projects = inventory.projects;
        let sources = knowledge_sources_for_scope(
            &state,
            &scope,
            Some((projects.clone(), inventory.sources)),
        )
        .await?;
        return Ok(KnowledgeInventoryProjection { projects, sources });
    }
    let projects = fetch_active_project_inventory(&state, &scope).await?;
    let sources = knowledge_sources_for_scope(&state, &scope, None).await?;
    Ok(KnowledgeInventoryProjection { projects, sources })
}

#[tauri::command]
pub(crate) async fn revoke_knowledge_source(
    state: State<'_, AppState>,
    source_id: Uuid,
) -> AppResult<()> {
    state.knowledge_watches.stop(source_id);
    let scope = state.services.knowledge.active_resource_scope().await?;
    let source = state
        .services
        .knowledge
        .scopes(scope.workspace_id)
        .await?
        .into_iter()
        .find(|candidate| candidate.binding.source_id == source_id)
        .ok_or_else(|| AppError::NotFound("the Project Knowledge source".into()))?;
    match source.binding.provider {
        KnowledgeSourceProvider::Github => {
            let remote = active_remote_scope(&state).await?;
            state
                .services
                .knowledge
                .delete_remote_source(
                    remote.account.as_str(),
                    remote.remote_workspace_id,
                    source_id,
                )
                .await?;
        }
        KnowledgeSourceProvider::LocalFolder => {
            let _ = state.local_knowledge_sources.revoke(&source.binding).await;
            delete_knowledge_source_root(source_id)?;
        }
    }
    state.services.knowledge.remove_scope(source_id).await
}
