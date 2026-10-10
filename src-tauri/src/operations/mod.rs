//! Authoritative Operation Runtime contracts. Adapters may request transitions,
//! but only this module decides whether a stored operation can change state.
//!
//! The execution capability is deliberately inaccessible to external adapters:
//!
//! ```compile_fail
//! use app_lib::operations::ExecutionGrant;
//! ```

mod canonicalize;
mod context;
mod execute;
mod model;
mod repository;
mod runtime;
pub mod state_machine;

pub(crate) use canonicalize::canonical_hash;
#[cfg(feature = "packaged-benchmark")]
pub(crate) use canonicalize::canonical_json;
pub(crate) use context::{
    actor_for_pin, agent_actor_for_pin, approver_for_pin, capture_policy, ensure_operation_scope,
    required_confirmation,
};
pub use dopedb_protocol::{
    OperationActorKind, OperationEventKind, OperationKind, OperationRiskLevel, OperationState,
};
pub(crate) use execute::ExecutionGrant;
pub(crate) use model::{
    NewOperation, OperationActor, OperationActorProvenance, OperationApprover, OperationRecord,
    RestartRecoveryReport,
};
pub(crate) use runtime::{
    AgentSessionLiveness, ClaimedOperation, ExactApprovalRequest, LocalApprovalAuthority,
    OperationPlanDisposition, OperationRuntime, AGENT_SESSION_REVOKED,
};
pub use state_machine::{ensure_transition, restart_recovery, RestartRecovery, TransitionError};
