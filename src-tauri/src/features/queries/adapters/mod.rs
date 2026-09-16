//! Concrete platform adapters for desktop and authenticated Terminal SQL Query workflows.

mod desktop_contracts;
mod desktop_execution;
mod desktop_inspection;
mod desktop_planning;
mod desktop_port;
mod desktop_provenance;
mod desktop_result_store;
mod desktop_stream_lifecycle;
mod desktop_stream_registry;
mod desktop_support;
mod desktop_trace;
mod errors;
mod platform;
mod terminal_plan;
mod terminal_run;
mod terminal_support;

pub(crate) use desktop_contracts::{
    DesktopSqlApprovalReview, DesktopSqlInspectionError, DesktopSqlInspectionReceipt,
    DesktopSqlProposalReceipt, DesktopSqlRunError, DesktopSqlRunReceipt, DesktopSqlStreamReceipt,
    StoredDesktopSqlPayload, DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION,
};
#[cfg(test)]
pub(crate) use desktop_result_store::assert_decode_failure_export_contract;
pub(crate) use desktop_result_store::DesktopSqlResultAuthority;
#[cfg(feature = "packaged-benchmark")]
pub(crate) use desktop_result_store::{
    run_packaged_result_store_benchmark, PackagedResultStoreMetric,
};
pub(crate) use desktop_stream_lifecycle::{DesktopStreamCleanupOwner, DesktopStreamCleanupRuntime};
#[cfg(test)]
pub(crate) use desktop_stream_registry::assert_ephemeral_page_contract;
pub(crate) use desktop_stream_registry::DesktopSqlStreamRegistry;
pub(crate) use errors::{AgentQueryPlanError, AgentQueryRunError, AgentQueryRunPrepareError};
pub(crate) use platform::QueryPlatformAdapter;
pub(crate) use terminal_plan::AgentQueryPlanReceipt;
pub(crate) use terminal_run::PreparedAgentQueryRun;
