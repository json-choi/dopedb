//! Hosted Project Knowledge authority adapter. Tokens remain in the OS credential store;
//! source content is returned only for an exact workspace/source/revision request.

use reqwest::Url;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::connection::keychain::fetch_workspace_session;
use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::{KnowledgeMappingProposal, MappingProposalState};
use crate::features::knowledge::ports::{
    AppendKnowledgeEnvironmentRequest, CreateKnowledgeProjectRequest, CreateKnowledgeSourceRequest,
    CreatedKnowledgeSource, HostedKnowledgeAuthorityPort, PinnedSourceReadRequest,
    PinnedSourceSearchRequest, RemoteEnvironmentConnectionBinding, RemoteGithubRepository,
    RemoteKnowledgeGrant, RemoteKnowledgeProject, RemoteKnowledgeSource,
    RemoteKnowledgeSyncProgress, RemotePersonalKnowledgeScope, RemoteSourceReadResult,
    RemoteSourceSearchResult,
};
use crate::hosted_control_plane::{
    bounded_json_response, client, origin, request_error, response_error as oauth_error,
};
use dopedb_protocol::{
    canonical_knowledge_json_bytes, knowledge_graph_artifact_size_allowed, GraphBuildArtifactV1,
    MAX_KNOWLEDGE_GRAPH_RESPONSE_BYTES,
};
use sha2::{Digest, Sha256};

const MAX_KNOWLEDGE_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
async fn knowledge_response<T: DeserializeOwned>(
    response: reqwest::Response,
    action: &str,
) -> AppResult<T> {
    bounded_json_response(response, action, MAX_KNOWLEDGE_RESPONSE_BYTES).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GithubInstallationInventory {
    installation_id: Uuid,
    account_login: String,
    repositories: Vec<GithubRepositoryProjection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GithubRepositoryProjection {
    id: String,
    full_name: String,
    default_branch: String,
    private: bool,
    archived: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GithubRepositoryResponse {
    installations: Vec<GithubInstallationInventory>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreatedKnowledgeSourceResponse {
    source: CreatedKnowledgeSource,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueuedKnowledgeSourceResponse {
    queued: bool,
    job_id: Uuid,
    graph_revision_id: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelledKnowledgeSourceResponse {
    cancelled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoteKnowledgeSourcesResponse {
    sources: Vec<RemoteKnowledgeSource>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceReadRequest<'a> {
    environment_id: Uuid,
    environment_revision: u64,
    connection_id: Uuid,
    connection_revision: i64,
    commit_sha: &'a str,
    path: &'a str,
    line_start: u32,
    line_end: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoteKnowledgeSyncProgressResponse {
    progress: Vec<RemoteKnowledgeSyncProgress>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PersonalKnowledgeScopeRequest<'a> {
    projects: &'a [RemoteKnowledgeProject],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersonalKnowledgeScopeResponse {
    workspace_id: Uuid,
    member_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KnowledgeGrantsResponse {
    grants: Vec<RemoteKnowledgeGrant>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateKnowledgeGrantRequest<'a> {
    member_id: &'a str,
    project_environment_id: Uuid,
    ttl_seconds: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreatedKnowledgeGrantResponse {
    grant: CreatedKnowledgeGrant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreatedKnowledgeGrant {
    id: Uuid,
    expires_at: chrono::DateTime<chrono::Utc>,
    graph_revision_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KnowledgeMappingsResponse {
    mappings: Vec<KnowledgeMappingProposal>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KnowledgeMappingResponse {
    mapping: KnowledgeMappingProposal,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProposeKnowledgeMappingRequest<'a> {
    grant_id: Uuid,
    graph_revision_id: Uuid,
    schema_fingerprint: &'a str,
    from_node_id: &'a str,
    target_kind: &'a str,
    target_identity: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecideKnowledgeMappingRequest<'a> {
    mapping_id: Uuid,
    expected_graph_revision_id: Uuid,
    decision: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DownloadedKnowledgeGraphResponse {
    graph_revision_id: Uuid,
    artifact_sha256: String,
    artifact: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KnowledgeProjectsResponse {
    projects: Vec<RemoteKnowledgeProject>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreatedKnowledgeProjectResponse {
    project: RemoteKnowledgeProject,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvironmentConnectionBindingsResponse {
    bindings: Vec<RemoteEnvironmentConnectionBinding>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvironmentConnectionBindingResponse {
    binding: RemoteEnvironmentConnectionBinding,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GithubInstallResponse {
    authorization_url: String,
}

fn bearer(user_id: &str) -> AppResult<Zeroizing<String>> {
    fetch_workspace_session(user_id)?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config("Project Knowledge requires an authenticated session".into())
        })
}

async fn ensure_personal_knowledge_scope(
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
    let token = bearer(user_id)?;
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

async fn list_knowledge_projects(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteKnowledgeProject>> {
    let token = bearer(user_id)?;
    let response = client()?
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
    Ok(projects)
}

async fn create_knowledge_project(
    user_id: &str,
    workspace_id: Uuid,
    request: &CreateKnowledgeProjectRequest,
) -> AppResult<RemoteKnowledgeProject> {
    let token = bearer(user_id)?;
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

async fn create_knowledge_environment(
    user_id: &str,
    workspace_id: Uuid,
    project_id: Uuid,
    request: &AppendKnowledgeEnvironmentRequest,
) -> AppResult<RemoteKnowledgeProject> {
    let token = bearer(user_id)?;
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

async fn list_current_knowledge_grants(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteKnowledgeGrant>> {
    let token = bearer(user_id)?;
    let response = client()?
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

async fn create_current_knowledge_grant(
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
    let token = bearer(user_id)?;
    let response = client()?
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

fn valid_remote_mapping(mapping: &KnowledgeMappingProposal) -> bool {
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

async fn list_remote_knowledge_mappings(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<KnowledgeMappingProposal>> {
    let token = bearer(user_id)?;
    let response = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/mappings",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Knowledge mappings", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let mappings =
        knowledge_response::<KnowledgeMappingsResponse>(response, "reading Knowledge mappings")
            .await?
            .mappings;
    if mappings.len() > 10_000
        || mappings
            .iter()
            .any(|mapping| !valid_remote_mapping(mapping))
    {
        return Err(AppError::Network(
            "Project Knowledge returned invalid mappings".into(),
        ));
    }
    Ok(mappings)
}

async fn propose_remote_knowledge_mapping(
    user_id: &str,
    workspace_id: Uuid,
    grant_id: Uuid,
    proposal: &KnowledgeMappingProposal,
) -> AppResult<KnowledgeMappingProposal> {
    let token = bearer(user_id)?;
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

async fn decide_remote_knowledge_mapping(
    user_id: &str,
    workspace_id: Uuid,
    mapping_id: Uuid,
    expected_graph_revision_id: Uuid,
    decision: MappingProposalState,
) -> AppResult<()> {
    let decision = match decision {
        MappingProposalState::Approved => "approved",
        MappingProposalState::Rejected => "rejected",
        _ => {
            return Err(AppError::Config(
                "a remote Knowledge mapping decision must be final".into(),
            ));
        }
    };
    let token = bearer(user_id)?;
    let response = client()?
        .patch(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/mappings",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&DecideKnowledgeMappingRequest {
            mapping_id,
            expected_graph_revision_id,
            decision,
        })
        .send()
        .await
        .map_err(|error| request_error("deciding a Knowledge mapping", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    Ok(())
}

async fn download_knowledge_graph(
    user_id: &str,
    workspace_id: Uuid,
    grant_id: Uuid,
    source_id: Uuid,
    expected_graph_revision_id: Uuid,
) -> AppResult<GraphBuildArtifactV1> {
    let token = bearer(user_id)?;
    let response = client()?
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

async fn list_environment_connections(
    user_id: &str,
    workspace_id: Uuid,
    environment_id: Uuid,
) -> AppResult<Vec<RemoteEnvironmentConnectionBinding>> {
    let token = bearer(user_id)?;
    let response = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/environments/{environment_id}/connections",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Environment connections", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let bindings = knowledge_response::<EnvironmentConnectionBindingsResponse>(
        response,
        "reading Environment connections",
    )
    .await?
    .bindings;
    if bindings.len() > 1_000
        || bindings.iter().any(|binding| {
            binding.project_environment_id != environment_id
                || binding.environment_revision == 0
                || binding.connection_revision <= 0
                || binding.current_connection_revision <= 0
                || binding.connection_name.is_empty()
                || binding.connection_name.len() > 512
                || binding.role.is_empty()
                || binding.role.len() > 64
                || binding.alias.is_empty()
                || binding.alias.len() > 128
                || binding.stale
                    != (binding.connection_revision != binding.current_connection_revision)
        })
    {
        return Err(AppError::Network(
            "Project Knowledge returned invalid Environment connections".into(),
        ));
    }
    Ok(bindings)
}

#[allow(clippy::too_many_arguments)]
async fn bind_environment_connection(
    user_id: &str,
    workspace_id: Uuid,
    environment_id: Uuid,
    binding_id: Uuid,
    connection_id: Uuid,
    role: &str,
    alias: &str,
) -> AppResult<RemoteEnvironmentConnectionBinding> {
    let token = bearer(user_id)?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/environments/{environment_id}/connections",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({
            "bindingId": binding_id,
            "connectionId": connection_id,
            "role": role,
            "alias": alias,
        }))
        .send()
        .await
        .map_err(|error| request_error("binding an Environment connection", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let binding = knowledge_response::<EnvironmentConnectionBindingResponse>(
        response,
        "reading an Environment connection binding",
    )
    .await?
    .binding;
    if binding.project_environment_id != environment_id || binding.connection_id != connection_id {
        return Err(AppError::Network(
            "Project Knowledge changed Environment connection identity".into(),
        ));
    }
    Ok(binding)
}

async fn revoke_environment_connection(
    user_id: &str,
    workspace_id: Uuid,
    environment_id: Uuid,
    binding_id: Uuid,
) -> AppResult<()> {
    let token = bearer(user_id)?;
    let response = client()?
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/environments/{environment_id}/connections",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({ "bindingId": binding_id }))
        .send()
        .await
        .map_err(|error| request_error("removing an Environment connection", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    Ok(())
}

async fn begin_knowledge_github_install(user_id: &str, workspace_id: Uuid) -> AppResult<String> {
    let token = bearer(user_id)?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/github/install",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({}))
        .send()
        .await
        .map_err(|error| request_error("starting GitHub Knowledge installation", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let url = knowledge_response::<GithubInstallResponse>(
        response,
        "reading GitHub Knowledge installation",
    )
    .await?
    .authorization_url;
    let parsed = Url::parse(&url)
        .map_err(|_| AppError::Network("GitHub Knowledge returned an invalid URL".into()))?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.path().starts_with("/apps/")
        || !parsed.path().ends_with("/installations/new")
    {
        return Err(AppError::Network(
            "GitHub Knowledge returned an unsafe installation URL".into(),
        ));
    }
    Ok(url)
}

async fn list_knowledge_github_repositories(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteGithubRepository>> {
    let token = bearer(user_id)?;
    let response = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/github/repositories",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading GitHub Knowledge repositories", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let body: GithubRepositoryResponse =
        knowledge_response(response, "reading GitHub Knowledge repositories").await?;
    let mut repositories = Vec::new();
    for installation in body.installations {
        if installation.account_login.is_empty() || installation.account_login.len() > 255 {
            return Err(AppError::Network(
                "GitHub Knowledge returned an invalid installation".into(),
            ));
        }
        for repository in installation.repositories {
            if repositories.len() >= 1_000
                || repository.id.is_empty()
                || repository.id.len() > 32
                || repository.full_name.len() > 512
                || repository.default_branch.len() > 255
            {
                return Err(AppError::Network(
                    "GitHub Knowledge returned an invalid repository inventory".into(),
                ));
            }
            repositories.push(RemoteGithubRepository {
                installation_id: installation.installation_id,
                account_login: installation.account_login.clone(),
                id: repository.id,
                full_name: repository.full_name,
                default_branch: repository.default_branch,
                private: repository.private,
                archived: repository.archived,
            });
        }
    }
    Ok(repositories)
}

async fn create_knowledge_source(
    user_id: &str,
    workspace_id: Uuid,
    request: &CreateKnowledgeSourceRequest<'_>,
) -> AppResult<CreatedKnowledgeSource> {
    let token = bearer(user_id)?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(request)
        .send()
        .await
        .map_err(|error| request_error("creating a Project Knowledge source", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let created = knowledge_response::<CreatedKnowledgeSourceResponse>(
        response,
        "reading the Project Knowledge source",
    )
    .await?
    .source;
    if created.id != request.source_id
        || created.sync_revision == 0
        || created.environment_revision == 0
        || created.commit_sha.as_ref().is_some_and(|value| {
            value.len() != 40 || !value.chars().all(|character| character.is_ascii_hexdigit())
        })
    {
        return Err(AppError::Network(
            "Project Knowledge changed source identity".into(),
        ));
    }
    Ok(created)
}

async fn list_remote_knowledge_sources(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteKnowledgeSource>> {
    let token = bearer(user_id)?;
    let response = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading workspace Knowledge sources", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let sources = knowledge_response::<RemoteKnowledgeSourcesResponse>(
        response,
        "reading workspace Knowledge sources",
    )
    .await?
    .sources;
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
    Ok(sources)
}

fn safe_source_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4_096
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

async fn search_remote_source(
    request: &PinnedSourceSearchRequest<'_>,
) -> AppResult<RemoteSourceSearchResult> {
    let authority = &request.authority;
    let source = authority.source;
    let limit = request.limit;
    let token = bearer(authority.account_id)?;
    let mut url = Url::parse(&format!(
        "{}/api/v1/workspaces/{}/knowledge/sources/{}/browse",
        origin()?,
        authority.workspace_id,
        source.source_id,
    ))
    .map_err(|_| AppError::Config("invalid hosted source browse URL".into()))?;
    url.query_pairs_mut()
        .append_pair("environmentId", &authority.environment_id.to_string())
        .append_pair(
            "environmentRevision",
            &authority.environment_revision.to_string(),
        )
        .append_pair("connectionId", &authority.connection_id.to_string())
        .append_pair(
            "connectionRevision",
            &authority.connection_revision.to_string(),
        )
        .append_pair("commitSha", &source.commit_sha)
        .append_pair("query", request.query)
        .append_pair("limit", &limit.to_string());
    let response = client()?
        .get(url)
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("searching the pinned GitHub source", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let result: RemoteSourceSearchResult =
        knowledge_response(response, "reading the pinned GitHub source tree").await?;
    if result.source_id != source.source_id
        || result.repository != source.repository
        || result.ref_name != source.ref_name
        || result.commit_sha != source.commit_sha
        || result.file_count > 100_000
        || result.matches.len() > usize::try_from(limit).unwrap_or(usize::MAX)
        || result.total_matches > result.file_count
        || result.truncated != (result.total_matches > result.matches.len() as u64)
        || result.matches.iter().any(|item| {
            !safe_source_path(&item.path)
                || item.blob_sha.len() != 40
                || !item.blob_sha.bytes().all(|byte| byte.is_ascii_hexdigit())
                || item.bytes > 16 * 1024 * 1024
        })
    {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid GitHub source tree".into(),
        ));
    }
    Ok(result)
}

async fn read_remote_source(
    request: &PinnedSourceReadRequest<'_>,
) -> AppResult<RemoteSourceReadResult> {
    let authority = &request.authority;
    let source = authority.source;
    let token = bearer(authority.account_id)?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{}/knowledge/sources/{}/browse",
            origin()?,
            authority.workspace_id,
            source.source_id,
        ))
        .bearer_auth(token.as_str())
        .json(&SourceReadRequest {
            environment_id: authority.environment_id,
            environment_revision: authority.environment_revision,
            connection_id: authority.connection_id,
            connection_revision: authority.connection_revision,
            commit_sha: &source.commit_sha,
            path: request.path,
            line_start: request.line_start,
            line_end: request.line_end,
        })
        .send()
        .await
        .map_err(|error| request_error("reading the pinned GitHub source", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let result: RemoteSourceReadResult =
        knowledge_response(response, "reading the pinned GitHub source file").await?;
    if result.source_id != source.source_id
        || result.repository != source.repository
        || result.commit_sha != source.commit_sha
        || result.path != request.path
        || !safe_source_path(&result.path)
        || result.blob_sha.len() != 40
        || !result.blob_sha.bytes().all(|byte| byte.is_ascii_hexdigit())
        || result.bytes > 1024 * 1024
        || result.line_start == 0
        || result.line_end < result.line_start.saturating_sub(1)
        || result.line_end > request.line_end
        || result.total_lines < result.line_end
        || result.text.len() > 128 * 1024
        || result.text.contains('\0')
    {
        return Err(AppError::Network(
            "Project Knowledge returned an invalid GitHub source file".into(),
        ));
    }
    Ok(result)
}

async fn list_remote_knowledge_source_sync_progress(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Vec<RemoteKnowledgeSyncProgress>> {
    let token = bearer(user_id)?;
    let response = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/source-sync-progress",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading workspace Knowledge sync progress", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let progress = knowledge_response::<RemoteKnowledgeSyncProgressResponse>(
        response,
        "reading workspace Knowledge sync progress",
    )
    .await?
    .progress;
    if progress.len() > 512 || progress.iter().any(|item| !item.validate()) {
        return Err(AppError::Network(
            "Project Knowledge returned invalid sync progress".into(),
        ));
    }
    Ok(progress)
}

async fn request_knowledge_source_sync(
    user_id: &str,
    workspace_id: Uuid,
    source_id: Uuid,
) -> AppResult<Option<Uuid>> {
    let token = bearer(user_id)?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources/{source_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({}))
        .send()
        .await
        .map_err(|error| request_error("queueing the workspace code index", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let queued: QueuedKnowledgeSourceResponse =
        knowledge_response(response, "reading the queued workspace code index").await?;
    if !queued.queued {
        return Err(AppError::Network(
            "Project Knowledge did not queue the code index".into(),
        ));
    }
    let _ = queued.job_id;
    Ok(queued.graph_revision_id)
}

/// Ask the control plane to stop the queued or claimed code index for this
/// source. The queue supersedes the job and discards its partial index, so the
/// hosted worker cannot advance it any further and the source returns to `stale`.
async fn cancel_knowledge_source_sync(
    user_id: &str,
    workspace_id: Uuid,
    source_id: Uuid,
) -> AppResult<bool> {
    let token = bearer(user_id)?;
    let response = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources/{source_id}/cancel",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .json(&json!({}))
        .send()
        .await
        .map_err(|error| request_error("cancelling the workspace code index", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let cancelled: CancelledKnowledgeSourceResponse =
        knowledge_response(response, "reading the cancelled workspace code index").await?;
    Ok(cancelled.cancelled)
}

async fn delete_knowledge_source(
    user_id: &str,
    workspace_id: Uuid,
    source_id: Uuid,
) -> AppResult<()> {
    let token = bearer(user_id)?;
    let response = client()?
        .delete(format!(
            "{}/api/v1/workspaces/{workspace_id}/knowledge/sources/{source_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("revoking a Project Knowledge source", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    Ok(())
}

/// Production hosted-authority adapter. All provider HTTP traffic, session-token
/// lookup, response byte limits, and wire validation terminate in this module.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct HostedKnowledgeAuthority;

impl HostedKnowledgeAuthorityPort for HostedKnowledgeAuthority {
    fn ensure_personal_scope(
        &self,
        account_id: &str,
        projects: &[RemoteKnowledgeProject],
    ) -> impl std::future::Future<Output = AppResult<RemotePersonalKnowledgeScope>> + Send {
        ensure_personal_knowledge_scope(account_id, projects)
    }

    fn list_projects(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<RemoteKnowledgeProject>>> + Send {
        list_knowledge_projects(account_id, workspace_id)
    }

    fn create_project(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        request: &CreateKnowledgeProjectRequest,
    ) -> impl std::future::Future<Output = AppResult<RemoteKnowledgeProject>> + Send {
        create_knowledge_project(account_id, workspace_id, request)
    }

    fn create_environment(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        project_id: Uuid,
        request: &AppendKnowledgeEnvironmentRequest,
    ) -> impl std::future::Future<Output = AppResult<RemoteKnowledgeProject>> + Send {
        create_knowledge_environment(account_id, workspace_id, project_id, request)
    }

    fn list_current_grants(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<RemoteKnowledgeGrant>>> + Send {
        list_current_knowledge_grants(account_id, workspace_id)
    }

    fn create_current_grant(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        member_id: &str,
        environment_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send {
        create_current_knowledge_grant(account_id, workspace_id, member_id, environment_id)
    }

    fn list_mappings(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<KnowledgeMappingProposal>>> + Send {
        list_remote_knowledge_mappings(account_id, workspace_id)
    }

    fn propose_mapping(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        grant_id: Uuid,
        proposal: &KnowledgeMappingProposal,
    ) -> impl std::future::Future<Output = AppResult<KnowledgeMappingProposal>> + Send {
        propose_remote_knowledge_mapping(account_id, workspace_id, grant_id, proposal)
    }

    fn decide_mapping(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        mapping_id: Uuid,
        expected_graph_revision_id: Uuid,
        decision: MappingProposalState,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send {
        decide_remote_knowledge_mapping(
            account_id,
            workspace_id,
            mapping_id,
            expected_graph_revision_id,
            decision,
        )
    }

    fn download_graph(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        grant_id: Uuid,
        source_id: Uuid,
        expected_graph_revision_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<GraphBuildArtifactV1>> + Send {
        download_knowledge_graph(
            account_id,
            workspace_id,
            grant_id,
            source_id,
            expected_graph_revision_id,
        )
    }

    fn list_environment_connections(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<RemoteEnvironmentConnectionBinding>>> + Send
    {
        list_environment_connections(account_id, workspace_id, environment_id)
    }

    fn bind_environment_connection(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
        binding_id: Uuid,
        connection_id: Uuid,
        role: &str,
        alias: &str,
    ) -> impl std::future::Future<Output = AppResult<RemoteEnvironmentConnectionBinding>> + Send
    {
        bind_environment_connection(
            account_id,
            workspace_id,
            environment_id,
            binding_id,
            connection_id,
            role,
            alias,
        )
    }

    fn revoke_environment_connection(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
        binding_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send {
        revoke_environment_connection(account_id, workspace_id, environment_id, binding_id)
    }

    fn begin_github_install(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<String>> + Send {
        begin_knowledge_github_install(account_id, workspace_id)
    }

    fn list_github_repositories(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<RemoteGithubRepository>>> + Send {
        list_knowledge_github_repositories(account_id, workspace_id)
    }

    fn create_source(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        request: &CreateKnowledgeSourceRequest<'_>,
    ) -> impl std::future::Future<Output = AppResult<CreatedKnowledgeSource>> + Send {
        create_knowledge_source(account_id, workspace_id, request)
    }

    fn list_sources(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<RemoteKnowledgeSource>>> + Send {
        list_remote_knowledge_sources(account_id, workspace_id)
    }

    fn search_source(
        &self,
        request: &PinnedSourceSearchRequest<'_>,
    ) -> impl std::future::Future<Output = AppResult<RemoteSourceSearchResult>> + Send {
        search_remote_source(request)
    }

    fn read_source(
        &self,
        request: &PinnedSourceReadRequest<'_>,
    ) -> impl std::future::Future<Output = AppResult<RemoteSourceReadResult>> + Send {
        read_remote_source(request)
    }

    fn list_source_sync_progress(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<RemoteKnowledgeSyncProgress>>> + Send {
        list_remote_knowledge_source_sync_progress(account_id, workspace_id)
    }

    fn request_source_sync(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Option<Uuid>>> + Send {
        request_knowledge_source_sync(account_id, workspace_id, source_id)
    }

    fn cancel_source_sync(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send {
        cancel_knowledge_source_sync(account_id, workspace_id, source_id)
    }

    fn delete_source(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send {
        delete_knowledge_source(account_id, workspace_id, source_id)
    }
}
