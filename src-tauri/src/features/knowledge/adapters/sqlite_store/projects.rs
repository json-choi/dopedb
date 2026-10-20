//! Project and Project Environment persistence.

use chrono::Utc;
use std::collections::HashSet;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::{Project, ProjectDefinition, ProjectEnvironment};
use crate::kernel::environment::EnvironmentKind;
use crate::kernel::identity::WorkspaceId;
use crate::store::{parse_uuid, Store};

use super::codec::{checked_name, parse_environment_kind, positive_revision, u64_to_i64};

impl Store {
    pub(in crate::features::knowledge::adapters) async fn knowledge_projects(
        &self,
        workspace_id: Uuid,
    ) -> AppResult<Vec<ProjectDefinition>> {
        let rows: Vec<(String, String, i64, String, String, i64)> = sqlx::query_as(
            "SELECT project.id, project.name, project.revision,
                    environment.id, environment.kind, environment.revision
             FROM knowledge_projects project
             JOIN knowledge_project_environments environment
               ON environment.project_id = project.id
             WHERE project.workspace_id = ?1
             ORDER BY project.name COLLATE NOCASE, project.id,
                      environment.kind, environment.id",
        )
        .bind(workspace_id.to_string())
        .fetch_all(self.pool())
        .await?;
        let mut projects = Vec::<ProjectDefinition>::new();
        for (
            project_id,
            project_name,
            project_revision,
            environment_id,
            kind,
            environment_revision,
        ) in rows
        {
            let project_id = parse_uuid(project_id)?;
            let project_revision = positive_revision(project_revision, "project revision")?;
            let environment = ProjectEnvironment {
                id: parse_uuid(environment_id)?,
                project_id,
                kind: parse_environment_kind(&kind)?,
                revision: positive_revision(environment_revision, "environment revision")?,
            };
            if let Some(current) = projects
                .last_mut()
                .filter(|current| current.project.id == project_id)
            {
                current.environments.push(environment);
                continue;
            }
            projects.push(ProjectDefinition {
                project: Project {
                    id: project_id,
                    workspace_id: WorkspaceId::from(workspace_id),
                    name: checked_name(&project_name)?.to_owned(),
                    revision: project_revision,
                },
                environments: vec![environment],
            });
        }
        Ok(projects)
    }

    pub(in crate::features::knowledge::adapters) async fn create_knowledge_project(
        &self,
        workspace_id: Uuid,
        name: &str,
        environments: &[EnvironmentKind],
    ) -> AppResult<ProjectDefinition> {
        let name = checked_name(name)?.to_owned();
        if environments.is_empty() || environments.len() > 100 {
            return Err(AppError::Config(
                "a Project requires between 1 and 100 Environments".into(),
            ));
        }
        let mut environment_kinds = HashSet::new();
        if !environments
            .iter()
            .all(|kind| environment_kinds.insert(*kind))
        {
            return Err(AppError::Config(
                "a Project holds at most one Environment per kind".into(),
            ));
        }
        let workspace_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM workspaces
                 WHERE id = ?1 AND lifecycle_state = 'active'
             )",
        )
        .bind(workspace_id.to_string())
        .fetch_one(self.pool())
        .await?;
        if !workspace_exists {
            return Err(AppError::NotFound("the active workspace".into()));
        }
        let duplicate: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM knowledge_projects
                 WHERE workspace_id = ?1 AND name = ?2
             )",
        )
        .bind(workspace_id.to_string())
        .bind(&name)
        .fetch_one(self.pool())
        .await?;
        if duplicate {
            return Err(AppError::Config(
                "a Project with that name already exists".into(),
            ));
        }
        let project = Project {
            id: Uuid::new_v4(),
            workspace_id: WorkspaceId::from(workspace_id),
            name,
            revision: 1,
        };
        let environments = environments
            .iter()
            .map(|kind| ProjectEnvironment {
                id: Uuid::new_v4(),
                project_id: project.id,
                kind: *kind,
                revision: 1,
            })
            .collect::<Vec<_>>();
        let definition = ProjectDefinition {
            project,
            environments,
        };
        self.save_knowledge_project(&definition).await?;
        Ok(definition)
    }

    pub(in crate::features::knowledge::adapters) async fn create_knowledge_environment(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        kind: EnvironmentKind,
    ) -> AppResult<ProjectDefinition> {
        let mut tx = self.pool().begin().await?;
        let project_revision: Option<i64> = sqlx::query_scalar(
            "SELECT revision FROM knowledge_projects
             WHERE id = ?1 AND workspace_id = ?2",
        )
        .bind(project_id.to_string())
        .bind(workspace_id.to_string())
        .fetch_optional(&mut *tx)
        .await?;
        let project_revision = project_revision
            .ok_or_else(|| AppError::NotFound("the active workspace Project".into()))?;
        let duplicate: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM knowledge_project_environments
                 WHERE project_id = ?1 AND kind = ?2
             )",
        )
        .bind(project_id.to_string())
        .bind(kind.as_str())
        .fetch_one(&mut *tx)
        .await?;
        if duplicate {
            return Err(AppError::Config(
                "the Project already has an Environment of that kind".into(),
            ));
        }
        let now = Utc::now();
        let updated = sqlx::query(
            "UPDATE knowledge_projects
             SET revision = revision + 1, updated_at = ?1
             WHERE id = ?2 AND workspace_id = ?3 AND revision = ?4",
        )
        .bind(now)
        .bind(project_id.to_string())
        .bind(workspace_id.to_string())
        .bind(project_revision)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Blocked {
                reason: "the Project revision changed before the Environment was added".into(),
            });
        }
        sqlx::query(
            "INSERT INTO knowledge_project_environments
                 (id, project_id, kind, revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(project_id.to_string())
        .bind(kind.as_str())
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        self.knowledge_projects(workspace_id)
            .await?
            .into_iter()
            .find(|definition| definition.project.id == project_id)
            .ok_or_else(|| AppError::NotFound("the updated Project".into()))
    }

    pub(in crate::features::knowledge::adapters) async fn save_knowledge_project(
        &self,
        definition: &ProjectDefinition,
    ) -> AppResult<()> {
        if definition.project.revision == 0
            || definition.environments.is_empty()
            || definition.environments.len() > 100
            || definition.environments.iter().any(|environment| {
                environment.project_id != definition.project.id || environment.revision == 0
            })
        {
            return Err(AppError::Blocked {
                reason: "the Project definition is invalid or stale".into(),
            });
        }
        let project_name = checked_name(&definition.project.name)?;
        let project_revision = u64_to_i64(definition.project.revision, "project revision")?;
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
        .bind(definition.project.id.to_string())
        .bind(definition.project.workspace_id.to_string())
        .bind(project_name)
        .bind(project_revision)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        let stored_workspace: Option<String> =
            sqlx::query_scalar("SELECT workspace_id FROM knowledge_projects WHERE id = ?1")
                .bind(definition.project.id.to_string())
                .fetch_optional(&mut *tx)
                .await?;
        if stored_workspace.as_deref() != Some(&definition.project.workspace_id.to_string()) {
            return Err(AppError::Blocked {
                reason: "the Project identity belongs to another workspace".into(),
            });
        }
        for environment in &definition.environments {
            let environment_revision = u64_to_i64(environment.revision, "environment revision")?;
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
            .bind(definition.project.id.to_string())
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
            if stored_project.as_deref() != Some(&definition.project.id.to_string()) {
                return Err(AppError::Blocked {
                    reason: "the Project Environment identity belongs to another Project".into(),
                });
            }
        }
        tx.commit().await?;
        Ok(())
    }

    pub(in crate::features::knowledge::adapters) async fn delete_knowledge_project(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        expected_revision: u64,
    ) -> AppResult<()> {
        let expected_revision = u64_to_i64(expected_revision, "project revision")?;
        let mut tx = self.pool().begin().await?;
        let current_revision: Option<i64> = sqlx::query_scalar(
            "SELECT revision FROM knowledge_projects
             WHERE id = ?1 AND workspace_id = ?2",
        )
        .bind(project_id.to_string())
        .bind(workspace_id.to_string())
        .fetch_optional(&mut *tx)
        .await?;
        let current_revision = current_revision
            .ok_or_else(|| AppError::NotFound("the active workspace Project".into()))?;
        if current_revision != expected_revision {
            return Err(AppError::Blocked {
                reason: "the Project revision changed before deletion".into(),
            });
        }
        if workspace_id.to_string() == "00000000-0000-0000-0000-000000000001" {
            let has_articles: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM personal_analysis_articles article
                 JOIN knowledge_project_environments environment ON environment.id = article.environment_id
                 WHERE environment.project_id = ?1 AND article.deleted = 0)"
            ).bind(project_id.to_string()).fetch_one(&mut *tx).await?;
            if has_articles {
                return Err(AppError::Blocked {
                    reason: "Project has active Analysis Articles; delete its Articles first"
                        .into(),
                });
            }
        }
        delete_project_cache(&mut tx, workspace_id, project_id, Some(expected_revision)).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Team Project inventory is an authoritative bounded snapshot. Removing
    /// absent cached Projects keeps another member's deletion from leaving an
    /// obsolete Agent scope on this device.
    pub(in crate::features::knowledge::adapters) async fn retain_knowledge_projects(
        &self,
        workspace_id: Uuid,
        project_ids: &[Uuid],
    ) -> AppResult<()> {
        if project_ids.len() > 1_000 {
            return Err(AppError::Blocked {
                reason: "the Project inventory exceeds the local cache boundary".into(),
            });
        }
        let retained = project_ids
            .iter()
            .map(Uuid::to_string)
            .collect::<HashSet<_>>();
        let mut tx = self.pool().begin().await?;
        let stored_ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM knowledge_projects WHERE workspace_id = ?1")
                .bind(workspace_id.to_string())
                .fetch_all(&mut *tx)
                .await?;
        for stored_id in stored_ids {
            if retained.contains(&stored_id) {
                continue;
            }
            delete_project_cache(&mut tx, workspace_id, parse_uuid(stored_id)?, None).await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

async fn delete_project_cache(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    workspace_id: Uuid,
    project_id: Uuid,
    expected_revision: Option<i64>,
) -> AppResult<()> {
    // Active-head immutability deliberately blocks graph deletion. Clear the
    // head pointers first, then let Project cascades remove graphs, grants,
    // mappings, sources, Environments, and connection bindings. Connections
    // themselves are owned by the workspace and remain intact.
    sqlx::query(
        "DELETE FROM knowledge_environment_heads
         WHERE project_environment_id IN (
           SELECT environment.id
           FROM knowledge_project_environments environment
           JOIN knowledge_projects project ON project.id = environment.project_id
           WHERE project.id = ?1 AND project.workspace_id = ?2
         )",
    )
    .bind(project_id.to_string())
    .bind(workspace_id.to_string())
    .execute(&mut **tx)
    .await?;
    let deleted = if let Some(revision) = expected_revision {
        sqlx::query(
            "DELETE FROM knowledge_projects
             WHERE id = ?1 AND workspace_id = ?2 AND revision = ?3",
        )
        .bind(project_id.to_string())
        .bind(workspace_id.to_string())
        .bind(revision)
        .execute(&mut **tx)
        .await?
    } else {
        sqlx::query(
            "DELETE FROM knowledge_projects
             WHERE id = ?1 AND workspace_id = ?2",
        )
        .bind(project_id.to_string())
        .bind(workspace_id.to_string())
        .execute(&mut **tx)
        .await?
    };
    if deleted.rows_affected() != 1 {
        return Err(AppError::Blocked {
            reason: "the Project revision changed before deletion".into(),
        });
    }
    Ok(())
}
