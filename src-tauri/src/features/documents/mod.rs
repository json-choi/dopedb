//! Transport-neutral, typed document reads for MongoDB.
//!
//! The service owns the authority pin, read-only classification, row cap, execution,
//! audit, and history lifecycle. Adapters receive only allowlisted display/result
//! DTOs; connection profiles and credential references never cross this boundary.

mod application;
mod desktop_plan;
mod desktop_run;
mod ports;
mod recording;
mod terminal_read;

use std::fmt;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::audit::{self, RecordArgs};
use crate::connection::{
    ensure_terminal_pin, ConnectionAccess, ConnectionContext, ConnectionLease, ConnectionManager,
    ConnectionOperationScope,
};
use crate::error::AppError;
use crate::executor;
use crate::kernel::access::PinnedConnection;
use crate::kernel::agent_policy::{MAX_AGENT_ROWS, QUERY_PLAN_TTL};
use crate::kernel::TerminalAuthority;
use crate::model::{DocumentPage, DocumentQuery, HistoryEntry, QueryKind, SafetySettings};
use crate::operations::{
    actor_for_pin, agent_actor_for_pin, capture_policy, ensure_operation_scope, NewOperation,
    OperationKind, OperationPlanDisposition, OperationRiskLevel, OperationRuntime, OperationState,
};
use crate::safety::{self, GateDecision};
use crate::store::Store;

const MAX_DESKTOP_ROWS: u64 = 100_000;

#[derive(Debug, Clone)]
pub(crate) struct TerminalDocumentReadRequest {
    pub(crate) connection_id: Uuid,
    pub(crate) query: DocumentQuery,
    pub(crate) max_rows: Option<u64>,
    pub(crate) authority: TerminalAuthority,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredAgentDocumentPayload {
    query: DocumentQuery,
    query_text: String,
    max_rows: u64,
}

/// Desktop typed-document proposal input. The query crosses the transport only at
/// this boundary and is persisted before a single-use run can be claimed.
#[derive(Debug, Clone)]
pub(crate) struct DesktopDocumentProposalRequest {
    pub(crate) connection_id: Uuid,
    pub(crate) query: DocumentQuery,
    pub(crate) origin: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopDocumentProposalReceipt {
    pub(crate) operation_id: Uuid,
    pub(crate) payload_hash: String,
    pub(crate) state: OperationState,
    pub(crate) expires_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredDesktopDocumentPayload {
    query: DocumentQuery,
    history_origin: String,
}

/// Explicitly allowlisted fields needed to render a document tool event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DocumentReadEventContext {
    pub(crate) connection_id: Uuid,
    pub(crate) connection_name: String,
    /// Canonical JSON stored in the shared audit/history `sql` column.
    pub(crate) query_text: String,
}

/// Successful typed document read. It intentionally contains no host, username,
/// credential reference, workspace binding, or full connection profile.
#[derive(Debug, Clone)]
pub(crate) struct DocumentReadResult {
    pub(crate) operation_id: Uuid,
    pub(crate) context: DocumentReadEventContext,
    pub(crate) query: DocumentQuery,
    pub(crate) page: DocumentPage,
}

/// Successful result whose lease keeps the exact workspace/account scope pinned
/// while the adapter builds and emits its response.
pub(crate) struct DocumentReadReceipt {
    result: DocumentReadResult,
    _lease: ConnectionLease,
}

impl DocumentReadReceipt {
    pub(crate) fn result(&self) -> &DocumentReadResult {
        &self.result
    }
}

/// Preserve the desktop command's exact `DocumentPage` JSON wire shape while the
/// receipt (and therefore its scope lease) remains alive through Tauri serialization.
impl serde::Serialize for DocumentReadReceipt {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serde::Serialize::serialize(&self.result.page, serializer)
    }
}

/// Terminal CLI failures with stable distinctions for broker error mapping.
#[derive(Debug)]
pub(crate) enum AgentDocumentReadError {
    /// `run_document_query` was used with a SQL-family connection.
    NonDocumentConnection,
    /// Typed classification rejected an unsafe operator/stage.
    Rejected(Box<RejectedAgentDocumentRead>),
    /// Pinning, safety settings, connection, or backend selection failed.
    Application(AppError),
    /// MongoDB accepted the read shape but execution failed.
    Execution(Box<AgentDocumentExecutionFailure>),
}

/// A rejected typed request that retains its authority scope until the broker maps
/// the error. The audit entry is already durable/best-effort when this token returns.
pub(crate) struct RejectedAgentDocumentRead {
    context: DocumentReadEventContext,
    message: String,
    _authority: ConnectionContext,
}

impl fmt::Debug for RejectedAgentDocumentRead {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RejectedAgentDocumentRead")
            .field("connection_id", &self.context.connection_id)
            .field("connection_name", &self.context.connection_name)
            .field("message", &self.message)
            .finish_non_exhaustive()
    }
}

/// Execution failure retaining the live lease through the adapter's error event.
pub(crate) struct AgentDocumentExecutionFailure {
    context: DocumentReadEventContext,
    error: AppError,
    _lease: ConnectionLease,
}

impl fmt::Debug for AgentDocumentExecutionFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentDocumentExecutionFailure")
            .field("connection_id", &self.context.connection_id)
            .field("connection_name", &self.context.connection_name)
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}

impl AgentDocumentExecutionFailure {
    pub(crate) fn into_error(self) -> AppError {
        self.error
    }
}

/// Desktop-path failures preserve the command's existing structured `AppError`
/// contract while keeping guards alive until the thin adapter performs the mapping.
#[derive(Debug)]
pub(crate) enum DesktopDocumentReadError {
    NonDocumentConnection,
    Blocked(DesktopDocumentBlocked),
    Application(AppError),
    Execution(Box<DesktopDocumentExecutionFailure>),
}

impl DesktopDocumentReadError {
    pub(crate) fn into_error(self) -> AppError {
        match self {
            Self::NonDocumentConnection => AppError::Config(
                "document queries are only available on MongoDB connections".into(),
            ),
            Self::Blocked(blocked) => blocked.into_error(),
            Self::Application(error) => error,
            Self::Execution(failure) => failure.into_error(),
        }
    }
}

/// A blocked desktop request retains the pre-connection operation scope until the
/// command maps it back to `AppError::Blocked`.
pub(crate) struct DesktopDocumentBlocked {
    reason: String,
    _scope: ConnectionOperationScope,
}

impl fmt::Debug for DesktopDocumentBlocked {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DesktopDocumentBlocked")
            .field("reason", &self.reason)
            .finish_non_exhaustive()
    }
}

impl DesktopDocumentBlocked {
    fn into_error(self) -> AppError {
        AppError::Blocked {
            reason: self.reason,
        }
    }
}

/// A failed desktop execution retains the live lease until command error mapping.
pub(crate) struct DesktopDocumentExecutionFailure {
    error: AppError,
    _lease: ConnectionLease,
}

impl fmt::Debug for DesktopDocumentExecutionFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DesktopDocumentExecutionFailure")
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}

impl DesktopDocumentExecutionFailure {
    fn into_error(self) -> AppError {
        self.error
    }
}

/// Scope-aware typed document service shared by desktop and Terminal CLI adapters.
#[derive(Clone)]
struct DocumentPlatformAdapter {
    store: Store,
    connections: ConnectionManager,
    operation: OperationRuntime,
}

use application::DocumentUseCases;
use ports::DocumentExecutionPort;
use recording::*;

type ComposedDocumentApplication = DocumentUseCases<DocumentPlatformAdapter>;

/// Public Document feature boundary used by desktop and authenticated Terminal transports.
#[derive(Clone)]
pub(crate) struct DocumentFeature {
    application: ComposedDocumentApplication,
}

impl DocumentFeature {
    pub(crate) async fn propose_desktop_read(
        &self,
        request: DesktopDocumentProposalRequest,
    ) -> Result<DesktopDocumentProposalReceipt, DesktopDocumentReadError> {
        self.application.propose_desktop_read(request).await
    }

    pub(crate) async fn run_desktop_read(
        &self,
        operation_id: Uuid,
    ) -> Result<DocumentReadReceipt, DesktopDocumentReadError> {
        self.application.run_desktop_read(operation_id).await
    }

    pub(crate) async fn run_terminal_read(
        &self,
        request: TerminalDocumentReadRequest,
    ) -> Result<DocumentReadReceipt, AgentDocumentReadError> {
        self.application.run_terminal_read(request).await
    }
}

pub(crate) fn compose(
    store: Store,
    connections: ConnectionManager,
    operation: OperationRuntime,
) -> DocumentFeature {
    DocumentFeature {
        application: DocumentUseCases::new(DocumentPlatformAdapter::new(
            store,
            connections,
            operation,
        )),
    }
}

impl DocumentPlatformAdapter {
    fn new(store: Store, connections: ConnectionManager, operation: OperationRuntime) -> Self {
        Self {
            store,
            connections,
            operation,
        }
    }
}

impl DocumentExecutionPort for DocumentPlatformAdapter {
    type DesktopProposalReceipt = DesktopDocumentProposalReceipt;
    type ReadReceipt = DocumentReadReceipt;
    type DesktopError = DesktopDocumentReadError;
    type TerminalError = AgentDocumentReadError;

    fn propose_desktop_read(
        &self,
        request: DesktopDocumentProposalRequest,
    ) -> impl std::future::Future<Output = Result<Self::DesktopProposalReceipt, Self::DesktopError>> + Send
    {
        DocumentPlatformAdapter::propose_desktop_read(self, request)
    }

    fn run_desktop_read(
        &self,
        operation_id: Uuid,
    ) -> impl std::future::Future<Output = Result<Self::ReadReceipt, Self::DesktopError>> + Send
    {
        DocumentPlatformAdapter::run_desktop_read(self, operation_id)
    }

    fn run_terminal_read(
        &self,
        request: TerminalDocumentReadRequest,
    ) -> impl std::future::Future<Output = Result<Self::ReadReceipt, Self::TerminalError>> + Send
    {
        DocumentPlatformAdapter::run_terminal_read(self, request)
    }
}
