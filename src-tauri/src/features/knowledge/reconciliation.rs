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

use dopedb_protocol::{
    KnowledgeSourceBindingV1, KnowledgeSourceProvider, KnowledgeSourceVisibility,
    SourceRevisionIdentity,
};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::access::{ActiveResourceScope, WorkspaceKind};
use crate::kernel::identity::{AccountId, WorkspaceId};

use super::domain::{KnowledgeGrant, Project, ProjectDefinition, ProjectEnvironment};
use super::ports::{
    HostedKnowledgeAuthorityPort, KnowledgeRepositoryPort, RemoteKnowledgeGrant,
    RemoteKnowledgeProject, RemoteKnowledgeSource,
};

/// What one explicit hosted-authority reconciliation made locally available.
#[derive(Debug, Clone)]
pub(crate) struct KnowledgeAccessReconciliation {
    pub(crate) projects: Vec<RemoteKnowledgeProject>,
    pub(crate) grant_count: usize,
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
    let (remote_workspace_id, personal_member_id) =
        if scope.workspace_kind == WorkspaceKind::Personal {
            let remote = authority
                .ensure_personal_scope(account.as_str(), &projects)
                .await?;
            (remote.workspace_id, Some(remote.member_id))
        } else {
            (scope.workspace_id, None)
        };
    let sources = authority
        .list_sources(account.as_str(), remote_workspace_id)
        .await?;
    reconcile_sources(repository, &scope, &projects, &sources).await?;

    let mut grants = authority
        .list_current_grants(account.as_str(), remote_workspace_id)
        .await?;
    if let Some(member_id) = personal_member_id.as_deref() {
        grants = ensure_personal_grants(
            authority,
            &account,
            remote_workspace_id,
            member_id,
            &projects,
            &sources,
            grants,
        )
        .await?;
    }

    reconcile_grants(
        repository,
        authority,
        &scope,
        &account,
        remote_workspace_id,
        &projects,
        &grants,
    )
    .await?;

    let environment_binding_count = if scope.workspace_kind == WorkspaceKind::Team {
        reconcile_environment_connections(repository, authority, &scope, &account, &projects)
            .await?
    } else {
        0
    };

    Ok(KnowledgeAccessReconciliation {
        projects,
        grant_count: grants.len(),
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

async fn ensure_personal_grants<H>(
    authority: &H,
    account: &AccountId,
    remote_workspace_id: Uuid,
    member_id: &str,
    projects: &[RemoteKnowledgeProject],
    sources: &[RemoteKnowledgeSource],
    mut grants: Vec<RemoteKnowledgeGrant>,
) -> AppResult<Vec<RemoteKnowledgeGrant>>
where
    H: HostedKnowledgeAuthorityPort,
{
    let mut created = false;
    for project in projects {
        for environment in &project.environments {
            let mut graph_revision_ids = sources
                .iter()
                .filter(|source| {
                    source.project_id == project.id
                        && source.project_environment_id == environment.id
                        && source.environment_revision == environment.revision
                })
                .filter_map(|source| source.graph_revision_id)
                .collect::<Vec<_>>();
            graph_revision_ids.sort_unstable();
            graph_revision_ids.dedup();
            if graph_revision_ids.is_empty()
                || grants.iter().any(|grant| {
                    grant_matches_revision_set(
                        grant,
                        environment.id,
                        environment.revision,
                        &graph_revision_ids,
                    )
                })
            {
                continue;
            }
            authority
                .create_current_grant(
                    account.as_str(),
                    remote_workspace_id,
                    member_id,
                    environment.id,
                )
                .await?;
            created = true;
        }
    }
    if created {
        grants = authority
            .list_current_grants(account.as_str(), remote_workspace_id)
            .await?;
    }
    Ok(grants)
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
            visibility: KnowledgeSourceVisibility::SharedGraph,
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

fn grant_matches_revision_set(
    grant: &RemoteKnowledgeGrant,
    environment_id: Uuid,
    environment_revision: u64,
    expected: &[Uuid],
) -> bool {
    if grant.project_environment_id != environment_id
        || grant.environment_revision != environment_revision
    {
        return false;
    }
    let mut actual = grant.graph_revision_ids.clone();
    actual.sort_unstable();
    actual.dedup();
    actual == expected
}

async fn reconcile_grants<R, H>(
    repository: &R,
    authority: &H,
    scope: &ActiveResourceScope,
    account: &AccountId,
    remote_workspace_id: Uuid,
    projects: &[RemoteKnowledgeProject],
    grants: &[RemoteKnowledgeGrant],
) -> AppResult<()>
where
    R: KnowledgeRepositoryPort,
    H: HostedKnowledgeAuthorityPort,
{
    for project in projects {
        for environment in &project.environments {
            let allowed_graph_revision_ids = grants
                .iter()
                .filter(|grant| {
                    grant.project_environment_id == environment.id
                        && grant.environment_revision == environment.revision
                })
                .flat_map(|grant| grant.graph_revision_ids.iter().copied())
                .collect::<Vec<_>>();
            repository
                .retain_granted_environment_heads(environment.id, &allowed_graph_revision_ids)
                .await?;
        }
    }

    for grant in grants {
        let remote_project = projects
            .iter()
            .find(|project| project.id == grant.project_id)
            .ok_or_else(|| AppError::Network("Knowledge grant project is missing".into()))?;
        let remote_environment = remote_project
            .environments
            .iter()
            .find(|environment| environment.id == grant.project_environment_id)
            .filter(|environment| environment.revision == grant.environment_revision)
            .ok_or_else(|| AppError::Network("Knowledge grant environment is stale".into()))?;
        let project = Project {
            id: remote_project.id,
            workspace_id: WorkspaceId::from(scope.workspace_id),
            name: remote_project.name.clone(),
            revision: remote_project.revision,
        };
        let environment = ProjectEnvironment {
            id: remote_environment.id,
            project_id: remote_project.id,
            kind: remote_environment.kind,
            revision: remote_environment.revision,
        };
        for graph_scope in &grant.graph_scopes {
            let artifact = match repository
                .by_revision(graph_scope.graph_revision_id)
                .await?
            {
                Some(artifact) => artifact,
                None => {
                    authority
                        .download_graph(
                            account.as_str(),
                            remote_workspace_id,
                            grant.id,
                            graph_scope.source_id,
                            graph_scope.graph_revision_id,
                        )
                        .await?
                }
            };
            if artifact.binding.project_id != project.id
                || artifact.binding.project_environment_id != environment.id
                || artifact.environment_revision != environment.revision
                || artifact.binding.source_id != graph_scope.source_id
            {
                return Err(AppError::Network(
                    "Knowledge grant graph crossed its Project Environment".into(),
                ));
            }
            repository
                .save_scope(
                    &project,
                    &environment,
                    &artifact.binding,
                    artifact.environment_revision,
                )
                .await?;
            repository.import_granted_active_graph(&artifact).await?;
        }
    }

    repository
        .revoke_knowledge_grants_for_account(scope.workspace_id, account.as_str())
        .await?;
    for grant in grants {
        repository
            .save_grant(&KnowledgeGrant {
                id: grant.id,
                workspace_id: WorkspaceId::from(scope.workspace_id),
                account_id: account.clone(),
                project_id: grant.project_id,
                project_environment_id: grant.project_environment_id,
                environment_revision: grant.environment_revision,
                graph_revision_ids: grant.graph_revision_ids.clone(),
                expires_at: grant.expires_at,
            })
            .await?;
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
