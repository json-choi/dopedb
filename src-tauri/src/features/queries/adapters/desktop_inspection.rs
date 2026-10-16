//! Atomic desktop SQL inspection with one authority and policy snapshot.

use crate::connection::ensure_terminal_pin;
use crate::error::AppError;
use crate::kernel::TerminalAuthority;
use crate::model::QueryKind;
use crate::operations::capture_policy;
use crate::safety;

use super::super::domain::{DesktopPreviewIntent, DesktopSqlInspectionRequest};
use super::desktop_contracts::{
    DesktopSqlInspectionError, DesktopSqlInspectionReceipt, DesktopSqlPreviewAuthority,
};
use super::desktop_support::{desktop_preview_connection_access, pool_ref, skipped_preview_report};
use super::platform::QueryPlatformAdapter;

impl QueryPlatformAdapter {
    /// Inspect one statement under a single connection scope and safety snapshot.
    ///
    /// This is intentionally the only desktop inspection entry point: a caller
    /// cannot classify one profile revision then obtain an EXPLAIN from another.
    pub(crate) async fn inspect_desktop_sql(
        &self,
        request: DesktopSqlInspectionRequest,
    ) -> Result<DesktopSqlInspectionReceipt, DesktopSqlInspectionError> {
        self.inspect_sql(request, None).await
    }

    pub(super) async fn inspect_sql(
        &self,
        request: DesktopSqlInspectionRequest,
        terminal: Option<&TerminalAuthority>,
    ) -> Result<DesktopSqlInspectionReceipt, DesktopSqlInspectionError> {
        let operation_scope = self.connections.begin_operation_scope().await;
        let pin = match operation_scope
            .pin_connection_for_view(request.connection_id.into())
            .await
        {
            Ok(pin) => pin,
            Err(error) => return Err(scoped(error, operation_scope)),
        };
        if let Some(authority) = terminal {
            if let Err(error) = ensure_terminal_pin(authority, &pin) {
                return Err(scoped(error, operation_scope));
            }
        }
        let database = request
            .database
            .unwrap_or_else(|| pin.profile.database.clone());
        let namespace = match crate::executor::namespace::resolve_sql_namespace(
            &pin.profile,
            Some(&database),
            request.namespace,
        ) {
            Ok(namespace) => namespace,
            Err(error) => return Err(scoped(error, operation_scope)),
        };
        let analysis = match safety::classify_with_integrity(&request.sql, pin.profile.engine) {
            Ok(analysis) => analysis,
            Err(error) => return Err(scoped(error, operation_scope)),
        };
        let exact_single_read = analysis.is_exact_single_read();
        let may_touch_target = analysis.may_touch_target_for_impact_preview();
        let classification = analysis.classification;
        let settings = match self.store.get_safety(pin.connection_id).await {
            Ok(settings) => settings,
            Err(error) => return Err(scoped(error, operation_scope)),
        };
        let policy = match capture_policy(&pin, &settings) {
            Ok(policy) => policy,
            Err(error) => return Err(scoped(error, operation_scope)),
        };

        let preconnection = preconnection_report(
            request.intent,
            PreconnectionContext {
                integrity: analysis.integrity,
                classification: &classification,
                exact_single_read,
                may_touch_target,
                can_read: pin.profile.workspace_access.can_read(),
                can_write: pin.profile.workspace_access.can_write(),
                writes_enabled: settings.allow_writes,
            },
        );
        let report = match preconnection {
            Ok(report) => report,
            Err(error) => return Err(scoped(error, operation_scope)),
        };
        if let Some(report) = report {
            return Ok(DesktopSqlInspectionReceipt {
                classification,
                report,
                database,
                namespace,
                pin,
                policy_snapshot: policy.snapshot,
                policy_revision: policy.revision,
                _authority: DesktopSqlPreviewAuthority::Scope {
                    _scope: Box::new(operation_scope),
                },
            });
        }

        // The only remaining path is a clean ReadOnlyExplain or an explicitly
        // allowed ImpactPreview. It always acquires the read capability; write
        // credentials and write pools are unreachable before durable approval.
        let lease = match operation_scope
            .connect_to_database(
                pin.clone(),
                desktop_preview_connection_access(&classification, &settings),
                Some(database.clone()),
            )
            .await
        {
            Ok(lease) => lease,
            // `ConnectionOperationScope::connect` consumes its guard while it
            // authorizes and validates the pin. On failure it returns only an
            // `AppError`: no lease, pin, credential, or authority-bearing data
            // crosses this projection, and no target result exists to serialize.
            // Retaining that consumed guard would require a broad runtime API;
            // scope/lease-backed errors after a receipt exists remain `Scoped`.
            Err(error) => return Err(DesktopSqlInspectionError::Application(error)),
        };
        let live = match lease.live().sql() {
            Ok(live) => live,
            Err(error) => {
                return Err(DesktopSqlInspectionError::Scoped {
                    error,
                    _authority: DesktopSqlPreviewAuthority::Lease {
                        _lease: Box::new(lease),
                    },
                })
            }
        };
        let report = match safety::preview(
            pool_ref(live.ro()),
            &request.sql,
            namespace.as_deref(),
            &classification,
            &settings,
        )
        .await
        {
            Ok(report) => report,
            Err(error) => {
                return Err(DesktopSqlInspectionError::Scoped {
                    error,
                    _authority: DesktopSqlPreviewAuthority::Lease {
                        _lease: Box::new(lease),
                    },
                })
            }
        };

        Ok(DesktopSqlInspectionReceipt {
            classification,
            report,
            database,
            namespace,
            pin,
            policy_snapshot: policy.snapshot,
            policy_revision: policy.revision,
            _authority: DesktopSqlPreviewAuthority::Lease {
                _lease: Box::new(lease),
            },
        })
    }
}

fn scoped(
    error: AppError,
    operation_scope: crate::connection::ConnectionOperationScope,
) -> DesktopSqlInspectionError {
    DesktopSqlInspectionError::Scoped {
        error,
        _authority: DesktopSqlPreviewAuthority::Scope {
            _scope: Box::new(operation_scope),
        },
    }
}

/// Return a report that is safe to produce without opening the target, or reject
/// a casual read-only EXPLAIN before any credential request.
struct PreconnectionContext<'a> {
    integrity: safety::ClassificationIntegrity,
    classification: &'a crate::model::Classification,
    exact_single_read: bool,
    may_touch_target: bool,
    can_read: bool,
    can_write: bool,
    writes_enabled: bool,
}

fn preconnection_report(
    intent: DesktopPreviewIntent,
    context: PreconnectionContext<'_>,
) -> Result<Option<crate::model::PreviewReport>, AppError> {
    let no_target_touch_note = if matches!(
        context.integrity,
        safety::ClassificationIntegrity::DocumentFamily
    ) {
        Some("MongoDB document operations must use the typed document-query API")
    } else if matches!(
        context.integrity,
        safety::ClassificationIntegrity::ParseFailed
            | safety::ClassificationIntegrity::MultipleStatements
            | safety::ClassificationIntegrity::Ambiguous
    ) {
        Some("ambiguous or multi-statement SQL — impact preview skipped before target access")
    } else if matches!(
        context.classification.kind,
        QueryKind::Ddl | QueryKind::Privilege
    ) {
        Some("DDL / privilege change — no row-count preview; review the statement directly.")
    } else if !context.may_touch_target {
        Some("write shape is not rollback-safe — impact preview skipped before target access")
    } else {
        None
    };

    match intent {
        DesktopPreviewIntent::ReadOnlyExplain => {
            if !context.exact_single_read {
                return Err(AppError::Blocked {
                    reason: "SQL Explain only supports one unambiguous read statement".into(),
                });
            }
            if !context.can_read {
                return Err(AppError::Blocked {
                    reason: "workspace role cannot execute this connection".into(),
                });
            }
            Ok(None)
        }
        DesktopPreviewIntent::AutoRunRead => {
            if matches!(context.classification.kind, QueryKind::Read) && !context.can_read {
                return Err(AppError::Blocked {
                    reason: "workspace role cannot execute this connection".into(),
                });
            }
            // The read starts immediately and no surface shows its plan, so an
            // EXPLAIN would only add target round trips (and a second remote grant
            // check for shared connections) before the first row.
            Ok(Some(skipped_preview_report(
                no_target_touch_note
                    .unwrap_or("auto-run read — executed directly without an EXPLAIN preview"),
            )))
        }
        DesktopPreviewIntent::ImpactPreview => {
            if let Some(note) = no_target_touch_note {
                return Ok(Some(skipped_preview_report(note)));
            }
            if !matches!(context.classification.kind, QueryKind::Read) && !context.can_write {
                return Ok(Some(skipped_preview_report(
                    "workspace role is read-only — write preview skipped",
                )));
            }
            if !matches!(context.classification.kind, QueryKind::Read) && !context.writes_enabled {
                return Ok(Some(skipped_preview_report(
                    "writes are disabled for this connection — impact preview skipped (no rows locked)",
                )));
            }
            if matches!(context.classification.kind, QueryKind::Read) && !context.can_read {
                return Err(AppError::Blocked {
                    reason: "workspace role cannot execute this connection".into(),
                });
            }
            Ok(None)
        }
    }
}
