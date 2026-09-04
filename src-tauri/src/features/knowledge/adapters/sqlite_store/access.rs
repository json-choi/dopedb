//! Agent access scope and Project Environment connection bindings.

use chrono::Utc;
use dopedb_protocol::GraphBuildArtifactV1;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::{
    validate_environment_connection_label, EnvironmentConnectionBinding,
    KnowledgeEnvironmentSummary, KnowledgeSessionConnection, KnowledgeSessionScope,
    KnowledgeSessionSource,
};
use crate::kernel::access::{AccountScope, PinnedConnection};
use crate::kernel::identity::WorkspaceId;
use crate::store::{parse_uuid, Store};

use super::codec::{parse_risk_class, u64_to_i64, EnvironmentConnectionRow};

const MAX_WORKSPACE_BINDING_INVENTORY: usize = 10_000;

impl Store {
    async fn github_session_sources(
        &self,
        project_environment_id: Uuid,
        environment_revision: u64,
    ) -> AppResult<Vec<KnowledgeSessionSource>> {
        let bindings: Vec<String> = sqlx::query_scalar(
            "SELECT binding_json
             FROM knowledge_sources
             WHERE project_environment_id = ?1
               AND environment_revision = ?2
               AND provider = 'github'
               AND revoked_at IS NULL
             ORDER BY id",
        )
        .bind(project_environment_id.to_string())
        .bind(u64_to_i64(environment_revision, "environment revision")?)
        .fetch_all(self.pool())
        .await?;
        if bindings.len() > 100 {
            return Err(AppError::Blocked {
                reason: "the Project Environment has too many GitHub sources".into(),
            });
        }
        let mut sources = Vec::with_capacity(bindings.len());
        for raw in bindings {
            let binding: dopedb_protocol::KnowledgeSourceBindingV1 = serde_json::from_str(&raw)?;
            let dopedb_protocol::SourceRevisionIdentity::Github {
                repository_id,
                repository,
                ref_name,
                commit_sha,
            } = binding.revision
            else {
                return Err(AppError::Config(
                    "the stored GitHub source revision is invalid".into(),
                ));
            };
            let source = KnowledgeSessionSource {
                source_id: binding.source_id,
                display_name: binding.display_name,
                repository_id,
                repository,
                ref_name,
                commit_sha,
            };
            if !source.validate() {
                return Err(AppError::Config(
                    "the stored GitHub source identity is invalid".into(),
                ));
            }
            sources.push(source);
        }
        Ok(sources)
    }

    pub(in crate::features::knowledge::adapters) async fn agent_knowledge_environments(
        &self,
        connection: &PinnedConnection,
    ) -> AppResult<Vec<KnowledgeEnvironmentSummary>> {
        let rows: Vec<(String, String, String, String, i64)> = sqlx::query_as(
            "SELECT environment.id, project.name, environment.name,
                    environment.risk_class, environment.revision
             FROM knowledge_environment_connections binding
             JOIN knowledge_project_environments environment
               ON environment.id = binding.project_environment_id
              AND environment.revision = binding.environment_revision
             JOIN knowledge_projects project ON project.id = environment.project_id
             WHERE binding.connection_id = ?1
               AND binding.connection_revision = ?2
               AND binding.revoked_at IS NULL
               AND project.workspace_id = ?3
             ORDER BY project.name, environment.name, environment.id",
        )
        .bind(connection.connection_id.to_string())
        .bind(connection.connection_revision)
        .bind(connection.scope.workspace_id.to_string())
        .fetch_all(self.pool())
        .await?;
        let mut environments = Vec::new();
        for (id, project_name, name, risk_class, environment_revision) in rows {
            let id = parse_uuid(id)?;
            let mut graphs = self.active_set(id).await?;
            if connection.scope.selected_account_id.is_none() {
                graphs.retain(|graph| {
                    graph.binding.provider != dopedb_protocol::KnowledgeSourceProvider::Github
                });
            }
            let environment_revision = u64::try_from(environment_revision).map_err(|_| {
                AppError::Config("the stored Project Environment revision is invalid".into())
            })?;
            if graphs
                .iter()
                .any(|graph| graph.environment_revision != environment_revision)
            {
                continue;
            }
            let remote_graph_revision_ids = graphs
                .iter()
                .filter(|graph| {
                    graph.binding.provider == dopedb_protocol::KnowledgeSourceProvider::Github
                })
                .map(|graph| graph.graph_revision_id)
                .collect::<Vec<_>>();
            if !remote_graph_revision_ids.is_empty() {
                let Some(account_id) = connection.scope.selected_account_id.as_deref() else {
                    continue;
                };
                if self
                    .active_knowledge_grant(
                        connection.scope.workspace_id,
                        account_id,
                        id,
                        environment_revision,
                        &remote_graph_revision_ids,
                    )
                    .await?
                    .is_none()
                {
                    continue;
                }
            }
            environments.push(KnowledgeEnvironmentSummary {
                id,
                project_name,
                name,
                risk_class: parse_risk_class(&risk_class)?,
                graph_revision_count: u64::try_from(graphs.len())
                    .map_err(|_| AppError::Config("the Knowledge graph count is invalid".into()))?,
            });
        }
        Ok(environments)
    }

    pub(in crate::features::knowledge::adapters) async fn knowledge_session_scope(
        &self,
        connection: &PinnedConnection,
        requested_environment_id: Option<Uuid>,
    ) -> AppResult<Option<KnowledgeSessionScope>> {
        let environment_rows: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT DISTINCT environment.id, environment.project_id, environment.revision
             FROM knowledge_environment_connections binding
             JOIN knowledge_project_environments environment
               ON environment.id = binding.project_environment_id
              AND environment.revision = binding.environment_revision
             JOIN knowledge_projects project ON project.id = environment.project_id
             WHERE binding.connection_id = ?1
               AND binding.connection_revision = ?2
               AND binding.revoked_at IS NULL
               AND project.workspace_id = ?3
               AND (?4 IS NULL OR environment.id = ?4)
             ORDER BY environment.id",
        )
        .bind(connection.connection_id.to_string())
        .bind(connection.connection_revision)
        .bind(connection.scope.workspace_id.to_string())
        .bind(requested_environment_id.map(|value| value.to_string()))
        .fetch_all(self.pool())
        .await?;
        if environment_rows.is_empty() {
            if requested_environment_id.is_some() {
                return Err(AppError::Blocked {
                    reason: "the connection is not bound to that Project Environment revision"
                        .into(),
                });
            }
            return Ok(None);
        }
        if environment_rows.len() != 1 {
            return Err(AppError::Blocked {
                reason: "select one Project Environment before starting this Agent session".into(),
            });
        }
        let (environment_id, project_id, environment_revision) = &environment_rows[0];
        let project_environment_id = parse_uuid(environment_id.clone())?;
        let project_id = parse_uuid(project_id.clone())?;
        let environment_revision = u64::try_from(*environment_revision).map_err(|_| {
            AppError::Config("the stored Project Environment revision is invalid".into())
        })?;
        let mut graphs = self.active_set(project_environment_id).await?;
        if connection.scope.selected_account_id.is_none() {
            graphs.retain(|graph| {
                graph.binding.provider != dopedb_protocol::KnowledgeSourceProvider::Github
            });
        }
        if graphs
            .iter()
            .any(|graph| graph.environment_revision != environment_revision)
        {
            return Err(AppError::Blocked {
                reason: "the Project Environment Knowledge graph set is stale".into(),
            });
        }
        let graph_revision_ids = graphs
            .iter()
            .map(|graph| graph.graph_revision_id)
            .collect::<Vec<_>>();
        let sources = if connection.scope.selected_account_id.is_some() {
            self.github_session_sources(project_environment_id, environment_revision)
                .await?
        } else {
            Vec::new()
        };
        let remote_graph_revision_ids = graphs
            .iter()
            .filter(|graph| {
                graph.binding.provider == dopedb_protocol::KnowledgeSourceProvider::Github
            })
            .map(|graph| graph.graph_revision_id)
            .collect::<Vec<_>>();
        let knowledge_grant_id = if remote_graph_revision_ids.is_empty() {
            None
        } else {
            let account_id = connection
                .scope
                .selected_account_id
                .as_deref()
                .ok_or_else(|| AppError::Blocked {
                    reason: "Project Knowledge requires an exact member grant".into(),
                })?;
            Some(
                self.active_knowledge_grant(
                    connection.scope.workspace_id,
                    account_id,
                    project_environment_id,
                    environment_revision,
                    &remote_graph_revision_ids,
                )
                .await?
                .ok_or_else(|| AppError::Blocked {
                    reason:
                        "this member has no current grant for the active Knowledge revision set"
                            .into(),
                })?,
            )
        };
        let bindings = self
            .environment_connections(connection.scope.workspace_id, Some(project_environment_id))
            .await?;
        if bindings.len() > 32 {
            return Err(AppError::Blocked {
                reason: "the Project Environment has too many database bindings".into(),
            });
        }
        let mut connections = Vec::new();
        for binding in bindings {
            if binding.connection_revision != binding.current_connection_revision {
                return Err(AppError::Blocked {
                    reason: format!(
                        "the {} Environment database binding changed; reconfirm it before starting an Agent session",
                        binding.alias
                    ),
                });
            }
            let pinned = self.pin_connection_for_read(binding.connection_id).await?;
            if pinned.connection_revision != binding.connection_revision
                || pinned.scope.workspace_id != connection.scope.workspace_id
                || pinned.scope.account_scope.storage_key()
                    != connection.scope.account_scope.storage_key()
            {
                return Err(AppError::Blocked {
                    reason: "an Environment database is outside this member's exact grant".into(),
                });
            }
            connections.push(KnowledgeSessionConnection {
                connection_id: binding.connection_id,
                connection_revision: binding.connection_revision,
                remote_connection_id: None,
                connection_content_revision: binding.connection_revision,
                role: binding.role,
                alias: binding.alias,
            });
        }
        connections.sort_by(|left, right| {
            (&left.role, &left.alias, left.connection_id).cmp(&(
                &right.role,
                &right.alias,
                right.connection_id,
            ))
        });
        if !connections
            .iter()
            .any(|value| value.connection_id == connection.connection_id)
        {
            return Err(AppError::Blocked {
                reason: "the current connection is not in the selected Environment grant".into(),
            });
        }
        Ok(Some(KnowledgeSessionScope {
            project_id,
            knowledge_grant_id,
            project_environment_id,
            environment_revision,
            authority_connection_id: connection.connection_id,
            authority_connection_revision: connection.connection_revision,
            sources,
            graph_revision_ids,
            connections,
        }))
    }

    pub(in crate::features::knowledge::adapters) async fn exact_knowledge_session_graphs(
        &self,
        scope: &KnowledgeSessionScope,
        expected_workspace_id: Uuid,
        expected_account_id: &str,
    ) -> AppResult<Vec<GraphBuildArtifactV1>> {
        let active_sources = if expected_account_id == AccountScope::Personal.storage_key() {
            Vec::new()
        } else {
            self.github_session_sources(scope.project_environment_id, scope.environment_revision)
                .await?
        };
        if scope
            .sources
            .iter()
            .any(|source| !active_sources.contains(source))
        {
            return Err(AppError::Blocked {
                reason:
                    "the Agent GitHub source scope changed; start a new session to reconfirm it"
                        .into(),
            });
        }
        let mut graphs = self.active_set(scope.project_environment_id).await?;
        if expected_account_id == AccountScope::Personal.storage_key() {
            graphs.retain(|graph| {
                graph.binding.provider != dopedb_protocol::KnowledgeSourceProvider::Github
            });
        }
        let active_ids = graphs
            .iter()
            .map(|graph| graph.graph_revision_id)
            .collect::<Vec<_>>();
        if graphs
            .iter()
            .any(|graph| graph.environment_revision != scope.environment_revision)
            || scope
                .graph_revision_ids
                .iter()
                .any(|revision_id| !active_ids.contains(revision_id))
        {
            return Err(AppError::Blocked {
                reason: "the Agent Knowledge scope changed; start a new session to reconfirm it"
                    .into(),
            });
        }
        graphs.retain(|graph| scope.graph_revision_ids.contains(&graph.graph_revision_id));
        let remote_graph_revision_ids = graphs
            .iter()
            .filter(|graph| {
                graph.binding.provider == dopedb_protocol::KnowledgeSourceProvider::Github
            })
            .map(|graph| graph.graph_revision_id)
            .collect::<Vec<_>>();
        match (
            scope.knowledge_grant_id,
            remote_graph_revision_ids.is_empty(),
        ) {
            (None, true) => {}
            (Some(grant_id), false) => {
                let grant = self
                    .exact_grant(grant_id)
                    .await?
                    .ok_or_else(|| AppError::Blocked {
                        reason: "the Agent Knowledge grant expired or was revoked".into(),
                    })?;
                if Uuid::from(grant.workspace_id) != expected_workspace_id
                    || grant.account_id.as_str() != expected_account_id
                    || grant.project_environment_id != scope.project_environment_id
                    || grant.environment_revision != scope.environment_revision
                    || remote_graph_revision_ids
                        .iter()
                        .any(|revision_id| !grant.graph_revision_ids.contains(revision_id))
                {
                    return Err(AppError::Blocked {
                        reason: "the Agent Knowledge grant changed; start a new session".into(),
                    });
                }
            }
            _ => {
                return Err(AppError::Blocked {
                    reason: "the Agent Knowledge graph authority is incomplete".into(),
                });
            }
        }
        if (scope.connections.is_empty() && scope.sources.is_empty())
            || scope.connections.len() > 32
            || scope.connections.iter().any(|connection| {
                connection.connection_revision <= 0
                    || !validate_environment_connection_label(&connection.role, 64)
                    || !validate_environment_connection_label(&connection.alias, 128)
            })
        {
            return Err(AppError::Blocked {
                reason: "the Agent Knowledge database scope is invalid".into(),
            });
        }
        let authority_active: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1
                FROM knowledge_environment_connections binding
                JOIN knowledge_project_environments environment
                  ON environment.id = binding.project_environment_id
                 AND environment.revision = binding.environment_revision
                JOIN knowledge_projects project ON project.id = environment.project_id
                JOIN connections current ON current.id = binding.connection_id
                WHERE binding.project_environment_id = ?1
                  AND binding.environment_revision = ?2
                  AND binding.connection_id = ?3
                  AND binding.connection_revision = ?4
                  AND binding.revoked_at IS NULL
                  AND current.revision = binding.connection_revision
                  AND current.deleted_at IS NULL
                  AND project.workspace_id = ?5
                  AND environment.project_id = ?6
            )",
        )
        .bind(scope.project_environment_id.to_string())
        .bind(u64_to_i64(
            scope.environment_revision,
            "environment revision",
        )?)
        .bind(scope.authority_connection_id.to_string())
        .bind(scope.authority_connection_revision)
        .bind(expected_workspace_id.to_string())
        .bind(scope.project_id.to_string())
        .fetch_one(self.pool())
        .await?;
        if !authority_active {
            return Err(AppError::Blocked {
                reason: "the Agent Project resource authority changed; start a new session".into(),
            });
        }
        for connection in &scope.connections {
            let active: bool = sqlx::query_scalar(
                "SELECT EXISTS(
                    SELECT 1
                    FROM knowledge_environment_connections binding
                    JOIN knowledge_project_environments environment
                      ON environment.id = binding.project_environment_id
                     AND environment.revision = binding.environment_revision
                    JOIN connections current ON current.id = binding.connection_id
                    WHERE binding.project_environment_id = ?1
                      AND binding.environment_revision = ?2
                      AND binding.connection_id = ?3
                      AND binding.connection_revision = ?4
                      AND binding.revoked_at IS NULL
                      AND current.revision = binding.connection_revision
                      AND current.deleted_at IS NULL
                )",
            )
            .bind(scope.project_environment_id.to_string())
            .bind(u64_to_i64(
                scope.environment_revision,
                "environment revision",
            )?)
            .bind(connection.connection_id.to_string())
            .bind(connection.connection_revision)
            .fetch_one(self.pool())
            .await?;
            if !active {
                return Err(AppError::Blocked {
                    reason: "the Agent Environment connection scope changed; start a new session"
                        .into(),
                });
            }
        }
        Ok(graphs)
    }

    pub(in crate::features::knowledge::adapters) async fn bind_environment_connection(
        &self,
        binding_id: Uuid,
        connection: &PinnedConnection,
        project_environment_id: Uuid,
        role: &str,
        alias: &str,
    ) -> AppResult<EnvironmentConnectionBinding> {
        if connection.connection_revision <= 0
            || !validate_environment_connection_label(role, 64)
            || !validate_environment_connection_label(alias, 128)
        {
            return Err(AppError::Config(
                "the Environment connection binding is invalid".into(),
            ));
        }
        let mut transaction = self.pool().begin().await?;
        let environment: Option<(i64,)> = sqlx::query_as(
            "SELECT environment.revision
             FROM knowledge_project_environments environment
             JOIN knowledge_projects project ON project.id = environment.project_id
             WHERE environment.id = ?1 AND project.workspace_id = ?2",
        )
        .bind(project_environment_id.to_string())
        .bind(connection.scope.workspace_id.to_string())
        .fetch_optional(&mut *transaction)
        .await?;
        let Some((environment_revision,)) = environment else {
            return Err(AppError::NotFound(
                "the active workspace Project Environment".into(),
            ));
        };
        let active_environment_id: Option<String> = sqlx::query_scalar(
            "SELECT project_environment_id
             FROM knowledge_environment_connections
             WHERE workspace_id = ?1 AND connection_id = ?2
               AND revoked_at IS NULL
             LIMIT 1",
        )
        .bind(connection.scope.workspace_id.to_string())
        .bind(connection.connection_id.to_string())
        .fetch_optional(&mut *transaction)
        .await?;
        if active_environment_id
            .as_deref()
            .is_some_and(|id| id != project_environment_id.to_string())
        {
            transaction.rollback().await?;
            return Err(AppError::Blocked {
                reason: "this database connection is already assigned to another Project in this workspace; remove that assignment first"
                    .into(),
            });
        }
        let now = Utc::now();
        sqlx::query(
            "UPDATE knowledge_environment_connections
             SET revoked_at = ?1
             WHERE workspace_id = ?2 AND project_environment_id = ?3
               AND connection_id = ?4 AND id != ?5 AND revoked_at IS NULL",
        )
        .bind(now)
        .bind(connection.scope.workspace_id.to_string())
        .bind(project_environment_id.to_string())
        .bind(connection.connection_id.to_string())
        .bind(binding_id.to_string())
        .execute(&mut *transaction)
        .await?;
        let changed = sqlx::query(
            "INSERT INTO knowledge_environment_connections
                 (id, workspace_id, project_environment_id, environment_revision,
                  connection_id, connection_revision, role, alias, created_at, revoked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)
             ON CONFLICT(id)
             DO UPDATE SET environment_revision = excluded.environment_revision,
                           connection_revision = excluded.connection_revision,
                           role = excluded.role, alias = excluded.alias, revoked_at = NULL
             WHERE knowledge_environment_connections.workspace_id = excluded.workspace_id
               AND knowledge_environment_connections.project_environment_id = excluded.project_environment_id
               AND knowledge_environment_connections.connection_id = excluded.connection_id",
        )
        .bind(binding_id.to_string())
        .bind(connection.scope.workspace_id.to_string())
        .bind(project_environment_id.to_string())
        .bind(environment_revision)
        .bind(connection.connection_id.to_string())
        .bind(connection.connection_revision)
        .bind(role.trim())
        .bind(alias.trim())
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        if changed.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(AppError::Blocked {
                reason: "the Environment connection binding identity changed".into(),
            });
        }
        transaction.commit().await?;
        self.environment_connections(connection.scope.workspace_id, Some(project_environment_id))
            .await?
            .into_iter()
            .find(|binding| binding.connection_id == connection.connection_id)
            .ok_or_else(|| AppError::Config("the Environment connection binding was lost".into()))
    }

    pub(in crate::features::knowledge::adapters) async fn remote_connection_id(
        &self,
        connection: &PinnedConnection,
    ) -> AppResult<Option<Uuid>> {
        let remote_id: Option<String> = sqlx::query_scalar(
            "SELECT remote_id FROM connections
             WHERE id = ?1 AND workspace_id = ?2 AND revision = ?3
               AND deleted_at IS NULL",
        )
        .bind(connection.connection_id.to_string())
        .bind(connection.scope.workspace_id.to_string())
        .bind(connection.connection_revision)
        .fetch_optional(self.pool())
        .await?
        .flatten();
        remote_id.map(parse_uuid).transpose()
    }

    pub(in crate::features::knowledge::adapters) async fn local_connection_id_for_remote(
        &self,
        workspace_id: Uuid,
        remote_connection_id: Uuid,
    ) -> AppResult<Option<Uuid>> {
        let id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM connections
             WHERE workspace_id = ?1 AND remote_id = ?2 AND deleted_at IS NULL",
        )
        .bind(workspace_id.to_string())
        .bind(remote_connection_id.to_string())
        .fetch_optional(self.pool())
        .await?;
        id.map(parse_uuid).transpose()
    }

    pub(in crate::features::knowledge::adapters) async fn local_connection_ids_for_remote(
        &self,
        workspace_id: Uuid,
    ) -> AppResult<Vec<(Uuid, Uuid)>> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, remote_id FROM connections
             WHERE workspace_id = ?1 AND remote_id IS NOT NULL AND deleted_at IS NULL
             ORDER BY id
             LIMIT ?2",
        )
        .bind(workspace_id.to_string())
        .bind((MAX_WORKSPACE_BINDING_INVENTORY + 1) as i64)
        .fetch_all(self.pool())
        .await?;
        if rows.len() > MAX_WORKSPACE_BINDING_INVENTORY {
            return Err(AppError::Blocked {
                reason: "the workspace has too many shared database connections".into(),
            });
        }
        rows.into_iter()
            .map(|(local_id, remote_id)| Ok((parse_uuid(remote_id)?, parse_uuid(local_id)?)))
            .collect()
    }

    pub(in crate::features::knowledge::adapters) async fn environment_connections(
        &self,
        workspace_id: Uuid,
        project_environment_id: Option<Uuid>,
    ) -> AppResult<Vec<EnvironmentConnectionBinding>> {
        let rows: Vec<EnvironmentConnectionRow> = sqlx::query_as(
            "SELECT binding.id, binding.workspace_id, binding.project_environment_id,
                        binding.environment_revision, binding.connection_id,
                        binding.connection_revision, connection.revision,
                        connection.name, binding.role, binding.alias
                 FROM knowledge_environment_connections binding
                 JOIN knowledge_project_environments environment
                   ON environment.id = binding.project_environment_id
                  AND environment.revision = binding.environment_revision
                 JOIN knowledge_projects project ON project.id = environment.project_id
                 JOIN connections connection ON connection.id = binding.connection_id
                 WHERE binding.workspace_id = ?1
                   AND (?2 IS NULL OR binding.project_environment_id = ?2)
                   AND binding.revoked_at IS NULL
                   AND project.workspace_id = binding.workspace_id
                   AND connection.workspace_id = binding.workspace_id
                   AND connection.deleted_at IS NULL
                 ORDER BY binding.role, binding.alias, binding.id
                 LIMIT ?3",
        )
        .bind(workspace_id.to_string())
        .bind(project_environment_id.map(|id| id.to_string()))
        .bind((MAX_WORKSPACE_BINDING_INVENTORY + 1) as i64)
        .fetch_all(self.pool())
        .await?;
        if rows.len() > MAX_WORKSPACE_BINDING_INVENTORY {
            return Err(AppError::Blocked {
                reason: "the workspace has too many Environment connection bindings".into(),
            });
        }
        rows.into_iter()
            .map(
                |(
                    id,
                    workspace_id,
                    environment_id,
                    environment_revision,
                    connection_id,
                    connection_revision,
                    current_connection_revision,
                    connection_name,
                    role,
                    alias,
                )| {
                    Ok(EnvironmentConnectionBinding {
                        id: parse_uuid(id)?,
                        workspace_id: WorkspaceId::from(parse_uuid(workspace_id)?),
                        project_environment_id: parse_uuid(environment_id)?,
                        environment_revision: u64::try_from(environment_revision).map_err(
                            |_| {
                                AppError::Config(
                                    "the stored Environment revision is invalid".into(),
                                )
                            },
                        )?,
                        connection_id: parse_uuid(connection_id)?,
                        connection_revision,
                        current_connection_revision,
                        connection_content_revision: current_connection_revision,
                        connection_name,
                        role,
                        alias,
                    })
                },
            )
            .collect()
    }

    pub(in crate::features::knowledge::adapters) async fn revoke_environment_connection(
        &self,
        workspace_id: Uuid,
        binding_id: Uuid,
    ) -> AppResult<()> {
        let changed = sqlx::query(
            "UPDATE knowledge_environment_connections
             SET revoked_at = ?1
             WHERE id = ?2 AND workspace_id = ?3 AND revoked_at IS NULL",
        )
        .bind(Utc::now())
        .bind(binding_id.to_string())
        .bind(workspace_id.to_string())
        .execute(self.pool())
        .await?;
        if changed.rows_affected() != 1 {
            return Err(AppError::NotFound(
                "the Environment connection binding".into(),
            ));
        }
        Ok(())
    }
}
