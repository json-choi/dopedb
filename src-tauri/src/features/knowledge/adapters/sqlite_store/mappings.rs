//! Knowledge mapping proposal persistence and review state.

use chrono::Utc;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::{KnowledgeMappingProposal, MappingProposalState};
use crate::store::{parse_uuid, Store};

use super::codec::{mapping_state_value, parse_mapping_state, KnowledgeMappingRow};

impl Store {
    pub(in crate::features::knowledge::adapters) async fn sync_remote_knowledge_mapping(
        &self,
        proposal: &KnowledgeMappingProposal,
    ) -> AppResult<()> {
        if proposal.schema_fingerprint.len() != 64
            || proposal.from_node_id.len() != 64
            || proposal.target_kind.trim().is_empty()
            || proposal.target_kind.len() > 128
            || proposal.target_identity.trim().is_empty()
            || proposal.target_identity.len() > 2_048
            || proposal
                .target_identity
                .chars()
                .any(|character| character.is_control())
        {
            return Err(AppError::Config(
                "the remote Knowledge mapping proposal is invalid".into(),
            ));
        }
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM knowledge_graph_revisions graph
                 JOIN knowledge_environment_heads head
                   ON head.project_environment_id = graph.project_environment_id
                  AND head.graph_revision_id = graph.graph_revision_id
                  AND head.source_id = graph.source_id
                 WHERE graph.graph_revision_id = ?1
                   AND graph.project_environment_id = ?2
             )",
        )
        .bind(proposal.graph_revision_id.to_string())
        .bind(proposal.project_environment_id.to_string())
        .fetch_one(self.pool())
        .await?;
        if !active {
            return Err(AppError::Blocked {
                reason: "a remote mapping is outside the active Knowledge graph".into(),
            });
        }
        let updated = sqlx::query(
            "INSERT INTO knowledge_mapping_proposals
                 (id, project_environment_id, graph_revision_id, schema_fingerprint,
                  from_node_id, target_kind, target_identity, state, proposed_at, decided_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                 state = excluded.state,
                 decided_at = excluded.decided_at
             WHERE knowledge_mapping_proposals.project_environment_id = excluded.project_environment_id
               AND knowledge_mapping_proposals.graph_revision_id = excluded.graph_revision_id
               AND knowledge_mapping_proposals.schema_fingerprint = excluded.schema_fingerprint
               AND knowledge_mapping_proposals.from_node_id = excluded.from_node_id
               AND knowledge_mapping_proposals.target_kind = excluded.target_kind
               AND knowledge_mapping_proposals.target_identity = excluded.target_identity",
        )
        .bind(proposal.id.to_string())
        .bind(proposal.project_environment_id.to_string())
        .bind(proposal.graph_revision_id.to_string())
        .bind(&proposal.schema_fingerprint)
        .bind(&proposal.from_node_id)
        .bind(&proposal.target_kind)
        .bind(&proposal.target_identity)
        .bind(mapping_state_value(proposal.state))
        .bind(proposal.proposed_at)
        .bind((proposal.state != MappingProposalState::Proposed).then(Utc::now))
        .execute(self.pool())
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Blocked {
                reason: "the remote Knowledge mapping identity changed".into(),
            });
        }
        Ok(())
    }
}

impl Store {
    pub(in crate::features::knowledge::adapters) async fn propose_mapping(
        &self,
        proposal: &KnowledgeMappingProposal,
    ) -> AppResult<()> {
        if proposal.state != MappingProposalState::Proposed
            || proposal.schema_fingerprint.len() != 64
            || proposal.from_node_id.len() != 64
            || proposal.target_kind.trim().is_empty()
            || proposal.target_kind.len() > 128
            || proposal.target_identity.trim().is_empty()
            || proposal.target_identity.len() > 2_048
            || proposal
                .target_identity
                .chars()
                .any(|character| character.is_control())
        {
            return Err(AppError::Config(
                "the Knowledge mapping proposal is invalid".into(),
            ));
        }
        let belongs: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM knowledge_graph_revisions graph
                 WHERE graph.graph_revision_id = ?1
                   AND graph.project_environment_id = ?2
                   AND EXISTS (
                     SELECT 1 FROM knowledge_environment_heads head
                     WHERE head.project_environment_id = graph.project_environment_id
                       AND head.graph_revision_id = graph.graph_revision_id
                   )
             )",
        )
        .bind(proposal.graph_revision_id.to_string())
        .bind(proposal.project_environment_id.to_string())
        .fetch_one(self.pool())
        .await?;
        if !belongs {
            return Err(AppError::Blocked {
                reason: "a mapping can only be proposed against the active Knowledge graph".into(),
            });
        }
        sqlx::query(
            "INSERT INTO knowledge_mapping_proposals
                 (id, project_environment_id, graph_revision_id, schema_fingerprint,
                  from_node_id, target_kind, target_identity, state, proposed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'proposed', ?8)",
        )
        .bind(proposal.id.to_string())
        .bind(proposal.project_environment_id.to_string())
        .bind(proposal.graph_revision_id.to_string())
        .bind(&proposal.schema_fingerprint)
        .bind(&proposal.from_node_id)
        .bind(&proposal.target_kind)
        .bind(&proposal.target_identity)
        .bind(proposal.proposed_at)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub(in crate::features::knowledge::adapters) async fn decide_mapping(
        &self,
        proposal_id: Uuid,
        expected_graph_revision_id: Uuid,
        state: MappingProposalState,
    ) -> AppResult<()> {
        if !matches!(
            state,
            MappingProposalState::Approved | MappingProposalState::Rejected
        ) {
            return Err(AppError::Config(
                "a mapping review must approve or reject".into(),
            ));
        }
        let updated = sqlx::query(
            "UPDATE knowledge_mapping_proposals AS proposal
             SET state = ?3, decided_at = ?4
             WHERE proposal.id = ?1 AND proposal.graph_revision_id = ?2
               AND proposal.state = 'proposed'
               AND EXISTS (
                 SELECT 1 FROM knowledge_environment_heads head
                 WHERE head.project_environment_id = proposal.project_environment_id
                   AND head.graph_revision_id = proposal.graph_revision_id
               )",
        )
        .bind(proposal_id.to_string())
        .bind(expected_graph_revision_id.to_string())
        .bind(mapping_state_value(state))
        .bind(Utc::now())
        .execute(self.pool())
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Blocked {
                reason: "the Knowledge mapping proposal is stale or already decided".into(),
            });
        }
        Ok(())
    }

    pub(in crate::features::knowledge::adapters) async fn mappings_for_revision(
        &self,
        project_environment_id: Uuid,
        graph_revision_id: Uuid,
    ) -> AppResult<Vec<KnowledgeMappingProposal>> {
        let rows: Vec<KnowledgeMappingRow> = sqlx::query_as(
            "SELECT id, schema_fingerprint, from_node_id, target_kind,
                        target_identity, state, proposed_at
                 FROM knowledge_mapping_proposals
                 WHERE project_environment_id = ?1 AND graph_revision_id = ?2
                 ORDER BY proposed_at, id",
        )
        .bind(project_environment_id.to_string())
        .bind(graph_revision_id.to_string())
        .fetch_all(self.pool())
        .await?;
        rows.into_iter()
            .map(
                |(
                    id,
                    schema_fingerprint,
                    from_node_id,
                    target_kind,
                    target_identity,
                    state,
                    proposed_at,
                )| {
                    Ok(KnowledgeMappingProposal {
                        id: parse_uuid(id)?,
                        project_environment_id,
                        graph_revision_id,
                        schema_fingerprint,
                        from_node_id,
                        target_kind,
                        target_identity,
                        state: parse_mapping_state(&state)?,
                        proposed_at,
                    })
                },
            )
            .collect()
    }
}
