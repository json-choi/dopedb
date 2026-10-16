//! Lossless JSON decoding for PostgreSQL, MySQL, and SQLite rows.
//!
//! PostgreSQL scalars whose SQLx decoders would lose information or panic are read
//! from the binary wire format here with checked arithmetic: timestamp/date
//! infinities and out-of-range instants, `24:00:00`, NUMERIC beyond Decimal's 28
//! digits, REAL widening, non-finite floats, MONEY scale, JSON numbers a JS
//! `Number` cannot hold, and empty ranges. A value that still cannot be represented
//! becomes per-cell failure metadata; it never aborts the read.

use super::*;

#[path = "read_pg_wire.rs"]
mod pg_wire;

#[cfg(test)]
pub(crate) use pg_wire::assert_decoder_contract;
use pg_wire::{pg_effective_type, pg_shape, pg_wire_value};

/// JS `Number` loses precision past 2^53; anything larger is emitted as a string.
const JS_MAX_SAFE_INT: u64 = 1 << 53;

/// Session-scoped presentation facts that SQLx does not expose on a row. They are
/// probed once per pool (all of a pool's sessions share one configuration).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SessionFacts {
    /// PostgreSQL MONEY minor-unit digits from the session's `lc_monetary`.
    pub(crate) money_digits: u32,
    /// Fixed UTC offset (seconds) of the session time zone. `None` means the zone
    /// changes offset during the year or was not probed: PostgreSQL instants then
    /// keep their exact UTC form (`+00:00`) and MySQL `TIMESTAMP` stays the
    /// session's wall-clock text without an offset.
    pub(crate) instant_offset_seconds: Option<i32>,
}

impl Default for SessionFacts {
    fn default() -> Self {
        Self {
            money_digits: 2,
            instant_offset_seconds: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DecodedCell {
    pub(crate) value: Value,
    pub(crate) failure_type: Option<String>,
}

fn decoded(value: Value) -> DecodedCell {
    DecodedCell {
        value,
        failure_type: None,
    }
}

fn decode_result<R: Row, T: Into<Value>>(
    row: &R,
    i: usize,
    ty: &str,
    result: Result<T, sqlx::Error>,
) -> DecodedCell
where
    usize: sqlx::ColumnIndex<R>,
{
    match result {
        Ok(value) => decoded(value.into()),
        Err(_) => null_or_failure(row, i, ty),
    }
}

/// A MySQL date or date-time; a zero or partial date that has no calendar value
/// is shown as the literal text MySQL itself prints.
fn mysql_date_cell(
    row: &MySqlRow,
    i: usize,
    ty: &str,
    with_time: bool,
    result: Result<String, sqlx::Error>,
) -> DecodedCell {
    match result {
        Ok(text) => decoded(Value::String(text)),
        Err(_) => match row
            .try_get_unchecked::<&[u8], _>(i)
            .ok()
            .and_then(|bytes| mysql_literal_date_text(bytes, with_time))
        {
            Some(text) => decoded(Value::String(text)),
            None => null_or_failure(row, i, ty),
        },
    }
}

/// `0000-00-00` / `2024-00-15 00:00:00` from a MySQL temporal value: the binary
/// row form is a length byte (0, 4, 7 or 11) then little-endian fields, while the
/// text protocol already carries MySQL's own text.
pub(super) fn mysql_literal_date_text(bytes: &[u8], with_time: bool) -> Option<String> {
    let binary = bytes.first().is_some_and(|&length| {
        matches!(length, 0 | 4 | 7 | 11) && usize::from(length) + 1 == bytes.len()
    });
    if !binary {
        return std::str::from_utf8(bytes).ok().map(str::to_owned);
    }
    let field = |at: usize| bytes.get(at + 1).copied().unwrap_or(0);
    let year = u16::from_le_bytes([field(0), field(1)]);
    let date = format!("{year:04}-{:02}-{:02}", field(2), field(3));
    if !with_time {
        return Some(date);
    }
    let time = format!("{:02}:{:02}:{:02}", field(4), field(5), field(6));
    let micros = u32::from_le_bytes([field(7), field(8), field(9), field(10)]);
    Some(if micros == 0 {
        format!("{date} {time}")
    } else {
        format!("{date} {time}.{micros:06}")
    })
}

/// Ints outside JS's safe range become JSON strings to avoid silent corruption.
pub(crate) fn int_json(v: i64) -> Value {
    if v.unsigned_abs() > JS_MAX_SAFE_INT {
        Value::String(v.to_string())
    } else {
        Value::from(v)
    }
}

pub(crate) fn uint_json(v: u64) -> Value {
    if v > JS_MAX_SAFE_INT {
        Value::String(v.to_string())
    } else {
        Value::from(v)
    }
}

fn int_result<R: Row>(row: &R, i: usize, ty: &str, result: Result<i64, sqlx::Error>) -> DecodedCell
where
    usize: sqlx::ColumnIndex<R>,
{
    match result {
        Ok(value) => decoded(int_json(value)),
        Err(_) => null_or_failure(row, i, ty),
    }
}

fn uint_result<R: Row>(row: &R, i: usize, ty: &str, result: Result<u64, sqlx::Error>) -> DecodedCell
where
    usize: sqlx::ColumnIndex<R>,
{
    match result {
        Ok(value) => decoded(uint_json(value)),
        Err(_) => null_or_failure(row, i, ty),
    }
}

fn hex_str(b: impl AsRef<[u8]>) -> String {
    format!("\\x{}", hex::encode(b))
}

fn iso_dt(t: chrono::NaiveDateTime) -> String {
    // ISO-8601 (T separator, trailing fractional only when nonzero).
    t.format("%Y-%m-%dT%H:%M:%S%.f").to_string()
}

/// A SQL NULL remains ordinary data. A non-NULL value that could not be decoded
/// stays `Null` in the rectangular row payload and is distinguished only by the
/// separate coordinate metadata returned with the result.
fn null_or_failure<R: Row>(row: &R, i: usize, ty: &str) -> DecodedCell
where
    usize: sqlx::ColumnIndex<R>,
{
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(false) {
        decoded(Value::Null)
    } else {
        DecodedCell {
            value: Value::Null,
            failure_type: Some(ty.to_ascii_lowercase()),
        }
    }
}

pub(crate) fn pg_value_in(row: &PgRow, i: usize, facts: &SessionFacts) -> DecodedCell {
    let info = pg_effective_type(row.column(i).type_info());
    let ty = info.name().to_ascii_uppercase();
    let raw = match row.try_get_raw(i) {
        Ok(raw) => raw,
        Err(_) => return failed(&ty),
    };
    if raw.is_null() {
        return decoded(Value::Null);
    }
    if let Some(shape) = pg_shape(&info, &ty) {
        return match pg_wire_value(&raw, shape, facts) {
            Some(value) => decoded(value),
            None => failed(&ty),
        };
    }
    match ty.as_str() {
        // inet/cidr, macaddr, bit/varbit via the sqlx feature decoders enabled in Cargo.toml.
        "INET" | "CIDR" => match row.try_get::<IpNetwork, _>(i) {
            Ok(n) => decoded(Value::from(n.to_string())),
            Err(_) => null_or_failure(row, i, &ty),
        },
        "MACADDR" => match row.try_get::<MacAddress, _>(i) {
            Ok(m) => decoded(Value::from(m.to_string())),
            Err(_) => null_or_failure(row, i, &ty),
        },
        "BIT" | "VARBIT" => match row.try_get::<BitVec, _>(i) {
            Ok(b) => decoded(Value::from(fmt_bits(&b))),
            Err(_) => null_or_failure(row, i, &ty),
        },
        // custom enums and the remaining scalar types land here.
        _ => pg_fallback(row, i, &ty),
    }
}

fn failed(ty: &str) -> DecodedCell {
    DecodedCell {
        value: Value::Null,
        failure_type: Some(ty.to_ascii_lowercase()),
    }
}

/// REAL is presented by its own shortest round-trip digits, not the widened f64's.
pub(crate) fn float4_json(value: f32) -> Value {
    if !value.is_finite() {
        return non_finite_text(f64::from(value));
    }
    value
        .to_string()
        .parse::<f64>()
        .ok()
        .and_then(serde_json::Number::from_f64)
        .map_or_else(|| non_finite_text(f64::from(value)), Value::Number)
}

pub(crate) fn float8_json(value: f64) -> Value {
    serde_json::Number::from_f64(value).map_or_else(|| non_finite_text(value), Value::Number)
}

/// JSON has no NaN/Infinity, so the database's own text keeps them visible.
fn non_finite_text(value: f64) -> Value {
    Value::String(
        if value.is_nan() {
            "NaN"
        } else if value.is_sign_negative() {
            "-Infinity"
        } else {
            "Infinity"
        }
        .into(),
    )
}

/// A JSON cell stays structured when JavaScript can hold every number in it
/// exactly; otherwise the database's exact JSON text is kept so no digit is lost
/// in the grid, the clipboard, or an export.
pub(crate) fn json_cell(text: &str) -> Value {
    if json_numbers_survive_js(text) {
        if let Ok(value) = serde_json::from_str(text) {
            return value;
        }
    }
    Value::String(text.to_owned())
}

fn json_numbers_survive_js(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => {
                index += 1;
                while index < bytes.len() {
                    match bytes[index] {
                        b'\\' => index += 2,
                        b'"' => {
                            index += 1;
                            break;
                        }
                        _ => index += 1,
                    }
                }
            }
            b'-' | b'0'..=b'9' => {
                let start = index;
                while index < bytes.len()
                    && matches!(bytes[index], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
                {
                    index += 1;
                }
                if !number_survives_js(&text[start..index]) {
                    return false;
                }
            }
            _ => index += 1,
        }
    }
    true
}

/// True when `JSON.parse` followed by JavaScript's shortest number formatting keeps
/// the token's exact decimal value (integers additionally keep their digits).
fn number_survives_js(token: &str) -> bool {
    if !token.contains(['.', 'e', 'E']) {
        return token
            .trim_start_matches('-')
            .parse::<u64>()
            .is_ok_and(|value| value <= JS_MAX_SAFE_INT);
    }
    let Ok(value) = token.parse::<f64>() else {
        return false;
    };
    value.is_finite() && normalized_decimal(token) == normalized_decimal(&format!("{value:e}"))
}

/// (negative, significant digits, exponent) with zero normalized to one form.
fn normalized_decimal(text: &str) -> Option<(bool, String, i64)> {
    let (negative, unsigned) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text.strip_prefix('+').unwrap_or(text)),
    };
    let (mantissa, exponent) = match unsigned.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, exponent.parse::<i64>().ok()?),
        None => (unsigned, 0),
    };
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let mut digits = format!("{whole}{fraction}");
    let mut exponent = exponent.checked_sub(i64::try_from(fraction.len()).ok()?)?;
    let trimmed = digits.trim_end_matches('0').len();
    exponent = exponent.checked_add(i64::try_from(digits.len() - trimmed).ok()?)?;
    digits.truncate(trimmed);
    let digits = digits.trim_start_matches('0').to_owned();
    if digits.is_empty() {
        return Some((false, String::new(), 0));
    }
    Some((negative, digits, exponent))
}

fn pg_fallback(row: &PgRow, i: usize, ty: &str) -> DecodedCell {
    if let Ok(s) = row.try_get::<String, _>(i) {
        return decoded(Value::from(s));
    }
    if let Ok(v) = row.try_get::<i64, _>(i) {
        return decoded(int_json(v));
    }
    if let Ok(v) = row.try_get::<f64, _>(i) {
        return decoded(float8_json(v));
    }
    if let Ok(v) = row.try_get::<bool, _>(i) {
        return decoded(Value::from(v));
    }
    if let Ok(d) = row.try_get::<Decimal, _>(i) {
        return decoded(Value::String(d.to_string()));
    }
    // Custom enum: on the prepared path (the only path dopedb uses) kind() is resolved
    // to Enum and never panics; the enum's wire bytes ARE its label, so a valid-UTF-8
    // decode yields it. A genuinely binary type fails from_utf8 and records a failure.
    if matches!(row.column(i).type_info().kind(), PgTypeKind::Enum(_)) {
        if let Ok(raw) = row.try_get_raw(i) {
            if let Ok(b) = raw.as_bytes() {
                if let Some(label) = bytes_as_label(b) {
                    return decoded(Value::from(label));
                }
            }
        }
    }
    null_or_failure(row, i, ty)
}

/// PG enum wire bytes are the label text (identical in Text and Binary format), so this
/// is the enum decoder; invalid UTF-8 (a real binary type) returns None and records failure.
fn bytes_as_label(bytes: &[u8]) -> Option<String> {
    std::str::from_utf8(bytes).ok().map(str::to_owned)
}

/// psql-style interval, e.g. "1 year 2 mons 5 days 02:03:04.5". ponytail: PgInterval only
/// carries months/days/µs, so per-component sign nuance (rare) collapses into the time part.
fn fmt_interval(iv: &PgInterval) -> String {
    // PostgreSQL 17+ stores ±infinity as every field at its extreme.
    if iv.months == i32::MAX && iv.days == i32::MAX && iv.microseconds == i64::MAX {
        return "infinity".into();
    }
    if iv.months == i32::MIN && iv.days == i32::MIN && iv.microseconds == i64::MIN {
        return "-infinity".into();
    }
    let mut out: Vec<String> = Vec::new();
    let (years, mons) = (iv.months / 12, iv.months % 12);
    if years != 0 {
        out.push(format!(
            "{years} year{}",
            if years.unsigned_abs() == 1 { "" } else { "s" }
        ));
    }
    if mons != 0 {
        out.push(format!(
            "{mons} mon{}",
            if mons.unsigned_abs() == 1 { "" } else { "s" }
        ));
    }
    if iv.days != 0 {
        out.push(format!(
            "{} day{}",
            iv.days,
            if iv.days.unsigned_abs() == 1 { "" } else { "s" }
        ));
    }
    if iv.microseconds != 0 || out.is_empty() {
        let sign = if iv.microseconds < 0 { "-" } else { "" };
        let total = iv.microseconds.unsigned_abs();
        let (secs, us) = (total / 1_000_000, total % 1_000_000);
        let (h, m, s) = (secs / 3600, (secs % 3600) / 60, secs % 60);
        if us == 0 {
            out.push(format!("{sign}{h:02}:{m:02}:{s:02}"));
        } else {
            let frac = format!("{us:06}");
            out.push(format!(
                "{sign}{h:02}:{m:02}:{s:02}.{}",
                frac.trim_end_matches('0')
            ));
        }
    }
    out.join(" ")
}

/// BIT/VARBIT as a string of 0/1, e.g. "1011".
fn fmt_bits(b: &BitVec) -> String {
    b.iter().map(|bit| if bit { '1' } else { '0' }).collect()
}

/// MySQL `TIME` is a signed duration with a much wider range than a time of day.
/// Keep MySQL's familiar zero-padded rendering while preserving the full
/// +/-838-hour range and fractional seconds.
fn fmt_mysql_time(t: &MySqlTime) -> String {
    let sign = if matches!(t.sign(), MySqlTimeSign::Negative) {
        "-"
    } else {
        ""
    };
    let mut out = format!(
        "{sign}{:02}:{:02}:{:02}",
        t.hours(),
        t.minutes(),
        t.seconds()
    );
    if t.microseconds() != 0 {
        let fraction = format!("{:06}", t.microseconds());
        out.push('.');
        out.push_str(fraction.trim_end_matches('0'));
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MySqlDecodeRoute {
    UnsignedInteger,
    Binary,
    SignedInteger,
    Float32,
    Float64,
    Decimal,
    Text,
    Set,
    DateTime,
    Timestamp,
    Date,
    Time,
    Json,
    Fallback,
}

fn mysql_decode_route(ty: &str) -> MySqlDecodeRoute {
    if ty.contains("UNSIGNED") || ty == "YEAR" {
        return MySqlDecodeRoute::UnsignedInteger;
    }
    if ty.contains("BLOB") || ty.contains("BINARY") {
        return MySqlDecodeRoute::Binary;
    }
    match ty {
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "BIGINT" => MySqlDecodeRoute::SignedInteger,
        "FLOAT" => MySqlDecodeRoute::Float32,
        "DOUBLE" => MySqlDecodeRoute::Float64,
        "DECIMAL" | "NEWDECIMAL" => MySqlDecodeRoute::Decimal,
        "VARCHAR" | "CHAR" | "TEXT" | "TINYTEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" => {
            MySqlDecodeRoute::Text
        }
        "SET" => MySqlDecodeRoute::Set,
        "DATETIME" => MySqlDecodeRoute::DateTime,
        "TIMESTAMP" => MySqlDecodeRoute::Timestamp,
        "DATE" => MySqlDecodeRoute::Date,
        "TIME" => MySqlDecodeRoute::Time,
        "JSON" => MySqlDecodeRoute::Json,
        _ => MySqlDecodeRoute::Fallback,
    }
}

/// MySQL sends DECIMAL as its exact text in both protocols; keep every digit
/// rather than rounding through Decimal's 28-digit mantissa.
fn mysql_decimal_text(text: &str) -> bool {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    !whole.is_empty()
        && whole.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.bytes().all(|byte| byte.is_ascii_digit())
}

pub(crate) fn mysql_value_in(row: &MySqlRow, i: usize, facts: &SessionFacts) -> DecodedCell {
    let ty = row.column(i).type_info().name().to_ascii_uppercase();
    match mysql_decode_route(&ty) {
        // SQLx models YEAR as an unsigned integer even though its type name does
        // not carry the `UNSIGNED` suffix used by ordinary integer columns.
        MySqlDecodeRoute::UnsignedInteger => uint_result(row, i, &ty, row.try_get::<u64, _>(i)),
        MySqlDecodeRoute::Binary => {
            decode_result(row, i, &ty, row.try_get::<Vec<u8>, _>(i).map(hex_str))
        }
        MySqlDecodeRoute::SignedInteger => int_result(row, i, &ty, row.try_get::<i64, _>(i)),
        MySqlDecodeRoute::Float32 => match row.try_get::<f32, _>(i) {
            Ok(value) => decoded(float4_json(value)),
            Err(_) => null_or_failure(row, i, &ty),
        },
        MySqlDecodeRoute::Float64 => match row.try_get::<f64, _>(i) {
            Ok(value) => decoded(float8_json(value)),
            Err(_) => null_or_failure(row, i, &ty),
        },
        MySqlDecodeRoute::Decimal => match row.try_get_unchecked::<String, _>(i) {
            Ok(text) if mysql_decimal_text(&text) => decoded(Value::String(text)),
            _ => match row.try_get::<Decimal, _>(i) {
                Ok(d) => decoded(Value::String(d.to_string())),
                Err(_) => null_or_failure(row, i, &ty),
            },
        },
        MySqlDecodeRoute::Text => decode_result(row, i, &ty, row.try_get::<String, _>(i)),
        // SET is textual on the wire, but SQLx 0.8 omits ColumnType::Set from
        // String::compatible. The unchecked get skips only that type guard while
        // retaining SQLx's normal UTF-8 decoder.
        MySqlDecodeRoute::Set => match row.try_get_unchecked::<String, _>(i) {
            Ok(value) => decoded(Value::from(value)),
            Err(_) => null_or_failure(row, i, &ty),
        },
        MySqlDecodeRoute::DateTime => mysql_date_cell(
            row,
            i,
            &ty,
            true,
            row.try_get::<chrono::NaiveDateTime, _>(i).map(iso_dt),
        ),
        // TIMESTAMP is an instant MySQL renders in the session time zone; name
        // that zone's fixed offset so the wall-clock text cannot read as UTC.
        MySqlDecodeRoute::Timestamp => mysql_date_cell(
            row,
            i,
            &ty,
            true,
            row.try_get::<chrono::NaiveDateTime, _>(i).map(|wall| {
                match facts.instant_offset_seconds.and_then(FixedOffset::east_opt) {
                    Some(offset) => format!("{}{offset}", iso_dt(wall)),
                    None => iso_dt(wall),
                }
            }),
        ),
        MySqlDecodeRoute::Date => mysql_date_cell(
            row,
            i,
            &ty,
            false,
            row.try_get::<chrono::NaiveDate, _>(i)
                .map(|t| t.to_string()),
        ),
        MySqlDecodeRoute::Time => match row.try_get::<MySqlTime, _>(i) {
            Ok(t) => decoded(Value::from(fmt_mysql_time(&t))),
            Err(_) => mysql_fallback(row, i, &ty),
        },
        // JSON arrives as text; keep numbers JavaScript cannot hold exactly.
        MySqlDecodeRoute::Json => match row.try_get_unchecked::<String, _>(i) {
            Ok(text) => decoded(json_cell(&text)),
            Err(_) => decode_result(row, i, &ty, row.try_get::<Value, _>(i)),
        },
        // BIT and anything unlisted fall through.
        MySqlDecodeRoute::Fallback => mysql_fallback(row, i, &ty),
    }
}

fn mysql_fallback(row: &MySqlRow, i: usize, ty: &str) -> DecodedCell {
    if let Ok(s) = row.try_get::<String, _>(i) {
        return decoded(Value::from(s));
    }
    if let Ok(v) = row.try_get::<i64, _>(i) {
        return decoded(int_json(v));
    }
    if let Ok(v) = row.try_get::<u64, _>(i) {
        return decoded(uint_json(v));
    }
    if let Ok(v) = row.try_get::<f64, _>(i) {
        return decoded(float8_json(v));
    }
    if let Ok(d) = row.try_get::<Decimal, _>(i) {
        return decoded(Value::String(d.to_string()));
    }
    if let Ok(b) = row.try_get::<Vec<u8>, _>(i) {
        return decoded(Value::from(hex_str(b))); // BIT etc.
    }
    null_or_failure(row, i, ty)
}

pub(crate) fn sqlite_value(row: &SqliteRow, i: usize) -> DecodedCell {
    // A real NULL has to be recognised before any storage-class probe: SQLite's
    // integer and real decoders read NULL as 0 rather than failing, so probing
    // first would make the grid, the clipboard and an export all agree on a 0 the
    // column never held.
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(false) {
        return decoded(Value::Null);
    }
    // SQLite is dynamically typed (declared type != stored class), so probe storage
    // classes in order. The five classes are covered, so a non-NULL value matching
    // none of them is genuinely undecodable rather than empty.
    if let Ok(v) = row.try_get::<i64, _>(i) {
        return decoded(int_json(v));
    }
    if let Ok(v) = row.try_get::<f64, _>(i) {
        // SQLite stores ±Infinity (e.g. 9e999); JSON numbers cannot, so keep text.
        return decoded(float8_json(v));
    }
    if let Ok(s) = row.try_get::<String, _>(i) {
        return decoded(Value::from(s));
    }
    if let Ok(b) = row.try_get::<Vec<u8>, _>(i) {
        return decoded(Value::from(hex_str(b)));
    }
    null_or_failure(row, i, row.column(i).type_info().name())
}
