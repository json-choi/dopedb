//! Transport-neutral audit verification and execution-history reads.

mod application;
mod ports;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::audit;
use crate::error::AppResult;
use crate::model::{AuditCursor, AuditEntry, AuditPage, HistoryCursor, HistoryEntry, HistoryPage};
use crate::store::Store;

use application::ActivityUseCases;
use ports::ActivityPort;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditVerdict {
    pub(crate) ok: bool,
    pub(crate) first_bad_index: Option<i64>,
    pub(crate) first_bad_id: Option<Uuid>,
    /// Page cursor anchor for the first broken record (`rowId < firstBadRowId + 1`).
    pub(crate) first_bad_row_id: Option<i64>,
    pub(crate) entry_count: i64,
    pub(crate) tail_hash: Option<String>,
    /// Comparison with the tail anchor every append advances; `ok` requires `matched`.
    pub(crate) anchor_status: audit::AuditAnchorStatus,
    pub(crate) anchored_count: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuditPageRequest {
    pub(crate) connection_id: Uuid,
    pub(crate) cursor: Option<AuditCursor>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryPageRequest {
    pub(crate) connection_id: Uuid,
    pub(crate) cursor: Option<HistoryCursor>,
    pub(crate) search: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) origin: Option<String>,
}

#[derive(Clone)]
struct ActivityPlatformAdapter {
    store: Store,
}

type ComposedActivityApplication = ActivityUseCases<ActivityPlatformAdapter>;

#[derive(Clone)]
pub(crate) struct ActivityFeature {
    application: ComposedActivityApplication,
}

impl ActivityFeature {
    pub(crate) async fn verify_audit(&self, connection_id: Uuid) -> AppResult<AuditVerdict> {
        self.application.verify_audit(connection_id).await
    }

    pub(crate) async fn audit_page(&self, request: AuditPageRequest) -> AppResult<AuditPage> {
        self.application.audit_page(request).await
    }

    pub(crate) async fn audit_entry(
        &self,
        connection_id: Uuid,
        entry_id: Uuid,
    ) -> AppResult<AuditEntry> {
        self.application.audit_entry(connection_id, entry_id).await
    }

    pub(crate) async fn history_page(&self, request: HistoryPageRequest) -> AppResult<HistoryPage> {
        self.application.history_page(request).await
    }

    pub(crate) async fn history_entry(
        &self,
        connection_id: Uuid,
        history_id: Uuid,
    ) -> AppResult<HistoryEntry> {
        self.application
            .history_entry(connection_id, history_id)
            .await
    }
}

pub(crate) fn compose(store: Store) -> ActivityFeature {
    ActivityFeature {
        application: ActivityUseCases::new(ActivityPlatformAdapter::new(store)),
    }
}

impl ActivityPlatformAdapter {
    fn new(store: Store) -> Self {
        Self { store }
    }

    pub(crate) async fn verify_audit(&self, connection_id: Uuid) -> AppResult<AuditVerdict> {
        self.store.get_connection(connection_id).await?;
        let verification = audit::verify_chain(&self.store, connection_id).await?;
        Ok(AuditVerdict {
            ok: verification.ok,
            first_bad_index: verification.first_bad_index,
            first_bad_id: verification.first_bad_id,
            first_bad_row_id: verification.first_bad_row_id,
            entry_count: verification.entry_count,
            tail_hash: verification.tail_hash,
            anchor_status: verification.anchor_status,
            anchored_count: verification.anchored_count,
        })
    }

    pub(crate) async fn audit_page(&self, request: AuditPageRequest) -> AppResult<AuditPage> {
        self.store.get_connection(request.connection_id).await?;
        audit::page_after(&self.store, request.connection_id, request.cursor).await
    }

    pub(crate) async fn audit_entry(
        &self,
        connection_id: Uuid,
        entry_id: Uuid,
    ) -> AppResult<AuditEntry> {
        self.store.get_connection(connection_id).await?;
        audit::entry(&self.store, connection_id, entry_id).await
    }

    pub(crate) async fn history_page(&self, request: HistoryPageRequest) -> AppResult<HistoryPage> {
        self.store
            .list_history_page(
                request.connection_id,
                request.cursor,
                request.search.as_deref(),
                request.status.as_deref(),
                request.origin.as_deref(),
            )
            .await
    }

    pub(crate) async fn history_entry(
        &self,
        connection_id: Uuid,
        history_id: Uuid,
    ) -> AppResult<HistoryEntry> {
        self.store
            .get_history_entry(connection_id, history_id)
            .await
    }
}

impl ActivityPort for ActivityPlatformAdapter {
    fn verify_audit(
        &self,
        connection_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<AuditVerdict>> + Send {
        ActivityPlatformAdapter::verify_audit(self, connection_id)
    }

    fn audit_page(
        &self,
        request: AuditPageRequest,
    ) -> impl std::future::Future<Output = AppResult<AuditPage>> + Send {
        ActivityPlatformAdapter::audit_page(self, request)
    }

    fn audit_entry(
        &self,
        connection_id: Uuid,
        entry_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<AuditEntry>> + Send {
        ActivityPlatformAdapter::audit_entry(self, connection_id, entry_id)
    }

    fn history_page(
        &self,
        request: HistoryPageRequest,
    ) -> impl std::future::Future<Output = AppResult<HistoryPage>> + Send {
        ActivityPlatformAdapter::history_page(self, request)
    }

    fn history_entry(
        &self,
        connection_id: Uuid,
        history_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<HistoryEntry>> + Send {
        ActivityPlatformAdapter::history_entry(self, connection_id, history_id)
    }
}
