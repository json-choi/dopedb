//! Per-pool presentation facts SQLx does not expose on a row: the PostgreSQL
//! MONEY scale from `lc_monetary` and the session time zone's fixed offset (for
//! PostgreSQL instants and MySQL `TIMESTAMP`). Every session of one pool shares its
//! connect options and startup settings, so each pool is probed once, outside any
//! read transaction, and a probe a compatible engine rejects falls back to defaults.

use std::sync::{Arc, Mutex, Weak};

use sqlx::mysql::{MySqlConnectOptions, MySqlConnection, MySqlPool};
use sqlx::postgres::{PgConnectOptions, PgConnection, PgPool};
use sqlx::Row;

use crate::kernel::sync::lock_unpoisoned;

use super::values;

/// Presentation facts probed once per pool. Every session of a pool shares its
/// connect options and startup settings. A `Weak` handle identifies the pool's
/// options without keeping them (or a short-lived credential inside) alive, while
/// still pinning the allocation so another pool cannot reuse its address.
struct SessionFactsCache<O> {
    entries: Mutex<Vec<(Weak<O>, values::SessionFacts)>>,
}

const SESSION_FACTS_CACHE_LIMIT: usize = 32;

impl<O> SessionFactsCache<O> {
    const fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
        }
    }

    fn get(&self, options: &Arc<O>) -> Option<values::SessionFacts> {
        lock_unpoisoned(&self.entries)
            .iter()
            .find(|(cached, _)| std::ptr::eq(cached.as_ptr(), Arc::as_ptr(options)))
            .map(|(_, facts)| *facts)
    }

    fn insert(&self, options: &Arc<O>, facts: values::SessionFacts) {
        let mut entries = lock_unpoisoned(&self.entries);
        entries.retain(|(cached, _)| cached.strong_count() > 0);
        if entries
            .iter()
            .any(|(cached, _)| std::ptr::eq(cached.as_ptr(), Arc::as_ptr(options)))
        {
            return;
        }
        if entries.len() >= SESSION_FACTS_CACHE_LIMIT {
            entries.remove(0);
        }
        entries.push((Arc::downgrade(options), facts));
    }
}

static PG_SESSION_FACTS: SessionFactsCache<PgConnectOptions> = SessionFactsCache::new();
static MYSQL_SESSION_FACTS: SessionFactsCache<MySqlConnectOptions> = SessionFactsCache::new();

/// One simple-protocol round trip per pool, outside any read transaction so a
/// server without MONEY (PostgreSQL-compatible engines) cannot abort the read.
const PG_SESSION_PROBES: [&str; 2] = [
    "SELECT scale((1::money)::numeric)::int4, \
     extract(timezone FROM timestamptz '2025-01-15 12:00:00+00')::int4, \
     extract(timezone FROM timestamptz '2025-07-15 12:00:00+00')::int4",
    "SELECT 2::int4, \
     extract(timezone FROM timestamptz '2025-01-15 12:00:00+00')::int4, \
     extract(timezone FROM timestamptz '2025-07-15 12:00:00+00')::int4",
];

const MYSQL_SESSION_PROBE: &str = "SELECT \
     TIMESTAMPDIFF(SECOND, '2025-01-15 12:00:00', CONVERT_TZ('2025-01-15 12:00:00', '+00:00', @@session.time_zone)), \
     TIMESTAMPDIFF(SECOND, '2025-07-15 12:00:00', CONVERT_TZ('2025-07-15 12:00:00', '+00:00', @@session.time_zone))";

/// A zone presents instants in one offset only when winter and summer agree.
fn session_facts(
    money_digits: Option<i64>,
    winter_offset: Option<i64>,
    summer_offset: Option<i64>,
) -> values::SessionFacts {
    let defaults = values::SessionFacts::default();
    values::SessionFacts {
        money_digits: money_digits
            .and_then(|digits| u32::try_from(digits).ok())
            .filter(|digits| *digits <= 10)
            .unwrap_or(defaults.money_digits),
        instant_offset_seconds: match (winter_offset, summer_offset) {
            (Some(winter), Some(summer)) if winter == summer => i32::try_from(winter)
                .ok()
                .filter(|offset| offset.unsigned_abs() < 86_400),
            _ => None,
        },
    }
}

pub(crate) async fn pg_session_facts(
    pool: &PgPool,
    connection: &mut PgConnection,
) -> values::SessionFacts {
    let options = pool.connect_options();
    if let Some(facts) = PG_SESSION_FACTS.get(&options) {
        return facts;
    }
    let mut facts = values::SessionFacts::default();
    for probe in PG_SESSION_PROBES {
        if let Ok(row) = sqlx::raw_sql(probe).fetch_one(&mut *connection).await {
            let column = |index: usize| row.try_get::<i32, _>(index).ok().map(i64::from);
            facts = session_facts(column(0), column(1), column(2));
            break;
        }
    }
    PG_SESSION_FACTS.insert(&options, facts);
    facts
}

pub(crate) async fn mysql_session_facts(
    pool: &MySqlPool,
    connection: &mut MySqlConnection,
) -> values::SessionFacts {
    let options = pool.connect_options();
    if let Some(facts) = MYSQL_SESSION_FACTS.get(&options) {
        return facts;
    }
    let facts = match sqlx::raw_sql(MYSQL_SESSION_PROBE)
        .fetch_one(&mut *connection)
        .await
    {
        Ok(row) => {
            let column = |index: usize| row.try_get::<Option<i64>, _>(index).ok().flatten();
            session_facts(None, column(0), column(1))
        }
        Err(_) => values::SessionFacts::default(),
    };
    MYSQL_SESSION_FACTS.insert(&options, facts);
    facts
}
