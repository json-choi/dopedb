//! ACP session admission cap and reclamation of prepared sessions nobody prompted.
//!
//! Background preparation must never exhaust the live-session cap: unprompted
//! ready sessions yield their slot first and are closed after an idle TTL.

use super::*;

impl AcpRuntime {
    /// Admit one more live session. Prepared sessions that were never prompted
    /// are the first to yield their slot, oldest first, so background
    /// preparation can never exhaust the cap for real conversations.
    pub(super) fn admit_session(&self) -> AppResult<()> {
        let live = || {
            self.sessions
                .iter()
                .filter(|entry| {
                    !matches!(
                        entry.value().summary().lifecycle,
                        AcpSessionLifecycle::Closed | AcpSessionLifecycle::Failed
                    )
                })
                .count()
        };
        if live() < MAX_ACTIVE_SESSIONS {
            return Ok(());
        }
        for (id, _) in self.untouched_ready_sessions() {
            let _ = self.close(id);
            if live() < MAX_ACTIVE_SESSIONS {
                return Ok(());
            }
        }
        Err(AppError::Blocked {
            reason: AGENT_SESSION_LIMIT.into(),
        })
    }

    /// Never-prompted ready sessions, least recently updated first.
    fn untouched_ready_sessions(&self) -> Vec<(AcpSessionId, chrono::DateTime<Utc>)> {
        let mut untouched = self
            .sessions
            .iter()
            .filter_map(|entry| {
                let session = entry.value();
                let summary = session.summary();
                (summary.lifecycle == AcpSessionLifecycle::Ready
                    && !session.prompted.load(Ordering::SeqCst)
                    && !session.busy.load(Ordering::SeqCst))
                .then_some((*entry.key(), summary.updated_at))
            })
            .collect::<Vec<_>>();
        untouched.sort_by_key(|(_, updated_at)| *updated_at);
        untouched
    }

    pub(super) fn ensure_idle_sweeper(&self) {
        if self.idle_sweeper_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let runtime = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(IDLE_SESSION_SWEEP_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                runtime.close_idle_unprompted();
            }
        });
    }

    /// Close prepared sessions nobody prompted within the idle TTL. The newest
    /// untouched session of each provider is kept: it is the one the panel is
    /// holding ready, and closing it would only make the panel prepare again.
    fn close_idle_unprompted(&self) {
        let Ok(ttl) = chrono::Duration::from_std(UNPROMPTED_SESSION_IDLE_TTL) else {
            return;
        };
        let cutoff = Utc::now() - ttl;
        let untouched = self.untouched_ready_sessions();
        let mut newest: Vec<(AgentProvider, AcpSessionId)> = Vec::new();
        for (id, _) in &untouched {
            let Some(provider) = self
                .sessions
                .get(id)
                .map(|session| session.summary().provider)
            else {
                continue;
            };
            match newest.iter_mut().find(|(kept, _)| *kept == provider) {
                Some(entry) => entry.1 = *id,
                None => newest.push((provider, *id)),
            }
        }
        for (id, updated_at) in untouched {
            if updated_at > cutoff || newest.iter().any(|(_, kept)| *kept == id) {
                continue;
            }
            let _ = self.close(id);
        }
    }
}
