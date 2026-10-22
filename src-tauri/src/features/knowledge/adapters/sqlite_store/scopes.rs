//! GitHub source identity persistence scoped to exact Project environments.

use chrono::Utc;
use dopedb_protocol::KnowledgeSourceBindingV1;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::{Project, ProjectEnvironment, StoredKnowledgeScope};
use crate::kernel::identity::WorkspaceId;
use crate::store::{parse_uuid, Store};

use super::codec::{
    checked_name, parse_environment_kind, provider_value, u64_to_i64, KnowledgeScopeRow,
};

impl Store {
    pub(in crate::features::knowledge::adapters) async fn save_scope(
        &self,
        project: &Project,
        environment: &ProjectEnvironment,
        binding: &KnowledgeSourceBindingV1,
        environment_revision: u64,
    ) -> AppResult<()> {
        if project.revision == 0
            || environment.revision == 0
            || environment.project_id != project.id
            || binding.project_id != project.id
            || binding.project_environment_id != environment.id
            || environment_revision != environment.revision
            || !binding.validate()
        {
            return Err(AppError::Blocked {
                reason: "the Project Knowledge scope is invalid or stale".into(),
            });
        }
        let project_name = checked_name(&project.name)?;
        let binding_json = serde_json::to_string(binding)?;
        if binding_json.len() > 65_536 {
            return Err(AppError::Config(
                "the Knowledge source binding is too large".into(),
            ));
        }
        let project_revision = u64_to_i64(project.revision, "project revision")?;
        let environment_revision = u64_to_i64(environment_revision, "environment revision")?;
        let now = Utc::now();
        let mut tx = self.pool().begin().await?;

        sqlx::query(
            "INSERT INTO knowledge_projects
                 (id, workspace_id, name, revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 revision = excluded.revision,
                 updated_at = excluded.updated_at
             WHERE knowledge_projects.workspace_id = excluded.workspace_id
               AND knowledge_projects.revision <= excluded.revision",
        )
        .bind(project.id.to_string())
        .bind(project.workspace_id.to_string())
        .bind(project_name)
        .bind(project_revision)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        let stored_workspace: Option<String> =
            sqlx::query_scalar("SELECT workspace_id FROM knowledge_projects WHERE id = ?1")
                .bind(project.id.to_string())
                .fetch_optional(&mut *tx)
                .await?;
        if stored_workspace.as_deref() != Some(&project.workspace_id.to_string()) {
            return Err(AppError::Blocked {
                reason: "the Project identity belongs to another workspace".into(),
            });
        }

        sqlx::query(
            "INSERT INTO knowledge_project_environments
                 (id, project_id, kind, revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
                 kind = excluded.kind,
                 revision = excluded.revision,
                 updated_at = excluded.updated_at
             WHERE knowledge_project_environments.project_id = excluded.project_id
               AND knowledge_project_environments.revision <= excluded.revision",
        )
        .bind(environment.id.to_string())
        .bind(project.id.to_string())
        .bind(environment.kind.as_str())
        .bind(environment_revision)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        let stored_project: Option<String> = sqlx::query_scalar(
            "SELECT project_id FROM knowledge_project_environments WHERE id = ?1",
        )
        .bind(environment.id.to_string())
        .fetch_optional(&mut *tx)
        .await?;
        if stored_project.as_deref() != Some(&project.id.to_string()) {
            return Err(AppError::Blocked {
                reason: "the Project Environment identity belongs to another Project".into(),
            });
        }

        sqlx::query(
            "INSERT INTO knowledge_sources
                 (id, project_id, project_environment_id, environment_revision,
                  provider, display_name, binding_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(id) DO UPDATE SET
                 environment_revision = excluded.environment_revision,
                 display_name = excluded.display_name,
                 binding_json = excluded.binding_json,
                 updated_at = excluded.updated_at
             WHERE knowledge_sources.project_id = excluded.project_id
               AND knowledge_sources.project_environment_id = excluded.project_environment_id
               AND knowledge_sources.provider = excluded.provider
               AND knowledge_sources.environment_revision <= excluded.environment_revision",
        )
        .bind(binding.source_id.to_string())
        .bind(project.id.to_string())
        .bind(environment.id.to_string())
        .bind(environment_revision)
        .bind(provider_value(binding.provider))
        .bind(&binding.display_name)
        .bind(binding_json)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        let stored_identity: Option<(String, String, String)> = sqlx::query_as(
            "SELECT project_id, project_environment_id, provider
             FROM knowledge_sources WHERE id = ?1",
        )
        .bind(binding.source_id.to_string())
        .fetch_optional(&mut *tx)
        .await?;
        if stored_identity
            != Some((
                project.id.to_string(),
                environment.id.to_string(),
                provider_value(binding.provider).to_owned(),
            ))
        {
            return Err(AppError::Blocked {
                reason: "the Knowledge source identity changed".into(),
            });
        }
        tx.commit().await?;
        Ok(())
    }

    pub(in crate::features::knowledge::adapters) async fn scopes(
        &self,
        workspace_id: Uuid,
    ) -> AppResult<Vec<StoredKnowledgeScope>> {
        let rows: Vec<KnowledgeScopeRow> = sqlx::query_as(
            "SELECT project.id, project.name, project.revision,
                    environment.id, environment.kind,
                    environment.revision, source.environment_revision,
                    source.binding_json
             FROM knowledge_sources source
             JOIN knowledge_projects project ON project.id = source.project_id
             JOIN knowledge_project_environments environment
               ON environment.id = source.project_environment_id
              AND environment.project_id = project.id
             WHERE project.workspace_id = ?1 AND source.revoked_at IS NULL
             ORDER BY project.name, environment.kind, source.display_name",
        )
        .bind(workspace_id.to_string())
        .fetch_all(self.pool())
        .await?;
        rows.into_iter()
            .map(
                |(
                    project_id,
                    project_name,
                    project_revision,
                    environment_id,
                    kind,
                    environment_revision,
                    source_environment_revision,
                    binding_json,
                )| {
                    if environment_revision != source_environment_revision {
                        return Err(AppError::Config(
                            "the stored Knowledge source is stale".into(),
                        ));
                    }
                    let project_id = parse_uuid(project_id)?;
                    let environment_id = parse_uuid(environment_id)?;
                    let binding: KnowledgeSourceBindingV1 = serde_json::from_str(&binding_json)?;
                    if !binding.validate()
                        || binding.project_id != project_id
                        || binding.project_environment_id != environment_id
                    {
                        return Err(AppError::Config(
                            "the stored Knowledge source failed integrity validation".into(),
                        ));
                    }
                    Ok(StoredKnowledgeScope {
                        project: Project {
                            id: project_id,
                            workspace_id: WorkspaceId::from(workspace_id),
                            name: project_name,
                            revision: u64::try_from(project_revision).map_err(|_| {
                                AppError::Config("the stored Project revision is invalid".into())
                            })?,
                        },
                        environment: ProjectEnvironment {
                            id: environment_id,
                            project_id,
                            kind: parse_environment_kind(&kind)?,
                            revision: u64::try_from(environment_revision).map_err(|_| {
                                AppError::Config(
                                    "the stored Environment revision is invalid".into(),
                                )
                            })?,
                        },
                        binding,
                    })
                },
            )
            .collect()
    }

    pub(in crate::features::knowledge::adapters) async fn remove_scope(
        &self,
        source_id: Uuid,
    ) -> AppResult<()> {
        let updated = sqlx::query(
            "UPDATE knowledge_sources
             SET revoked_at = ?1, snapshot_json = NULL,
                 source_revision_sha256 = NULL, updated_at = ?1
             WHERE id = ?2 AND revoked_at IS NULL",
        )
        .bind(Utc::now())
        .bind(source_id.to_string())
        .execute(self.pool())
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::NotFound("the Project Knowledge source".into()));
        }
        Ok(())
    }
}
