//! Trusted Desktop transport for Project Knowledge source setup.
//!
//! The renderer receives source identity and revision evidence only. GitHub App
//! installation tokens remain in the control plane, and Local Folder paths stay
//! behind this native command boundary and the OS credential store.

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use dopedb_protocol::{
    KnowledgeSourceBindingV1, KnowledgeSourceProvider, KnowledgeSourceVisibility,
    SourceRevisionIdentity,
};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::connection::keychain::{
    delete_knowledge_source_root, fetch_knowledge_source_root, store_knowledge_source_root,
};
use crate::error::{AppError, AppResult};
use crate::kernel::access::{ActiveResourceScope, WorkspaceKind};
use crate::kernel::identity::{AccountId, WorkspaceId};
use crate::state::AppState;

use super::domain::{
    EnvironmentRiskClass, Project, ProjectDefinition, ProjectEnvironment, SourceBindingDraft,
    SourceHealthState, SourceLocator, StoredKnowledgeScope,
};
use super::ports::{
    AppendKnowledgeEnvironmentRequest, CreateKnowledgeEnvironmentRequest,
    CreateKnowledgeProjectRequest, LocalKnowledgeSourcePort, RemoteGithubRepository,
    RemoteKnowledgeEnvironment, RemoteKnowledgeProject, RemoteKnowledgeSource,
};

#[path = "transport_graph.rs"]
mod graph;
#[path = "transport_projects.rs"]
mod projects;
#[path = "transport_sources.rs"]
mod sources;

pub(crate) use graph::*;
pub(crate) use projects::*;
pub(crate) use sources::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeSourceProjection {
    source_id: Uuid,
    project_id: Uuid,
    project_name: String,
    project_environment_id: Uuid,
    environment_name: String,
    environment_revision: u64,
    risk_class: EnvironmentRiskClass,
    provider: KnowledgeSourceProvider,
    display_name: String,
    visibility: KnowledgeSourceVisibility,
    revision: KnowledgeSourceRevisionProjection,
    health: SourceHealthState,
    graph_revision_id: Option<Uuid>,
    local_capability_available: bool,
}

// `SourceRevisionIdentity` is also part of the persisted graph-artifact
// protocol, where its fields intentionally use snake_case.  The desktop IPC
// contract is camelCase, so translate at this boundary instead of changing the
// protocol representation (and therefore its canonical hash).
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum KnowledgeSourceRevisionProjection {
    Github {
        repository_id: String,
        repository: String,
        ref_name: String,
        commit_sha: String,
    },
    LocalGit {
        root_fingerprint: String,
        git_root_fingerprint: String,
        ref_name: String,
        commit_sha: String,
        dirty: bool,
        worktree: bool,
    },
    LocalSnapshot {
        root_fingerprint: String,
        snapshot_sha256: String,
    },
}

impl From<SourceRevisionIdentity> for KnowledgeSourceRevisionProjection {
    fn from(revision: SourceRevisionIdentity) -> Self {
        match revision {
            SourceRevisionIdentity::Github {
                repository_id,
                repository,
                ref_name,
                commit_sha,
            } => Self::Github {
                repository_id,
                repository,
                ref_name,
                commit_sha,
            },
            SourceRevisionIdentity::LocalGit {
                root_fingerprint,
                git_root_fingerprint,
                ref_name,
                commit_sha,
                dirty,
                worktree,
            } => Self::LocalGit {
                root_fingerprint,
                git_root_fingerprint,
                ref_name,
                commit_sha,
                dirty,
                worktree,
            },
            SourceRevisionIdentity::LocalSnapshot {
                root_fingerprint,
                snapshot_sha256,
            } => Self::LocalSnapshot {
                root_fingerprint,
                snapshot_sha256,
            },
        }
    }
}

#[cfg(test)]
pub(crate) fn serialize_knowledge_source_revision_for_test(
    revision: SourceRevisionIdentity,
) -> serde_json::Value {
    serde_json::to_value(KnowledgeSourceRevisionProjection::from(revision))
        .expect("revision projection should serialize")
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateProjectInput {
    name: String,
    environments: Vec<CreateKnowledgeEnvironmentRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateEnvironmentInput {
    project_id: Uuid,
    name: String,
    risk_class: EnvironmentRiskClass,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GithubSourceInput {
    project_id: Uuid,
    project_environment_id: Uuid,
    installation_id: Uuid,
    repository_id: String,
    repository: String,
    ref_name: String,
    display_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalFolderSourceInput {
    project_id: Uuid,
    project_environment_id: Uuid,
    display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EnvironmentConnectionProjection {
    id: Uuid,
    project_environment_id: Uuid,
    environment_revision: u64,
    connection_id: Option<Uuid>,
    remote_connection_id: Option<Uuid>,
    connection_revision: i64,
    current_connection_revision: i64,
    connection_content_revision: i64,
    connection_name: String,
    role: String,
    alias: String,
    stale: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeInventoryProjection {
    projects: Vec<RemoteKnowledgeProject>,
    sources: Vec<KnowledgeSourceProjection>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BindEnvironmentConnectionInput {
    project_environment_id: Uuid,
    connection_id: Uuid,
    role: String,
    alias: String,
}

pub(super) fn selected_team_account(scope: &ActiveResourceScope) -> AppResult<AccountId> {
    if scope.workspace_kind != WorkspaceKind::Team {
        return Err(AppError::Config(
            "Project Knowledge remote access requires a Team workspace".into(),
        ));
    }
    let value = scope.selected_account_id.as_ref().ok_or_else(|| {
        AppError::Config("Project Knowledge requires a selected workspace account".into())
    })?;
    AccountId::new(value.clone())
        .ok_or_else(|| AppError::Config("the selected workspace account is invalid".into()))
}

fn selected_remote_account(scope: &ActiveResourceScope) -> AppResult<AccountId> {
    let value = scope.selected_account_id.as_ref().ok_or_else(|| {
        AppError::Config("Sign in to connect GitHub to Personal Workspace".into())
    })?;
    AccountId::new(value.clone())
        .ok_or_else(|| AppError::Config("the selected workspace account is invalid".into()))
}

struct ActiveRemoteKnowledgeScope {
    local_scope: ActiveResourceScope,
    account: AccountId,
    remote_workspace_id: Uuid,
    projects: Vec<RemoteKnowledgeProject>,
}

async fn active_remote_scope(state: &AppState) -> AppResult<ActiveRemoteKnowledgeScope> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    let account = selected_remote_account(&scope)?;
    let projects = active_project_inventory(state, &scope).await?;
    if scope.workspace_kind == WorkspaceKind::Personal {
        let remote = state
            .services
            .knowledge
            .ensure_personal_scope(account.as_str(), &projects)
            .await?;
        return Ok(ActiveRemoteKnowledgeScope {
            local_scope: scope,
            account,
            remote_workspace_id: remote.workspace_id,
            projects,
        });
    }
    Ok(ActiveRemoteKnowledgeScope {
        remote_workspace_id: scope.workspace_id,
        local_scope: scope,
        account,
        projects,
    })
}

fn project_definition(workspace_id: Uuid, project: &RemoteKnowledgeProject) -> ProjectDefinition {
    ProjectDefinition {
        project: Project {
            id: project.id,
            workspace_id: WorkspaceId::from(workspace_id),
            name: project.name.clone(),
            revision: project.revision,
        },
        environments: project
            .environments
            .iter()
            .map(|environment| ProjectEnvironment {
                id: environment.id,
                project_id: project.id,
                name: environment.name.clone(),
                risk_class: environment.risk_class,
                revision: environment.revision,
            })
            .collect(),
    }
}

fn project_projection(definition: ProjectDefinition) -> RemoteKnowledgeProject {
    RemoteKnowledgeProject {
        id: definition.project.id,
        name: definition.project.name,
        revision: definition.project.revision,
        environments: definition
            .environments
            .into_iter()
            .map(|environment| RemoteKnowledgeEnvironment {
                id: environment.id,
                name: environment.name,
                risk_class: environment.risk_class,
                revision: environment.revision,
            })
            .collect(),
    }
}

async fn fetch_active_project_inventory(
    state: &AppState,
    scope: &ActiveResourceScope,
) -> AppResult<Vec<RemoteKnowledgeProject>> {
    if scope.workspace_kind == WorkspaceKind::Personal {
        return state
            .services
            .knowledge
            .knowledge_projects(scope.workspace_id)
            .await
            .map(|projects| projects.into_iter().map(project_projection).collect());
    };
    let account = selected_team_account(scope)?;
    let projects = state
        .services
        .knowledge
        .list_remote_projects(account.as_str(), scope.workspace_id)
        .await?;
    Ok(projects)
}

async fn persist_team_project_inventory(
    state: &AppState,
    scope: &ActiveResourceScope,
    projects: &[RemoteKnowledgeProject],
) -> AppResult<()> {
    if scope.workspace_kind != WorkspaceKind::Team {
        return Ok(());
    }
    for project in projects {
        state
            .services
            .knowledge
            .save_knowledge_project(&project_definition(scope.workspace_id, project))
            .await?;
    }
    state
        .services
        .knowledge
        .retain_knowledge_projects(
            scope.workspace_id,
            &projects
                .iter()
                .map(|project| project.id)
                .collect::<Vec<_>>(),
        )
        .await?;
    Ok(())
}

// Mutation and source workflows require the local bounded copy to advance with
// the remote inventory. The list command deliberately uses the two phases
// separately so a cache write cannot hide a successfully fetched inventory.
async fn active_project_inventory(
    state: &AppState,
    scope: &ActiveResourceScope,
) -> AppResult<Vec<RemoteKnowledgeProject>> {
    let projects = fetch_active_project_inventory(state, scope).await?;
    persist_team_project_inventory(state, scope, &projects).await?;
    Ok(projects)
}

fn domain_scope(
    workspace_id: WorkspaceId,
    projects: &[RemoteKnowledgeProject],
    project_id: Uuid,
    environment_id: Uuid,
) -> AppResult<(Project, ProjectEnvironment)> {
    let remote_project = projects
        .iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| AppError::NotFound("the Project Knowledge project".into()))?;
    let remote_environment = remote_project
        .environments
        .iter()
        .find(|environment| environment.id == environment_id)
        .ok_or_else(|| AppError::NotFound("the Project Knowledge environment".into()))?;
    Ok((
        Project {
            id: remote_project.id,
            workspace_id,
            name: remote_project.name.clone(),
            revision: remote_project.revision,
        },
        ProjectEnvironment {
            id: remote_environment.id,
            project_id: remote_project.id,
            name: remote_environment.name.clone(),
            risk_class: remote_environment.risk_class,
            revision: remote_environment.revision,
        },
    ))
}

fn remote_github_binding(source: &RemoteKnowledgeSource) -> AppResult<KnowledgeSourceBindingV1> {
    let (Some(repository_id), Some(repository), Some(ref_name), Some(commit_sha)) = (
        source.repository_id.as_ref(),
        source.repository_full_name.as_ref(),
        source.ref_name.as_ref(),
        source.commit_sha.as_ref(),
    ) else {
        return Err(AppError::Network(
            "Project Knowledge omitted GitHub source identity".into(),
        ));
    };
    let binding = KnowledgeSourceBindingV1 {
        source_id: source.id,
        project_id: source.project_id,
        project_environment_id: source.project_environment_id,
        provider: KnowledgeSourceProvider::Github,
        display_name: source.display_name.clone(),
        visibility: KnowledgeSourceVisibility::SharedGraph,
        revision: SourceRevisionIdentity::Github {
            repository_id: repository_id.clone(),
            repository: repository.clone(),
            ref_name: ref_name.clone(),
            commit_sha: commit_sha.clone(),
        },
    };
    if source.provider != "github" || !binding.validate() {
        return Err(AppError::Network(
            "Project Knowledge returned invalid GitHub source identity".into(),
        ));
    }
    Ok(binding)
}

async fn project_source(
    state: &AppState,
    scope: StoredKnowledgeScope,
    remote: Option<&RemoteKnowledgeSource>,
) -> AppResult<KnowledgeSourceProjection> {
    let local_capability_available = scope.binding.provider != KnowledgeSourceProvider::LocalFolder
        || fetch_knowledge_source_root(scope.binding.source_id)
            .ok()
            .flatten()
            .is_some();
    let active_index = state
        .services
        .knowledge
        .active_for_source(scope.binding.source_id)
        .await?;
    let active_index_available = active_index.is_some();
    let (health, graph_revision_id) = match scope.binding.provider {
        KnowledgeSourceProvider::Github => (
            match remote.map(|source| source.sync_state.as_str()) {
                Some("ready") => SourceHealthState::Ready,
                Some("failed") => SourceHealthState::Failed,
                Some("stale") => SourceHealthState::Stale,
                None => SourceHealthState::Ready,
                _ => SourceHealthState::Syncing,
            },
            remote.and_then(|source| source.graph_revision_id),
        ),
        KnowledgeSourceProvider::LocalFolder
            if local_capability_available && active_index_available =>
        {
            (
                SourceHealthState::Ready,
                active_index
                    .as_ref()
                    .map(|artifact| artifact.graph_revision_id),
            )
        }
        KnowledgeSourceProvider::LocalFolder => (SourceHealthState::Stale, None),
    };
    Ok(KnowledgeSourceProjection {
        source_id: scope.binding.source_id,
        project_id: scope.project.id,
        project_name: scope.project.name,
        project_environment_id: scope.environment.id,
        environment_name: scope.environment.name,
        environment_revision: scope.environment.revision,
        risk_class: scope.environment.risk_class,
        provider: scope.binding.provider,
        display_name: scope.binding.display_name,
        visibility: scope.binding.visibility,
        revision: scope.binding.revision.into(),
        health,
        graph_revision_id,
        local_capability_available,
    })
}
