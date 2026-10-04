//! Removes recognizable authentication material before retaining diagnostic text.
//! This is a credential safeguard, not a guarantee of anonymized support logs.

use std::sync::LazyLock;

use regex::Regex;

static CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r#"(?i)(["']?(?:password|passwd|pwd|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|api[_-]?key|authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}&]+)"#,
).expect("constant credential pattern")
});
static BEARER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+")
        .expect("constant authorization pattern")
});
static PRIVATE_KEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)")
        .expect("constant private key pattern")
});
static URL_CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)([a-z][a-z0-9+.-]*://)[^\s/@]+@").expect("constant URI credential pattern")
});

pub(super) fn excluded_field(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "password",
        "passwd",
        "token",
        "secret",
        "credential",
        "private_key",
        "authorization",
        "cookie",
        "sql",
        "query",
        "prompt",
        "payload",
        "body",
        "rows",
        "result",
        "params",
        "arguments",
        "headers",
    ]
    .iter()
    .any(|part| name.contains(part))
        || matches!(name.as_str(), "key" | "api_key" | "input" | "output")
}

pub(super) fn scrub(text: &str) -> String {
    let text = PRIVATE_KEY.replace_all(text, "[REDACTED PRIVATE KEY]");
    let text = URL_CREDENTIALS.replace_all(&text, "${1}[REDACTED]@");
    let text = BEARER.replace_all(&text, "[REDACTED AUTHORIZATION]");
    CREDENTIALS
        .replace_all(&text, "${1}[REDACTED]")
        .into_owned()
}

#[cfg(test)]
pub(super) fn assert_redaction_contract() {
    for text in [
        "password=diagnostic-secret host=db.internal",
        r#"{"password":"diagnostic-secret","host":"db.internal"}"#,
        "PASSWORD = 'diagnostic-secret with spaces'",
        "Authorization: Bearer diagnostic-secret",
        "postgresql://reader:diagnostic-secret@db.internal/appdb",
        "postgres://reader:diagnostic-secret@db.internal/appdb?sslmode=require",
        "access_token=diagnostic-secret&host=db.internal",
        "refreshToken: diagnostic-secret",
        "-----BEGIN OPENSSH PRIVATE KEY-----\ndiagnostic-secret\n-----END OPENSSH PRIVATE KEY-----",
        "-----BEGIN PRIVATE KEY-----\ndiagnostic-secret",
    ] {
        let safe = scrub(text);
        assert!(
            !safe.contains("diagnostic-secret"),
            "credential redaction failed"
        );
    }
    assert_eq!(
        scrub("host=db.internal database=appdb user=reader /tmp/project"),
        "host=db.internal database=appdb user=reader /tmp/project"
    );
    for name in [
        "password",
        "access_token",
        "sql",
        "query_text",
        "rows",
        "prompt",
        "payload",
        "private_key",
    ] {
        assert!(excluded_field(name));
    }
    for name in ["message", "error", "connection_id", "duration_ms", "host"] {
        assert!(!excluded_field(name));
    }
}
