//! Hosted Project and Environment identity operations.

use super::*;

// Every request below uses the shared origin validator, which rejects cleartext
// outside a debug-only loopback origin; the release client is HTTPS-only too.

pub(super) async fn ensure_personal_knowledge_scope(
    user_id: &str,
    projects: &[RemoteKnowledgeProject],
) -> AppResult<RemotePersonalKnowledgeScope> {
    if projects.len() > 100
        || projects.iter().any(|project| {
            project.name.trim().is_empty()
                || project.name.len() > 512
                || project.revision == 0
                || !valid_environments(&project.environments)
        })
    {
        return Err(AppError::Config(
            "the Personal Knowledge scope inventory is invalid".into(),
        ));
    }
    let token = bearer(user_id).await?;
    let response = client()?
        .post(format!("{}/api/v1/personal/knowledge/scope", origin()?))
        .bearer_auth(token.as_str())
        .json(&PersonalKnowledgeScopeRequest { projects })
        .send()
        .await
        .map_err(|error| request_error("preparing Personal Knowledge", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let scope: PersonalKnowledgeScopeResponse =
        knowledge_response(response, "reading the Personal Knowledge scope").await?;
    if scope.member_id.trim().is_empty() || scope.member_id.len() > 255 {
        return Err(AppError::Network(
            "Personal Knowledge returned an invalid authority".into(),
        ));
    }
    Ok(RemotePersonalKnowledgeScope {
        workspace_id: scope.workspace_id,
    })
}

/// A Project holds one revisioned Environment per kind, so the list is bounded by
/// the fixed kinds and never repeats one.
fn valid_environments(
    environments: &[crate::features::knowledge::ports::RemoteKnowledgeEnvironment],
) -> bool {
    let mut kinds = std::collections::HashSet::new();
    !environments.is_empty()
        && environments.len() <= 4
        && environments
            .iter()
            .all(|environment| environment.revision != 0 && kinds.insert(environment.kind))
}

pub(super) fn validate_project_inventory(projects: &[RemoteKnowledgeProject]) -> AppResult<()> {
    if projects.len() > 1_000
        || projects.iter().any(|project| {
            project.name.is_empty()
                || project.name.len() > 512
                || project.revision == 0
                || !valid_environments(&project.environments)
        })
    {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid scope inventory".into(),
        ));
    }
    Ok(())
}

pub(super) fn validate_source_inventory(sources: &[RemoteKnowledgeSource]) -> AppResult<()> {
    if sources.len() > 10_000
        || sources.iter().any(|source| {
            source.environment_revision == 0
                || source.sync_revision == 0
                || source.display_name.trim().is_empty()
                || source.display_name.len() > 512
                || !matches!(source.sync_state.as_str(), "ready" | "stale" | "failed")
                || source
                    .last_failure_code
                    .as_ref()
                    .is_some_and(|value| value.is_empty() || value.len() > 255)
        })
    {
        return Err(AppError::Network(
            "Project Knowledge returned invalid source inventory".into(),
        ));
    }
    Ok(())
}

pub(super) async fn list_knowledge_projects(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteKnowledgeProject>> {
    let token = bearer(user_id).await?;
    let response = client()?
        // codeql[rust/cleartext-transmission]
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/projects",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Project Knowledge scopes", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let projects = knowledge_response::<KnowledgeProjectsResponse>(
        response,
        "reading Project Knowledge scopes",
    )
    .await?
    .projects;
    validate_project_inventory(&projects)?;
    Ok(projects)
}

pub(super) async fn list_knowledge_inventory(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<RemoteKnowledgeInventory> {
    let token = bearer(user_id).await?;
    let response = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/inventory",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Project Knowledge inventory", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let inventory: RemoteKnowledgeInventory = bounded_json_response(
        response,
        "reading Project Knowledge inventory",
        MAX_KNOWLEDGE_INVENTORY_RESPONSE_BYTES,
    )
    .await?;
    validate_project_inventory(&inventory.projects)?;
    validate_source_inventory(&inventory.sources)?;
    Ok(inventory)
}

pub(super) async fn create_knowledge_project(
    user_id: &str,
    workspace_id: Uuid,
    request: &CreateKnowledgeProjectRequest,
) -> AppResult<RemoteKnowledgeProject> {
    let token = bearer(user_id).await?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/projects",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(request)
        .send()
        .await
        .map_err(|error| request_error("creating a Project Knowledge scope", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let project = knowledge_response::<CreatedKnowledgeProjectResponse>(
        response,
        "reading the Project Knowledge scope",
    )
    .await?
    .project;
    if project.revision == 0 || project.environments.is_empty() {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid created scope".into(),
        ));
    }
    Ok(project)
}

pub(super) async fn delete_knowledge_project(
    user_id: &str,
    workspace_id: Uuid,
    project_id: Uuid,
    expected_revision: u64,
) -> AppResult<()> {
    let token = bearer(user_id).await?;
    let response = client()?
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/projects/{project_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&DeleteKnowledgeProjectRequest { expected_revision })
        .send()
        .await
        .map_err(|error| request_error("deleting a Project Knowledge scope", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    Ok(())
}

pub(super) async fn create_knowledge_environment(
    user_id: &str,
    workspace_id: Uuid,
    project_id: Uuid,
    request: &AppendKnowledgeEnvironmentRequest,
) -> AppResult<RemoteKnowledgeProject> {
    let token = bearer(user_id).await?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/projects/{project_id}/environments",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(request)
        .send()
        .await
        .map_err(|error| request_error("adding a Project Environment", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let project = knowledge_response::<CreatedKnowledgeProjectResponse>(
        response,
        "reading the updated Project scope",
    )
    .await?
    .project;
    if project.id != project_id
        || project.revision != request.expected_project_revision.saturating_add(1)
        || !valid_environments(&project.environments)
    {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid updated scope".into(),
        ));
    }
    Ok(project)
}
