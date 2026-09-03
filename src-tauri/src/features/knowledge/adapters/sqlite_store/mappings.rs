//! Knowledge mapping proposal persistence and review state.

use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::{KnowledgeMappingProposal, MappingProposalState};
use crate::store::Store;

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
}
