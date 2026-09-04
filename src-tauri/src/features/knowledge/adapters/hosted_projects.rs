//! Hosted Knowledge project, grant, mapping, and graph operations.

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
                || project.environments.is_empty()
                || project.environments.len() > 20
                || project.environments.iter().any(|environment| {
                    environment.name.trim().is_empty()
                        || environment.name.len() > 512
                        || environment.revision == 0
                })
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
        member_id: scope.member_id,
    })
}

pub(super) fn validate_project_inventory(projects: &[RemoteKnowledgeProject]) -> AppResult<()> {
    if projects.len() > 1_000
        || projects.iter().any(|project| {
            project.name.is_empty()
                || project.name.len() > 512
                || project.revision == 0
                || project.environments.is_empty()
                || project.environments.len() > 100
                || project.environments.iter().any(|environment| {
                    environment.name.is_empty()
                        || environment.name.len() > 512
                        || environment.revision == 0
                })
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
                || source.visibility != "shared_graph"
                || !matches!(
                    source.sync_state.as_str(),
                    "pending" | "syncing" | "ready" | "stale" | "failed"
                )
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
        || project.environments.is_empty()
        || project.environments.len() > 100
        || project.environments.iter().any(|environment| {
            environment.name.is_empty() || environment.name.len() > 512 || environment.revision == 0
        })
    {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid updated scope".into(),
        ));
    }
    Ok(project)
}

pub(super) async fn list_current_knowledge_grants(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteKnowledgeGrant>> {
    let token = bearer(user_id).await?;
    let response = client()?
        // codeql[rust/cleartext-transmission]
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/grants?scope=mine",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading current Knowledge grants", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let grants =
        knowledge_response::<KnowledgeGrantsResponse>(response, "reading current Knowledge grants")
            .await?
            .grants;
    let now = chrono::Utc::now();
    if grants.len() > 1_000
        || grants.iter().any(|grant| {
            grant.member_id.is_empty()
                || grant.member_id.len() > 255
                || grant.environment_revision == 0
                || grant.graph_revision_ids.is_empty()
                || grant.graph_revision_ids.len() > 100
                || grant.graph_scopes.len() != grant.graph_revision_ids.len()
                || grant.expires_at <= now
                || grant.revoked_at.is_some()
                || grant
                    .graph_scopes
                    .iter()
                    .any(|scope| !grant.graph_revision_ids.contains(&scope.graph_revision_id))
        })
    {
        return Err(AppError::Network(
            "Project Knowledge returned invalid current grants".into(),
        ));
    }
    Ok(grants)
}

pub(super) async fn create_current_knowledge_grant(
    user_id: &str,
    workspace_id: Uuid,
    member_id: &str,
    project_environment_id: Uuid,
) -> AppResult<()> {
    if member_id.trim().is_empty() || member_id.len() > 255 {
        return Err(AppError::Config(
            "the Personal Knowledge member authority is invalid".into(),
        ));
    }
    let token = bearer(user_id).await?;
    let response = client()?
        // codeql[rust/cleartext-transmission]
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/grants",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&CreateKnowledgeGrantRequest {
            member_id,
            project_environment_id,
            ttl_seconds: 60 * 60,
        })
        .send()
        .await
        .map_err(|error| request_error("issuing Personal Knowledge authority", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let created = knowledge_response::<CreatedKnowledgeGrantResponse>(
        response,
        "reading Personal Knowledge authority",
    )
    .await?
    .grant;
    if created.expires_at <= chrono::Utc::now()
        || created.graph_revision_ids.is_empty()
        || created.graph_revision_ids.len() > 100
    {
        return Err(AppError::Network(
            "Personal Knowledge returned an invalid grant".into(),
        ));
    }
    let _ = created.id;
    Ok(())
}

pub(super) fn valid_remote_mapping(mapping: &KnowledgeMappingProposal) -> bool {
    mapping.schema_fingerprint.len() == 64
        && mapping
            .schema_fingerprint
            .bytes()
            .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
        && mapping.from_node_id.len() == 64
        && mapping
            .from_node_id
            .bytes()
            .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
        && !mapping.target_kind.trim().is_empty()
        && mapping.target_kind.len() <= 128
        && !mapping.target_identity.trim().is_empty()
        && mapping.target_identity.len() <= 2_048
        && !mapping.target_identity.chars().any(char::is_control)
}

pub(super) async fn propose_remote_knowledge_mapping(
    user_id: &str,
    workspace_id: Uuid,
    grant_id: Uuid,
    proposal: &KnowledgeMappingProposal,
) -> AppResult<KnowledgeMappingProposal> {
    let token = bearer(user_id).await?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/mappings",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&ProposeKnowledgeMappingRequest {
            grant_id,
            graph_revision_id: proposal.graph_revision_id,
            schema_fingerprint: &proposal.schema_fingerprint,
            from_node_id: &proposal.from_node_id,
            target_kind: &proposal.target_kind,
            target_identity: &proposal.target_identity,
        })
        .send()
        .await
        .map_err(|error| request_error("proposing a Knowledge mapping", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let mapping = knowledge_response::<KnowledgeMappingResponse>(
        response,
        "reading the Knowledge mapping proposal",
    )
    .await?
    .mapping;
    if mapping.project_environment_id != proposal.project_environment_id
        || mapping.graph_revision_id != proposal.graph_revision_id
        || mapping.schema_fingerprint != proposal.schema_fingerprint
        || mapping.from_node_id != proposal.from_node_id
        || mapping.target_kind != proposal.target_kind
        || mapping.target_identity != proposal.target_identity
        || mapping.state != MappingProposalState::Proposed
        || !valid_remote_mapping(&mapping)
    {
        return Err(AppError::Network(
            "Project Knowledge changed the mapping proposal".into(),
        ));
    }
    Ok(mapping)
}

pub(super) async fn download_knowledge_graph(
    user_id: &str,
    workspace_id: Uuid,
    grant_id: Uuid,
    source_id: Uuid,
    expected_graph_revision_id: Uuid,
) -> AppResult<GraphBuildArtifactV1> {
    let token = bearer(user_id).await?;
    let response = client()?
        // codeql[rust/cleartext-transmission]
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources/{source_id}/graph?grantId={grant_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading a granted Knowledge graph", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let downloaded: DownloadedKnowledgeGraphResponse = bounded_json_response(
        response,
        "reading a granted Knowledge graph",
        MAX_KNOWLEDGE_GRAPH_RESPONSE_BYTES,
    )
    .await?;
    // Verify the raw JSON value before typed decoding. This preserves timestamp
    // spellings while removing JSONB/object insertion order from the digest.
    let canonical_artifact = canonical_knowledge_json_bytes(&downloaded.artifact)?;
    let artifact_sha256 = hex::encode(Sha256::digest(&canonical_artifact));
    let artifact: GraphBuildArtifactV1 = serde_json::from_value(downloaded.artifact)?;
    if downloaded.graph_revision_id != expected_graph_revision_id
        || artifact.graph_revision_id != expected_graph_revision_id
        || artifact.binding.source_id != source_id
        || !knowledge_graph_artifact_size_allowed(canonical_artifact.len())
        || downloaded.artifact_sha256 != artifact_sha256
        || !artifact.validate()
    {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid granted graph".into(),
        ));
    }
    Ok(artifact)
}
