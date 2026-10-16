//! Ends of a manual transaction other than a COMMIT: the user's ROLLBACK, the
//! 30-minute expiry timer, an abandoned statement, revocation on a scope or
//! authority change, and application shutdown. Every end rolls back (closing the
//! connection when ROLLBACK is not acknowledged, which also rolls back), is
//! audited, and publishes its reason so the UI can explain ends the user did not
//! initiate.
//!
//! It also owns the close/quit decision: while a transaction is open, closing the
//! window or quitting waits for the user to confirm a rollback. Nothing here
//! knows the windowing layer; the transport adapter maps its events onto it.

use std::pin::Pin;

use super::*;

/// How long a close or quit prompt may go unacknowledged before the next request
/// proceeds without it, because the renderer is missing or frozen. The exit hook
/// still rolls every open transaction back, so nothing is ever committed.
const EXIT_PROMPT_ACK_TIMEOUT: Duration = Duration::from_secs(5);

/// What the user asked to end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExitIntent {
    CloseWindow,
    Quit,
}

/// The answer to a close or quit request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExitDecision {
    Proceed,
    /// Hold the request and ask whether to roll back this many transactions.
    Ask(usize),
}

/// Close/quit confirmation state; only the runtime methods below change it.
#[derive(Default)]
pub(super) struct ExitPrompt {
    /// Set once the user confirmed (or a prompt went unanswered): every later
    /// request proceeds, so a confirmed exit never asks again.
    allowed: bool,
    pending: Option<PendingExit>,
}

struct PendingExit {
    intent: ExitIntent,
    asked_at: Instant,
    shown: bool,
}

impl ExitPrompt {
    /// Proceed when nothing is open, after a confirmation, or when the previous
    /// prompt went unacknowledged for `EXIT_PROMPT_ACK_TIMEOUT`; otherwise hold
    /// the request and ask (again).
    fn decide(&mut self, open: usize, intent: ExitIntent, now: Instant) -> ExitDecision {
        if self.allowed || open == 0 {
            return ExitDecision::Proceed;
        }
        match &mut self.pending {
            Some(pending)
                if !pending.shown
                    && now.saturating_duration_since(pending.asked_at)
                        >= EXIT_PROMPT_ACK_TIMEOUT =>
            {
                self.allowed = true;
                ExitDecision::Proceed
            }
            Some(pending) => {
                if intent == ExitIntent::Quit {
                    pending.intent = intent;
                }
                if pending.shown {
                    // Asked again: this prompt needs its own acknowledgement.
                    pending.shown = false;
                    pending.asked_at = now;
                }
                ExitDecision::Ask(open)
            }
            None => {
                self.pending = Some(PendingExit {
                    intent,
                    asked_at: now,
                    shown: false,
                });
                ExitDecision::Ask(open)
            }
        }
    }
}

/// Map a connection-runtime revocation reason to the user-facing end reason.
fn revocation_end_reason(reason: &str) -> ManualTransactionEndReason {
    match reason {
        "application exiting" | "application shutdown" => {
            ManualTransactionEndReason::ApplicationExit
        }
        "connection profile changed" => ManualTransactionEndReason::ConnectionChanged,
        "workspace changed" | "workspace account changed" | "workspace account removed" => {
            ManualTransactionEndReason::WorkspaceChanged
        }
        _ => ManualTransactionEndReason::AuthorityChanged,
    }
}

impl ManualTransactionRuntime {
    pub(crate) async fn rollback(
        &self,
        connection_id: Uuid,
        transaction_id: Uuid,
    ) -> AppResult<ManualTransactionStatus> {
        let session = self.exact(connection_id, transaction_id).await?;
        self.unmap(connection_id, &session).await;
        let status = session.status();
        let warning = session.roll_back().await;
        self.publish_ended(&session, ManualTransactionEndReason::RolledBack);
        if let Err(error) = self
            .record_boundary(&session, "manual_transaction:rollback", "ROLLBACK", warning)
            .await
        {
            tracing::warn!(
                %connection_id,
                %transaction_id,
                %error,
                "manual transaction rollback audit receipt failed"
            );
        }
        Ok(status)
    }

    /// Roll back every open transaction before exit, concurrently and bounded by
    /// each rollback's own acknowledgement timeout.
    pub(crate) async fn shutdown(&self) {
        self.revoke(None, "application shutdown").await;
    }

    /// Decide a close or quit request. It proceeds when no transaction is open,
    /// after a confirmation, or when the previous prompt was never shown;
    /// otherwise it is held while the user is asked.
    pub(crate) async fn exit_decision(&self, intent: ExitIntent) -> ExitDecision {
        let open = self.snapshot().await.len();
        lock_unpoisoned(&self.exit).decide(open, intent, Instant::now())
    }

    /// The renderer is showing the close/quit prompt.
    pub(crate) fn exit_prompt_shown(&self) {
        if let Some(pending) = lock_unpoisoned(&self.exit).pending.as_mut() {
            pending.shown = true;
        }
    }

    /// The user kept the application open.
    pub(crate) fn exit_cancelled(&self) {
        lock_unpoisoned(&self.exit).pending = None;
    }

    /// The user confirmed: roll every open transaction back (never commit) and
    /// let every later close or quit request proceed. Returns what to end; a
    /// confirmation without a waiting request still honours the user and quits.
    pub(crate) async fn confirm_exit(&self) -> ExitIntent {
        let intent = lock_unpoisoned(&self.exit)
            .pending
            .take()
            .map_or(ExitIntent::Quit, |pending| pending.intent);
        self.shutdown().await;
        lock_unpoisoned(&self.exit).allowed = true;
        intent
    }

    pub(super) async fn record_boundary(
        &self,
        session: &ManualSession,
        action: &'static str,
        sql: &'static str,
        error: Option<String>,
    ) -> AppResult<()> {
        crate::audit::record(
            &self.store,
            crate::audit::RecordArgs {
                connection_id: session.connection_id,
                engine: session.engine,
                agent_prompt: None,
                sql: sql.into(),
                kind: QueryKind::Write,
                action: action.into(),
                approved_by: None,
                affected_estimate: None,
                error,
            },
        )
        .await?;
        Ok(())
    }

    pub(super) fn publish_ended(
        &self,
        session: &ManualSession,
        reason: ManualTransactionEndReason,
    ) {
        let status = session.status();
        self.publish(
            session.connection_id,
            None,
            Some(ManualTransactionEnded {
                transaction_id: session.transaction_id,
                database: session.database.clone(),
                reason,
                statement_count: status.statement_count,
            }),
        );
    }

    pub(super) fn schedule_expiry(&self, session: &Arc<ManualSession>) {
        let runtime = self.clone();
        let expires_at = session.expires_at;
        let connection_id = session.connection_id;
        let session = Arc::downgrade(session);
        tokio::spawn(async move {
            let delay = (expires_at - Utc::now()).to_std().unwrap_or_default();
            tokio::time::sleep(delay).await;
            if let Some(session) = session.upgrade() {
                runtime
                    .end_session(
                        connection_id,
                        Some(session),
                        ManualTransactionEndReason::Expired,
                        "transaction expired",
                    )
                    .await;
            }
        });
    }

    /// End an expired session found by a status read without blocking that read.
    pub(super) fn spawn_expired_end(&self, session: Arc<ManualSession>) {
        let runtime = self.clone();
        tokio::spawn(async move {
            runtime
                .end_session(
                    session.connection_id,
                    Some(session),
                    ManualTransactionEndReason::Expired,
                    "transaction expired",
                )
                .await;
        });
    }

    /// End a session without a user command: unmap it, roll back (closing the
    /// connection when ROLLBACK is not acknowledged), audit, and publish why.
    pub(super) async fn end_session(
        &self,
        connection_id: Uuid,
        expected: Option<Arc<ManualSession>>,
        reason: ManualTransactionEndReason,
        detail: &str,
    ) {
        let session = {
            let mut sessions = self.sessions.lock().await;
            let matches = match (sessions.get(&connection_id), expected.as_ref()) {
                (Some(current), Some(expected)) => Arc::ptr_eq(current, expected),
                (Some(_), None) => true,
                _ => false,
            };
            matches.then(|| sessions.remove(&connection_id)).flatten()
        };
        if let Some(session) = session {
            self.end_unmapped(&session, reason, detail).await;
        }
    }

    async fn end_unmapped(
        &self,
        session: &ManualSession,
        reason: ManualTransactionEndReason,
        detail: &str,
    ) {
        let warning = session.roll_back().await;
        self.publish_ended(session, reason);
        let detail = match warning {
            Some(warning) => format!("{detail}; {warning}"),
            None => detail.to_owned(),
        };
        if let Err(error) = self
            .record_boundary(
                session,
                "manual_transaction:forced_rollback",
                "ROLLBACK",
                Some(detail),
            )
            .await
        {
            tracing::warn!(
                connection_id = %session.connection_id,
                transaction_id = %session.transaction_id,
                %error,
                "manual transaction forced rollback audit receipt failed"
            );
        }
    }
}

impl ConnectionSessionRevocationPort for ManualTransactionRuntime {
    fn revoke<'a>(
        &'a self,
        connection_id: Option<Uuid>,
        reason: &'static str,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            let sessions = {
                let mut sessions = self.sessions.lock().await;
                match connection_id {
                    Some(connection_id) => sessions
                        .remove(&connection_id)
                        .into_iter()
                        .collect::<Vec<_>>(),
                    None => sessions.drain().map(|(_, session)| session).collect(),
                }
            };
            let end_reason = revocation_end_reason(reason);
            futures::future::join_all(
                sessions
                    .iter()
                    .map(|session| self.end_unmapped(session, end_reason, reason)),
            )
            .await;
        })
    }
}
