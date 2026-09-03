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
    RemoteKnowledgeGrant, RemoteKnowledgeInventory, RemoteKnowledgeProject, RemoteKnowledgeSource,
    RemotePersonalKnowledgeScope, RemoteSourceReadResult, RemoteSourceSearchResult,
};
use crate::hosted_control_plane::{
    bounded_json_response, client, origin, request_error, response_error as oauth_error,
};
use dopedb_protocol::{
    canonical_knowledge_json_bytes, knowledge_graph_artifact_size_allowed, GraphBuildArtifactV1,
    MAX_KNOWLEDGE_GRAPH_RESPONSE_BYTES,
};
use sha2::{Digest, Sha256};

#[path = "hosted_projects.rs"]
mod projects;
#[path = "hosted_sources.rs"]
mod sources;

use projects::*;
use sources::*;

const MAX_KNOWLEDGE_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_KNOWLEDGE_INVENTORY_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PersonalKnowledgeScopeRequest<'a> {
    projects: &'a [RemoteKnowledgeProject],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteKnowledgeProjectRequest {
    expected_revision: u64,
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

async fn bearer(user_id: &str) -> AppResult<Zeroizing<String>> {
    fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config("Project Knowledge requires an authenticated session".into())
        })
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

    fn delete_project(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        project_id: Uuid,
        expected_revision: u64,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send {
        delete_knowledge_project(account_id, workspace_id, project_id, expected_revision)
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

    fn propose_mapping(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        grant_id: Uuid,
        proposal: &KnowledgeMappingProposal,
    ) -> impl std::future::Future<Output = AppResult<KnowledgeMappingProposal>> + Send {
        propose_remote_knowledge_mapping(account_id, workspace_id, grant_id, proposal)
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
        environment_id: Option<Uuid>,
    ) -> impl std::future::Future<Output = AppResult<Vec<RemoteEnvironmentConnectionBinding>>> + Send
    {
        list_environment_connections(account_id, workspace_id, environment_id)
    }

    fn list_inventory(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<RemoteKnowledgeInventory>> + Send {
        list_knowledge_inventory(account_id, workspace_id)
    }

    fn bind_environment_connection(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
        binding_id: Uuid,
        connection_id: Uuid,
        expected_connection_revision: i64,
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
            expected_connection_revision,
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

    fn delete_source(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send {
        delete_knowledge_source(account_id, workspace_id, source_id)
    }
}
