//! Device-local, opt-in diagnostics. One bounded memory buffer owns collection;
//! no persistence, telemetry, query payloads, or external upload is provided.

mod redaction;
pub(crate) mod transport;

use std::{collections::VecDeque, fmt, sync::Mutex};

use serde::{Deserialize, Serialize};
use tracing::{
    field::{Field, Visit},
    Event, Subscriber,
};
use tracing_subscriber::{layer::Context, Layer};

use crate::kernel::sync::lock_unpoisoned;

const MAX_ENTRIES: usize = 1_000;
const MAX_TEXT_BYTES: usize = 4_096;
const MAX_FIELDS: usize = 24;
static LOG: Mutex<Buffer> = Mutex::new(Buffer::new());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    timestamp: String,
    level: String,
    source: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    enabled: bool,
    generation: u64,
    app_version: &'static str,
    platform: &'static str,
    architecture: &'static str,
    dropped: usize,
    entries: Vec<Entry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FrontendEntry {
    pub(crate) level: String,
    pub(crate) source: String,
    pub(crate) text: String,
}

struct Buffer {
    enabled: bool,
    generation: u64,
    dropped: usize,
    entries: VecDeque<Entry>,
}

impl Buffer {
    const fn new() -> Self {
        Self {
            enabled: false,
            generation: 0,
            dropped: 0,
            entries: VecDeque::new(),
        }
    }

    fn clear(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.entries.clear();
        self.dropped = 0;
    }

    fn push(&mut self, level: &str, source: &str, text: &str) {
        if !self.enabled {
            return;
        }
        if self.entries.len() == MAX_ENTRIES {
            self.entries.pop_front();
            self.dropped = self.dropped.saturating_add(1);
        }
        self.entries.push_back(Entry {
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            level: bounded(level, 8),
            source: bounded(source, 160),
            text: bounded(&redaction::scrub(text), MAX_TEXT_BYTES),
        });
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            enabled: self.enabled,
            generation: self.generation,
            app_version: env!("CARGO_PKG_VERSION"),
            platform: std::env::consts::OS,
            architecture: std::env::consts::ARCH,
            dropped: self.dropped,
            entries: self.entries.iter().cloned().collect(),
        }
    }
}

pub(crate) fn snapshot() -> Snapshot {
    lock_unpoisoned(&LOG).snapshot()
}

pub(crate) fn set_enabled(enabled: bool) -> Snapshot {
    let mut log = lock_unpoisoned(&LOG);
    if log.enabled != enabled {
        log.clear();
        log.enabled = enabled;
        log.push(
            "INFO",
            "diagnostics",
            "Local diagnostics collection enabled",
        );
    }
    log.snapshot()
}

pub(crate) fn clear() -> Snapshot {
    let mut log = lock_unpoisoned(&LOG);
    log.clear();
    log.snapshot()
}

pub(crate) fn append(generation: u64, entries: Vec<FrontendEntry>) {
    let mut log = lock_unpoisoned(&LOG);
    if !log.enabled || log.generation != generation {
        return;
    }
    for entry in entries.into_iter().take(50) {
        if !["ERROR", "WARN", "INFO", "DEBUG"].contains(&entry.level.as_str())
            || !["frontend", "ipc", "console"].contains(&entry.source.as_str())
        {
            continue;
        }
        log.push(&entry.level, &entry.source, &entry.text);
    }
}

pub(crate) struct DiagnosticsLayer;

impl<S: Subscriber> Layer<S> for DiagnosticsLayer {
    fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
        // Hold collection ownership through formatting so disabling also drops
        // events that were racing with the toggle.
        let mut log = lock_unpoisoned(&LOG);
        if !log.enabled {
            return;
        }
        let mut visitor = DiagnosticFields { fields: Vec::new() };
        event.record(&mut visitor);
        log.push(
            event.metadata().level().as_str(),
            event.metadata().target(),
            &visitor.fields.join(" "),
        );
    }
}

struct DiagnosticFields {
    fields: Vec<String>,
}

impl Visit for DiagnosticFields {
    fn record_str(&mut self, field: &Field, value: &str) {
        if self.fields.len() == MAX_FIELDS || redaction::excluded_field(field.name()) {
            return;
        }
        self.fields.push(format!(
            "{}={}",
            field.name(),
            bounded(&redaction::scrub(value), MAX_TEXT_BYTES)
        ));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if self.fields.len() == MAX_FIELDS || redaction::excluded_field(field.name()) {
            return;
        }
        self.fields.push(format!(
            "{}={}",
            field.name(),
            bounded(&redaction::scrub(&format!("{value:?}")), MAX_TEXT_BYTES)
        ));
    }
}

fn bounded(text: &str, limit: usize) -> String {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

#[cfg(test)]
pub(crate) fn assert_local_diagnostics_contract() {
    use tracing_subscriber::layer::SubscriberExt;

    redaction::assert_redaction_contract();
    let mut log = Buffer::new();
    log.push("ERROR", "frontend", "not collected");
    assert!(log.entries.is_empty());
    log.enabled = true;
    for index in 0..MAX_ENTRIES + 2 {
        log.push("DEBUG", "ipc", &index.to_string());
    }
    assert_eq!(log.entries.len(), MAX_ENTRIES);
    assert_eq!(log.dropped, 2);
    assert_eq!(log.entries.front().unwrap().text, "2");
    log.push("ERROR", "frontend", &"한".repeat(MAX_TEXT_BYTES));
    assert!(log.entries.back().unwrap().text.len() <= MAX_TEXT_BYTES);
    let generation = log.generation;
    log.clear();
    assert_ne!(log.generation, generation);
    assert_eq!(log.dropped, 0);
    assert!(log.entries.is_empty());
    log.enabled = false;
    log.push("ERROR", "frontend", "not collected");
    assert!(log.entries.is_empty());
    let wire = serde_json::to_value(log.snapshot()).unwrap();
    assert_eq!(wire["enabled"], false);
    assert_eq!(wire["appVersion"], env!("CARGO_PKG_VERSION"));
    let enabled = set_enabled(true);
    tracing::subscriber::with_default(
        tracing_subscriber::registry().with(DiagnosticsLayer),
        || {
            tracing::warn!(
                host = "db.internal",
                password = "diagnostic-secret",
                sql = "private-query",
                error = "password=diagnostic-secret",
                "local diagnostic regression"
            )
        },
    );
    let captured = snapshot();
    let diagnostic = captured.entries.last().unwrap();
    assert!(diagnostic.source.starts_with(env!("CARGO_CRATE_NAME")));
    assert!(diagnostic.text.contains("db.internal"));
    assert!(!diagnostic.text.contains("diagnostic-secret"));
    assert!(!diagnostic.text.contains("private-query"));
    let cleared = clear();
    append(
        enabled.generation,
        vec![FrontendEntry {
            level: "ERROR".into(),
            source: "frontend".into(),
            text: "stale event".into(),
        }],
    );
    assert!(snapshot().entries.is_empty());
    append(
        cleared.generation,
        vec![FrontendEntry {
            level: "ERROR".into(),
            source: "frontend".into(),
            text: "password=diagnostic-secret host=db.internal".into(),
        }],
    );
    assert_eq!(snapshot().entries.len(), 1);
    assert!(!snapshot().entries[0].text.contains("diagnostic-secret"));
    assert!(snapshot().entries[0].text.contains("db.internal"));
    let disabled = set_enabled(false);
    assert!(!disabled.enabled);
    assert!(disabled.entries.is_empty());
}
