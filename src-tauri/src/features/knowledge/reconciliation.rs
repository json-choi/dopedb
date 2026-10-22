//! Explicit reconciliation of hosted Knowledge authority into device-local state.
//!
//! Generic read entry points never reconcile access or mutate grants/Environment
//! bindings. Project inventory reads may refresh their bounded local copy of remote
//! Projects. Agent entry points (session start, the Agent Environment list, and
//! `dopedb agent start`) reconcile deliberately, and only when they consume hosted
//! authority: Team access, or a selected hosted source. Personal databases stay
//! device-owned even with a selected account. A required sync that fails is never
//! turned into an offline fallback.

use std::collections::BTreeSet;

use dopedb_protocol::{KnowledgeSourceBindingV1, KnowledgeSourceProvider, SourceRevisionIdentity};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::access::{ActiveResourceScope, WorkspaceKind};
use crate::kernel::identity::{AccountId, WorkspaceId};

use super::domain::{Project, ProjectDefinition, ProjectEnvironment};
use super::ports::{
    HostedKnowledgeAuthorityPort, KnowledgeRepositoryPort, RemoteKnowledgeProject,
    RemoteKnowledgeSource,
};

/// What one explicit hosted-authority reconciliation made locally available.
#[derive(Debug, Clone)]
pub(crate) struct KnowledgeAccessReconciliation {
    pub(crate) projects: Vec<RemoteKnowledgeProject>,
    pub(crate) environment_binding_count: usize,
}

pub(crate) async fn reconcile_current_access<R, H>(
    repository: &R,
    authority: &H,
) -> AppResult<KnowledgeAccessReconciliation>
where
    R: KnowledgeRepositoryPort,
    H: HostedKnowledgeAuthorityPort,
{
    let scope = repository.active_resource_scope().await?;
    let account = selected_remote_account(&scope)?;
    let projects = project_inventory(repository, authority, &scope, &account).await?;
    let remote_workspace_id = if scope.workspace_kind == WorkspaceKind::Personal {
        authority
            .ensure_personal_scope(account.as_str(), &projects)
            .await?
            .workspace_id
    } else {
        scope.workspace_id
    };
    let sources = authority
        .list_sources(account.as_str(), remote_workspace_id)
        .await?;
    reconcile_sources(repository, &scope, &projects, &sources).await?;

    let environment_binding_count = if scope.workspace_kind == WorkspaceKind::Team {
        reconcile_environment_connections(repository, authority, &scope, &account, &projects)
            .await?
    } else {
        0
    };

    Ok(KnowledgeAccessReconciliation {
        projects,
        environment_binding_count,
    })
}

/// Whether an Agent entry point consumes hosted authority and so must reconcile
/// first. Team access is always hosted-governed; Personal access depends on hosted
/// grants only through a selected hosted (GitHub) source.
pub(crate) fn agent_entry_requires_hosted_reconciliation(
    kind: WorkspaceKind,
    selects_hosted_source: bool,
) -> bool {
    kind == WorkspaceKind::Team || selects_hosted_source
}

fn selected_remote_account(scope: &ActiveResourceScope) -> AppResult<AccountId> {
    let value = scope
        .selected_account_id
        .as_ref()
        .ok_or_else(|| AppError::Config("Sign in to refresh hosted Project Knowledge".into()))?;
    AccountId::new(value.clone())
        .ok_or_else(|| AppError::Config("the selected workspace account is invalid".into()))
}

async fn project_inventory<R, H>(
    repository: &R,
    authority: &H,
    scope: &ActiveResourceScope,
    account: &AccountId,
) -> AppResult<Vec<RemoteKnowledgeProject>>
where
    R: KnowledgeRepositoryPort,
    H: HostedKnowledgeAuthorityPort,
{
    if scope.workspace_kind == WorkspaceKind::Personal {
        return repository
            .knowledge_projects(scope.workspace_id)
            .await
            .map(|projects| projects.into_iter().map(project_projection).collect());
    }
    let projects = authority
        .list_projects(account.as_str(), scope.workspace_id)
        .await?;
    for project in &projects {
        repository
            .save_knowledge_project(&project_definition(scope.workspace_id, project))
            .await?;
    }
    repository
        .retain_knowledge_projects(
            scope.workspace_id,
            &projects
                .iter()
                .map(|project| project.id)
                .collect::<Vec<_>>(),
        )
        .await?;
    Ok(projects)
}

async fn reconcile_sources<R>(
    repository: &R,
    scope: &ActiveResourceScope,
    projects: &[RemoteKnowledgeProject],
    sources: &[RemoteKnowledgeSource],
) -> AppResult<()>
where
    R: KnowledgeRepositoryPort,
{
    let mut remote_ids = BTreeSet::new();
    for source in sources {
        let remote_project = projects
            .iter()
            .find(|project| project.id == source.project_id)
            .ok_or_else(|| AppError::Network("Knowledge source project is missing".into()))?;
        let remote_environment = remote_project
            .environments
            .iter()
            .find(|environment| environment.id == source.project_environment_id)
            .filter(|environment| environment.revision == source.environment_revision)
            .ok_or_else(|| AppError::Network("Knowledge source environment is stale".into()))?;
        let (Some(repository_id), Some(repository_name), Some(ref_name), Some(commit_sha)) = (
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
            revision: SourceRevisionIdentity::Github {
                repository_id: repository_id.clone(),
                repository: repository_name.clone(),
                ref_name: ref_name.clone(),
                commit_sha: commit_sha.clone(),
            },
        };
        if source.provider != "github" || !binding.validate() {
            return Err(AppError::Network(
                "Project Knowledge returned invalid GitHub source identity".into(),
            ));
        }
        repository
            .save_scope(
                &Project {
                    id: remote_project.id,
                    workspace_id: WorkspaceId::from(scope.workspace_id),
                    name: remote_project.name.clone(),
                    revision: remote_project.revision,
                },
                &ProjectEnvironment {
                    id: remote_environment.id,
                    project_id: remote_project.id,
                    kind: remote_environment.kind,
                    revision: remote_environment.revision,
                },
                &binding,
                remote_environment.revision,
            )
            .await?;
        remote_ids.insert(source.id);
    }
    for local in repository.scopes(scope.workspace_id).await? {
        if local.binding.provider == KnowledgeSourceProvider::Github
            && !remote_ids.contains(&local.binding.source_id)
        {
            repository.remove_scope(local.binding.source_id).await?;
        }
    }
    Ok(())
}

async fn reconcile_environment_connections<R, H>(
    repository: &R,
    authority: &H,
    scope: &ActiveResourceScope,
    account: &AccountId,
    projects: &[RemoteKnowledgeProject],
) -> AppResult<usize>
where
    R: KnowledgeRepositoryPort,
    H: HostedKnowledgeAuthorityPort,
{
    let mut reconciled = 0;
    for project in projects {
        for environment in &project.environments {
            let remote = authority
                .list_environment_connections(
                    account.as_str(),
                    scope.workspace_id,
                    Some(environment.id),
                )
                .await?;
            let remote_ids = remote
                .iter()
                .map(|binding| binding.id)
                .collect::<BTreeSet<_>>();
            let local = repository
                .environment_connections(scope.workspace_id, Some(environment.id))
                .await?;
            let local_ids = local
                .iter()
                .map(|binding| binding.id)
                .collect::<BTreeSet<_>>();
            for binding in local {
                if !remote_ids.contains(&binding.id) {
                    repository
                        .revoke_environment_connection(scope.workspace_id, binding.id)
                        .await?;
                }
            }

            for binding in remote {
                if binding.project_environment_id != environment.id
                    || binding.environment_revision != environment.revision
                {
                    return Err(AppError::Network(
                        "Knowledge Environment connection crossed its revision".into(),
                    ));
                }
                let local_connection_id = repository
                    .local_connection_id_for_remote(scope.workspace_id, binding.connection_id)
                    .await?;
                let Some(local_connection_id) = local_connection_id else {
                    if local_ids.contains(&binding.id) {
                        repository
                            .revoke_environment_connection(scope.workspace_id, binding.id)
                            .await?;
                    }
                    continue;
                };
                if binding.stale
                    || binding.connection_revision != binding.current_connection_revision
                {
                    if local_ids.contains(&binding.id) {
                        repository
                            .revoke_environment_connection(scope.workspace_id, binding.id)
                            .await?;
                    }
                    continue;
                }
                let connection = repository
                    .pin_connection_for_read(local_connection_id)
                    .await?;
                if connection.scope.workspace_id != scope.workspace_id
                    || connection.scope.generation != scope.generation
                    || connection.connection_revision != binding.connection_revision
                {
                    if local_ids.contains(&binding.id) {
                        repository
                            .revoke_environment_connection(scope.workspace_id, binding.id)
                            .await?;
                    }
                    continue;
                }
                repository
                    .bind_environment_connection(
                        binding.id,
                        &connection,
                        environment.id,
                        &binding.role,
                        &binding.alias,
                    )
                    .await?;
                reconciled += 1;
            }
        }
    }
    Ok(reconciled)
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
                kind: environment.kind,
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
            .map(|environment| super::ports::RemoteKnowledgeEnvironment {
                id: environment.id,
                kind: environment.kind,
                revision: environment.revision,
            })
            .collect(),
    }
}
