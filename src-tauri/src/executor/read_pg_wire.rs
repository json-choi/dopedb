//! PostgreSQL binary wire decoding with checked arithmetic, for the scalars whose
//! SQLx decoders would lose information or panic: timestamp/date infinities and
//! out-of-range instants, interval and `24:00:00` edge values, NUMERIC beyond
//! Decimal's 28 digits, REAL widening, non-finite floats, MONEY scale, JSON numbers
//! a JS `Number` cannot hold, empty ranges, arrays of any dimension, and catalog
//! types SQLx has no decoder for (`"char"`, `reg*` aliases as their OID, `pg_lsn`,
//! `xml`, `void`). A value that cannot be represented returns `None` and becomes
//! per-cell failure metadata in the caller. (SQLx 0.9 cannot resolve multirange
//! types at all, so such a column fails the query before any cell is decoded; that
//! failure surfaces as `AppError::UnsupportedColumnType`, which suggests `::text`.)

use std::fmt::Write as _;

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeDelta, Utc};
use serde_json::Value;
use sqlx::postgres::types::PgInterval;
use sqlx::postgres::{PgTypeInfo, PgTypeKind, PgValueFormat, PgValueRef};
use sqlx::TypeInfo;
use uuid::Uuid;

use super::{
    float4_json, float8_json, fmt_interval, hex_str, int_json, iso_dt, json_cell, SessionFacts,
};

/// PostgreSQL values read with this module's checked wire decoders rather than SQLx's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PgWire {
    Bool,
    Int2,
    Int4,
    Int8,
    Oid,
    Float4,
    Float8,
    Numeric,
    Money,
    Text,
    Uuid,
    Json,
    Jsonb,
    Timestamp,
    Timestamptz,
    Date,
    Time,
    Timetz,
    Interval,
    Bytea,
    /// The single-byte internal `"char"` (e.g. `pg_class.relkind`).
    Char,
    Lsn,
    Void,
}

fn pg_wire_kind(name: &str) -> Option<PgWire> {
    Some(match name {
        "BOOL" => PgWire::Bool,
        "INT2" => PgWire::Int2,
        "INT4" => PgWire::Int4,
        "INT8" => PgWire::Int8,
        // The binary protocol carries an object-identifier alias as its number;
        // `::text` asks the server for the name instead.
        "OID" | "REGCLASS" | "REGTYPE" | "REGPROC" | "REGPROCEDURE" | "REGOPER" | "REGOPERATOR"
        | "REGNAMESPACE" | "REGROLE" | "REGCONFIG" | "REGDICTIONARY" | "REGCOLLATION" => {
            PgWire::Oid
        }
        "\"CHAR\"" => PgWire::Char,
        "XML" => PgWire::Text,
        "PG_LSN" => PgWire::Lsn,
        "VOID" => PgWire::Void,
        "FLOAT4" => PgWire::Float4,
        "FLOAT8" => PgWire::Float8,
        "NUMERIC" => PgWire::Numeric,
        "MONEY" => PgWire::Money,
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "CITEXT" => PgWire::Text,
        "UUID" => PgWire::Uuid,
        "JSON" => PgWire::Json,
        "JSONB" => PgWire::Jsonb,
        "TIMESTAMP" => PgWire::Timestamp,
        "TIMESTAMPTZ" => PgWire::Timestamptz,
        "DATE" => PgWire::Date,
        "TIME" => PgWire::Time,
        "TIMETZ" => PgWire::Timetz,
        "INTERVAL" => PgWire::Interval,
        "BYTEA" => PgWire::Bytea,
        _ => return None,
    })
}

fn pg_range_element(name: &str) -> Option<PgWire> {
    Some(match name {
        "INT4RANGE" => PgWire::Int4,
        "INT8RANGE" => PgWire::Int8,
        "NUMRANGE" => PgWire::Numeric,
        "DATERANGE" => PgWire::Date,
        "TSRANGE" => PgWire::Timestamp,
        "TSTZRANGE" => PgWire::Timestamptz,
        _ => return None,
    })
}

#[derive(Debug, Clone, Copy)]
pub(super) enum PgShape {
    Scalar(PgWire),
    Range(PgWire),
    Array(PgWire),
}

/// Domains present as their base type; enum arrays carry their labels as text.
pub(super) fn pg_effective_type(info: &PgTypeInfo) -> PgTypeInfo {
    match info.kind() {
        PgTypeKind::Domain(base) => base.clone(),
        _ => info.clone(),
    }
}

pub(super) fn pg_shape(info: &PgTypeInfo, name: &str) -> Option<PgShape> {
    if let Some(kind) = pg_wire_kind(name) {
        return Some(PgShape::Scalar(kind));
    }
    if let Some(element) = pg_range_element(name) {
        return Some(PgShape::Range(element));
    }
    let PgTypeKind::Array(element) = info.kind() else {
        return None;
    };
    let element = pg_effective_type(element);
    if matches!(element.kind(), PgTypeKind::Enum(_)) {
        return Some(PgShape::Array(PgWire::Text));
    }
    pg_wire_kind(&element.name().to_ascii_uppercase()).map(PgShape::Array)
}

pub(super) fn pg_wire_value(
    raw: &PgValueRef<'_>,
    shape: PgShape,
    facts: &SessionFacts,
) -> Option<Value> {
    match raw.format() {
        PgValueFormat::Binary => {
            let bytes = raw.as_bytes().ok()?;
            match shape {
                PgShape::Scalar(kind) => pg_binary_value(kind, bytes, facts),
                PgShape::Range(element) => pg_range_text(bytes, element, facts).map(Value::String),
                PgShape::Array(element) => pg_array_value(bytes, element, facts),
            }
        }
        // The simple-query protocol already carries PostgreSQL's own text form.
        PgValueFormat::Text => {
            let text = raw.as_str().ok()?;
            Some(match shape {
                PgShape::Scalar(PgWire::Bool) => Value::Bool(text == "t"),
                PgShape::Scalar(PgWire::Int2 | PgWire::Int4 | PgWire::Int8) => {
                    int_json(text.parse().ok()?)
                }
                PgShape::Scalar(PgWire::Float8) => float8_json(text.parse().ok()?),
                PgShape::Scalar(PgWire::Float4) => float4_json(text.parse().ok()?),
                PgShape::Scalar(PgWire::Json | PgWire::Jsonb) => json_cell(text),
                _ => Value::String(text.to_owned()),
            })
        }
    }
}

fn exact<const N: usize>(bytes: &[u8]) -> Option<[u8; N]> {
    bytes.try_into().ok()
}

fn pg_binary_value(kind: PgWire, bytes: &[u8], facts: &SessionFacts) -> Option<Value> {
    Some(match kind {
        PgWire::Bool => Value::Bool(exact::<1>(bytes)?[0] != 0),
        PgWire::Int2 => Value::from(i16::from_be_bytes(exact(bytes)?)),
        PgWire::Int4 => Value::from(i32::from_be_bytes(exact(bytes)?)),
        PgWire::Int8 => int_json(i64::from_be_bytes(exact(bytes)?)),
        PgWire::Oid => Value::from(u32::from_be_bytes(exact(bytes)?)),
        PgWire::Float4 => float4_json(f32::from_be_bytes(exact(bytes)?)),
        PgWire::Float8 => float8_json(f64::from_be_bytes(exact(bytes)?)),
        PgWire::Numeric => Value::String(pg_numeric_text(bytes)?),
        PgWire::Money => Value::String(money_text(
            i64::from_be_bytes(exact(bytes)?),
            facts.money_digits,
        )),
        PgWire::Text => Value::String(std::str::from_utf8(bytes).ok()?.to_owned()),
        PgWire::Uuid => Value::String(Uuid::from_slice(bytes).ok()?.to_string()),
        PgWire::Json => json_cell(std::str::from_utf8(bytes).ok()?),
        // JSONB's binary form is a version byte followed by the JSON text.
        PgWire::Jsonb => match bytes.split_first() {
            Some((1, text)) => json_cell(std::str::from_utf8(text).ok()?),
            _ => return None,
        },
        PgWire::Timestamp => Value::String(pg_timestamp_text(i64::from_be_bytes(exact(bytes)?))?),
        PgWire::Timestamptz => Value::String(pg_timestamptz_text(
            i64::from_be_bytes(exact(bytes)?),
            facts.instant_offset_seconds,
        )?),
        PgWire::Date => Value::String(pg_date_text(i32::from_be_bytes(exact(bytes)?))?),
        PgWire::Time => Value::String(pg_time_text(i64::from_be_bytes(exact(bytes)?))?),
        PgWire::Timetz => {
            let (time, zone) = bytes.split_at_checked(8)?;
            let time = pg_time_text(i64::from_be_bytes(exact(time)?))?;
            // The wire stores seconds *west* of UTC.
            let offset = FixedOffset::west_opt(i32::from_be_bytes(exact(zone)?))?;
            Value::String(format!("{time}{offset}"))
        }
        PgWire::Interval => {
            let (microseconds, rest) = bytes.split_at_checked(8)?;
            let (days, months) = rest.split_at_checked(4)?;
            Value::String(fmt_interval(&PgInterval {
                months: i32::from_be_bytes(exact(months)?),
                days: i32::from_be_bytes(exact(days)?),
                microseconds: i64::from_be_bytes(exact(microseconds)?),
            }))
        }
        PgWire::Bytea => Value::String(hex_str(bytes)),
        PgWire::Char => Value::String(pg_char_text(exact::<1>(bytes)?[0])),
        // pg_lsn prints as two hexadecimal halves, e.g. "16/B374D848".
        PgWire::Lsn => {
            let lsn = u64::from_be_bytes(exact(bytes)?);
            Value::String(format!("{:X}/{:X}", lsn >> 32, lsn & 0xFFFF_FFFF))
        }
        PgWire::Void if bytes.is_empty() => Value::String(String::new()),
        PgWire::Void => return None,
    })
}

/// The internal `"char"` as PostgreSQL prints it: nothing for NUL, an octal
/// escape for a byte with the high bit set, otherwise the character itself.
fn pg_char_text(byte: u8) -> String {
    match byte {
        0 => String::new(),
        0x80.. => format!("\\{byte:03o}"),
        _ => char::from(byte).to_string(),
    }
}

fn pg_epoch() -> Option<NaiveDateTime> {
    NaiveDate::from_ymd_opt(2000, 1, 1)?.and_hms_opt(0, 0, 0)
}

/// TIMESTAMP is microseconds since 2000-01-01; `i64::MAX`/`MIN` are ±infinity.
pub(crate) fn pg_timestamp_text(micros: i64) -> Option<String> {
    match micros {
        i64::MAX => Some("infinity".into()),
        i64::MIN => Some("-infinity".into()),
        _ => pg_epoch()?
            .checked_add_signed(TimeDelta::microseconds(micros))
            .map(iso_dt),
    }
}

/// TIMESTAMPTZ is a UTC instant; it is presented in the session's fixed offset
/// when it has one and otherwise keeps its exact UTC form, always with an offset.
pub(crate) fn pg_timestamptz_text(micros: i64, offset_seconds: Option<i32>) -> Option<String> {
    match micros {
        i64::MAX => Some("infinity".into()),
        i64::MIN => Some("-infinity".into()),
        _ => {
            let naive = pg_epoch()?.checked_add_signed(TimeDelta::microseconds(micros))?;
            let instant = DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc);
            let offset = FixedOffset::east_opt(offset_seconds.unwrap_or(0))?;
            Some(instant.with_timezone(&offset).to_rfc3339())
        }
    }
}

/// DATE is days since 2000-01-01; `i32::MAX`/`MIN` are ±infinity.
pub(crate) fn pg_date_text(days: i32) -> Option<String> {
    match days {
        i32::MAX => Some("infinity".into()),
        i32::MIN => Some("-infinity".into()),
        _ => NaiveDate::from_ymd_opt(2000, 1, 1)?
            .checked_add_signed(TimeDelta::try_days(i64::from(days))?)
            .map(|date| date.to_string()),
    }
}

const MICROS_PER_DAY: i64 = 86_400_000_000;

/// TIME is microseconds since midnight and includes PostgreSQL's `24:00:00`.
pub(crate) fn pg_time_text(micros: i64) -> Option<String> {
    if micros == MICROS_PER_DAY {
        return Some("24:00:00".into());
    }
    if !(0..MICROS_PER_DAY).contains(&micros) {
        return None;
    }
    let seconds = u32::try_from(micros / 1_000_000).ok()?;
    let nanos = u32::try_from((micros % 1_000_000) * 1_000).ok()?;
    NaiveTime::from_num_seconds_from_midnight_opt(seconds, nanos).map(|time| time.to_string())
}

const NUMERIC_POSITIVE: u16 = 0x0000;
const NUMERIC_NEGATIVE: u16 = 0x4000;
const NUMERIC_NAN: u16 = 0xC000;
const NUMERIC_POSITIVE_INFINITY: u16 = 0xD000;
const NUMERIC_NEGATIVE_INFINITY: u16 = 0xF000;

/// Exact NUMERIC text from the base-10000 wire digits, matching PostgreSQL's
/// `numeric_out` (display scale digits after the point), with no 28-digit limit.
pub(crate) fn pg_numeric_text(bytes: &[u8]) -> Option<String> {
    let (header, rest) = bytes.split_at_checked(8)?;
    let digit_count = usize::from(u16::from_be_bytes(exact(&header[0..2])?));
    let weight = i32::from(i16::from_be_bytes(exact(&header[2..4])?));
    let sign = u16::from_be_bytes(exact(&header[4..6])?);
    let scale = usize::try_from(i16::from_be_bytes(exact(&header[6..8])?)).ok()?;
    match sign {
        NUMERIC_NAN => return Some("NaN".into()),
        NUMERIC_POSITIVE_INFINITY => return Some("Infinity".into()),
        NUMERIC_NEGATIVE_INFINITY => return Some("-Infinity".into()),
        NUMERIC_POSITIVE | NUMERIC_NEGATIVE => {}
        _ => return None,
    }
    if rest.len() != digit_count.checked_mul(2)? {
        return None;
    }
    let digits = rest
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| {
            let digit = i16::from_be_bytes(*pair);
            (0..10_000).contains(&digit).then_some(digit)
        })
        .collect::<Option<Vec<_>>>()?;
    let digit_at = |index: i32| -> i16 {
        usize::try_from(index)
            .ok()
            .and_then(|index| digits.get(index).copied())
            .unwrap_or(0)
    };
    let mut out = String::with_capacity(digit_count * 4 + scale + 2);
    if sign == NUMERIC_NEGATIVE {
        out.push('-');
    }
    if weight < 0 {
        out.push('0');
    } else {
        for group in 0..=weight {
            let digit = digit_at(group);
            if group == 0 {
                let _ = write!(out, "{digit}");
            } else {
                let _ = write!(out, "{digit:04}");
            }
        }
    }
    if scale > 0 {
        out.push('.');
        let start = out.len();
        let mut group = weight.checked_add(1)?;
        while out.len() - start < scale {
            let _ = write!(out, "{:04}", digit_at(group));
            group = group.checked_add(1)?;
        }
        out.truncate(start + scale);
    }
    Some(out)
}

/// MONEY is an i64 of minor units; the session's `lc_monetary` owns the scale.
pub(crate) fn money_text(minor_units: i64, digits: u32) -> String {
    let digits = digits.min(10);
    let divisor = 10_i128.pow(digits);
    let value = i128::from(minor_units);
    let sign = if value < 0 { "-" } else { "" };
    let magnitude = value.unsigned_abs();
    let whole = magnitude / divisor.unsigned_abs();
    if digits == 0 {
        return format!("{sign}{whole}");
    }
    let fraction = magnitude % divisor.unsigned_abs();
    format!(
        "{sign}{whole}.{fraction:0width$}",
        width = usize::try_from(digits).unwrap_or(2)
    )
}

const RANGE_EMPTY: u8 = 0x01;
const RANGE_LOWER_INCLUSIVE: u8 = 0x02;
const RANGE_UPPER_INCLUSIVE: u8 = 0x04;
const RANGE_LOWER_INFINITE: u8 = 0x08;
const RANGE_UPPER_INFINITE: u8 = 0x10;

/// Bounded cursor over length-prefixed binary wire elements.
struct WireCursor<'a> {
    bytes: &'a [u8],
}

impl<'a> WireCursor<'a> {
    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let (head, tail) = self.bytes.split_at_checked(length)?;
        self.bytes = tail;
        Some(head)
    }

    fn i32(&mut self) -> Option<i32> {
        Some(i32::from_be_bytes(exact(self.take(4)?)?))
    }

    /// A `-1` length marks SQL NULL inside arrays.
    fn element(&mut self) -> Option<Option<&'a [u8]>> {
        let length = self.i32()?;
        if length == -1 {
            return Some(None);
        }
        Some(Some(self.take(usize::try_from(length).ok()?)?))
    }
}

fn wire_text(value: Value) -> String {
    match value {
        Value::String(text) => text,
        other => other.to_string(),
    }
}

/// Range text in PostgreSQL's canonical form; `empty` stays distinct from `(,)`.
fn pg_range_text(bytes: &[u8], element: PgWire, facts: &SessionFacts) -> Option<String> {
    let (&flags, rest) = bytes.split_first()?;
    if flags & RANGE_EMPTY != 0 {
        return Some("empty".into());
    }
    let mut cursor = WireCursor { bytes: rest };
    let mut bound = |infinite: bool| -> Option<String> {
        if infinite {
            return Some(String::new());
        }
        let value = cursor.element()??;
        pg_binary_value(element, value, facts).map(wire_text)
    };
    let lower = bound(flags & RANGE_LOWER_INFINITE != 0)?;
    let upper = bound(flags & RANGE_UPPER_INFINITE != 0)?;
    let open = if flags & RANGE_LOWER_INCLUSIVE != 0 {
        '['
    } else {
        '('
    };
    let close = if flags & RANGE_UPPER_INCLUSIVE != 0 {
        ']'
    } else {
        ')'
    };
    Some(format!("{open}{lower},{upper}{close}"))
}

/// Binary array (any dimension) into nested JSON arrays; NULL elements stay null.
fn pg_array_value(bytes: &[u8], element: PgWire, facts: &SessionFacts) -> Option<Value> {
    let mut cursor = WireCursor { bytes };
    let dimensions = usize::try_from(cursor.i32()?).ok()?;
    let _has_nulls = cursor.i32()?;
    let _element_oid = cursor.i32()?;
    if dimensions == 0 {
        return Some(Value::Array(Vec::new()));
    }
    if dimensions > 6 {
        return None;
    }
    let mut lengths = Vec::with_capacity(dimensions);
    let mut total = 1_usize;
    for _ in 0..dimensions {
        let length = usize::try_from(cursor.i32()?).ok()?;
        let _lower_bound = cursor.i32()?;
        total = total.checked_mul(length)?;
        lengths.push(length);
    }
    // Every element needs at least its 4-byte length, so the input bounds this.
    if total > bytes.len() / 4 {
        return None;
    }
    let mut values = Vec::with_capacity(total);
    for _ in 0..total {
        values.push(match cursor.element()? {
            None => Value::Null,
            Some(value) => pg_binary_value(element, value, facts)?,
        });
    }
    if !cursor.bytes.is_empty() {
        return None;
    }
    Some(nest_array(&mut values.into_iter(), &lengths))
}

fn nest_array(values: &mut impl Iterator<Item = Value>, lengths: &[usize]) -> Value {
    match lengths {
        [] => Value::Array(Vec::new()),
        [length] => Value::Array(values.take(*length).collect()),
        [length, inner @ ..] => {
            Value::Array((0..*length).map(|_| nest_array(values, inner)).collect())
        }
    }
}

/// Decoder invariants: no PostgreSQL wire value may panic or silently change,
/// and an oversized row keeps the result alive with reported previews.
#[cfg(test)]
pub(crate) fn assert_decoder_contract() {
    fn numeric_wire(digits: &[i16], weight: i16, sign: u16, scale: i16) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&u16::try_from(digits.len()).unwrap().to_be_bytes());
        bytes.extend_from_slice(&weight.to_be_bytes());
        bytes.extend_from_slice(&sign.to_be_bytes());
        bytes.extend_from_slice(&scale.to_be_bytes());
        for digit in digits {
            bytes.extend_from_slice(&digit.to_be_bytes());
        }
        bytes
    }

    // ±infinity and values beyond chrono's range never reach chrono's panicking `+`.
    assert_eq!(pg_timestamp_text(i64::MAX).as_deref(), Some("infinity"));
    assert_eq!(pg_timestamp_text(i64::MIN).as_deref(), Some("-infinity"));
    assert_eq!(
        pg_timestamptz_text(i64::MAX, Some(32_400)).as_deref(),
        Some("infinity")
    );
    assert_eq!(
        pg_timestamptz_text(i64::MIN, None).as_deref(),
        Some("-infinity")
    );
    assert_eq!(pg_date_text(i32::MAX).as_deref(), Some("infinity"));
    assert_eq!(pg_date_text(i32::MIN).as_deref(), Some("-infinity"));
    assert_eq!(pg_timestamp_text(i64::MAX - 1), None);
    assert_eq!(pg_date_text(i32::MAX - 1), None);
    assert_eq!(
        pg_timestamp_text(86_400_000_000 + 500_000).as_deref(),
        Some("2000-01-02T00:00:00.500")
    );
    // An instant keeps an explicit offset: the session's fixed one, else UTC.
    assert_eq!(
        pg_timestamptz_text(0, Some(32_400)).as_deref(),
        Some("2000-01-01T09:00:00+09:00")
    );
    assert_eq!(
        pg_timestamptz_text(0, None).as_deref(),
        Some("2000-01-01T00:00:00+00:00")
    );
    assert_eq!(pg_time_text(86_400_000_000).as_deref(), Some("24:00:00"));
    assert_eq!(pg_time_text(86_400_000_001), None);
    // PostgreSQL 17+ interval ±infinity: every field at its extreme.
    let interval = |months, days, microseconds| {
        fmt_interval(&PgInterval {
            months,
            days,
            microseconds,
        })
    };
    assert_eq!(interval(i32::MAX, i32::MAX, i64::MAX), "infinity");
    assert_eq!(interval(i32::MIN, i32::MIN, i64::MIN), "-infinity");
    assert_eq!(
        interval(-14, i32::MIN, 0),
        "-1 year -2 mons -2147483648 days"
    );
    assert_eq!(
        interval(13, 1, -3_723_500_000),
        "1 year 1 mon 1 day -01:02:03.5"
    );

    // Catalog and system types decode instead of becoming failure cells.
    let facts = SessionFacts::default();
    let scalar = |kind, bytes: &[u8]| pg_binary_value(kind, bytes, &facts);
    assert_eq!(pg_wire_kind("\"CHAR\""), Some(PgWire::Char));
    assert_eq!(scalar(PgWire::Char, b"r"), Some(Value::from("r")));
    assert_eq!(scalar(PgWire::Char, &[0]), Some(Value::from("")));
    assert_eq!(scalar(PgWire::Char, &[0xE9]), Some(Value::from("\\351")));
    assert_eq!(pg_wire_kind("REGCLASS"), Some(PgWire::Oid));
    assert_eq!(
        scalar(PgWire::Oid, &1259_u32.to_be_bytes()),
        Some(Value::from(1259))
    );
    assert_eq!(pg_wire_kind("XML"), Some(PgWire::Text));
    assert_eq!(
        scalar(PgWire::Lsn, &0x16_B374_D848_u64.to_be_bytes()),
        Some(Value::from("16/B374D848"))
    );
    assert_eq!(scalar(PgWire::Void, &[]), Some(Value::from("")));

    // MySQL zero and partial dates keep MySQL's own text.
    assert_eq!(
        super::mysql_literal_date_text(&[0], false).as_deref(),
        Some("0000-00-00")
    );
    assert_eq!(
        super::mysql_literal_date_text(&[0], true).as_deref(),
        Some("0000-00-00 00:00:00")
    );
    assert_eq!(
        super::mysql_literal_date_text(&[4, 0xE8, 0x07, 0, 15], false).as_deref(),
        Some("2024-00-15")
    );
    assert_eq!(
        super::mysql_literal_date_text(&[11, 0xE8, 0x07, 2, 0, 1, 2, 3, 0x20, 0xA1, 0x07, 0], true)
            .as_deref(),
        Some("2024-02-00 01:02:03.500000")
    );
    assert_eq!(
        super::mysql_literal_date_text(b"0000-00-00 00:00:00", true).as_deref(),
        Some("0000-00-00 00:00:00")
    );

    // NUMERIC keeps every digit past Decimal's 28 and its display scale.
    assert_eq!(
        pg_numeric_text(&numeric_wire(
            &[1, 2345, 6789, 123, 4567, 8901, 2345, 6789, 123],
            0,
            NUMERIC_POSITIVE,
            32,
        ))
        .as_deref(),
        Some("1.23456789012345678901234567890123")
    );
    assert_eq!(
        pg_numeric_text(&numeric_wire(&[1200], -2, NUMERIC_NEGATIVE, 6)).as_deref(),
        Some("-0.000012")
    );
    assert_eq!(
        pg_numeric_text(&numeric_wire(&[12, 3400], 1, NUMERIC_POSITIVE, 2)).as_deref(),
        Some("123400.00")
    );
    assert_eq!(
        pg_numeric_text(&numeric_wire(&[], 0, NUMERIC_NAN, 0)).as_deref(),
        Some("NaN")
    );
    assert_eq!(
        pg_numeric_text(&numeric_wire(&[], 0, NUMERIC_NEGATIVE_INFINITY, 0)).as_deref(),
        Some("-Infinity")
    );
    assert_eq!(
        pg_numeric_text(&numeric_wire(&[10_000], 0, NUMERIC_POSITIVE, 0)),
        None
    );

    // REAL keeps its own digits; non-finite floats stay visible as text.
    assert_eq!(
        float4_json(0.333_333_34_f32),
        serde_json::json!(0.333_333_34)
    );
    assert_eq!(float4_json(f32::NAN), Value::from("NaN"));
    assert_eq!(float8_json(f64::NEG_INFINITY), Value::from("-Infinity"));

    // MONEY follows the session's lc_monetary scale (KRW has none).
    assert_eq!(money_text(1_000, 0), "1000");
    assert_eq!(money_text(-12_345, 2), "-123.45");
    assert_eq!(money_text(i64::MIN, 2), "-92233720368547758.08");

    // JSON numbers a JS Number would round stay exact as the database's text.
    let big = r#"{"id": 12345678901234567890, "name": "a"}"#;
    assert_eq!(json_cell(big), Value::from(big));
    assert_eq!(
        json_cell(r#"{"pi": 3.14159265358979323846}"#),
        Value::from(r#"{"pi": 3.14159265358979323846}"#)
    );
    assert_eq!(
        json_cell(r#"{"a": [1.5, -0.25, 9007199254740992], "s": "12345678901234567890"}"#),
        serde_json::json!({"a": [1.5, -0.25, 9_007_199_254_740_992_u64], "s": "12345678901234567890"})
    );

    // An empty range is not the unbounded range.
    assert_eq!(
        pg_range_text(&[RANGE_EMPTY], PgWire::Int4, &SessionFacts::default()).as_deref(),
        Some("empty")
    );
    assert_eq!(
        pg_range_text(
            &[RANGE_LOWER_INFINITE | RANGE_UPPER_INFINITE],
            PgWire::Date,
            &SessionFacts::default()
        )
        .as_deref(),
        Some("(,)")
    );
    let mut infinite_date_range = vec![RANGE_LOWER_INCLUSIVE];
    infinite_date_range.extend_from_slice(&4_i32.to_be_bytes());
    infinite_date_range.extend_from_slice(&0_i32.to_be_bytes());
    infinite_date_range.extend_from_slice(&4_i32.to_be_bytes());
    infinite_date_range.extend_from_slice(&i32::MAX.to_be_bytes());
    assert_eq!(
        pg_range_text(&infinite_date_range, PgWire::Date, &SessionFacts::default()).as_deref(),
        Some("[2000-01-01,infinity)")
    );

    // One oversized cell becomes a reported preview instead of failing the read.
    let mut row = vec![Value::from("x".repeat(600 * 1024)), Value::from(1)];
    let mut failures = Vec::new();
    let size = super::super::fit_row_to_page(&mut row, &mut failures, 7, 500 * 1024).unwrap();
    assert!(size <= 500 * 1024);
    assert_eq!(row[1], Value::from(1));
    assert!(row[0]
        .as_str()
        .is_some_and(|preview| preview.len() <= 16 * 1024));
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].row_index, 7);
    assert_eq!(failures[0].column_index, 0);
    assert_eq!(
        failures[0].database_type,
        format!("{}{}", super::super::TRUNCATED_CELL_TYPE_PREFIX, 600 * 1024)
    );

    // A 200-column result with 63-byte names and 3 KB values: the page envelope
    // and failure metadata are budgeted first, so every page stays within the
    // limit instead of failing as too large.
    let columns: Vec<String> = (0..200)
        .map(|index| format!("c{index:03}_{}", "n".repeat(58)))
        .collect();
    let budget = super::super::page_row_budget(&columns).unwrap();
    let mut row: Vec<Value> = (0..200).map(|_| Value::from("x".repeat(3_000))).collect();
    let mut failures = Vec::new();
    let size = super::super::fit_row_to_page(&mut row, &mut failures, 0, budget).unwrap();
    let page = serde_json::json!({
        "operationId": Uuid::nil(),
        "sequence": u64::MAX,
        "rowStart": usize::MAX,
        "columns": columns,
        "rows": [row],
        "decodeFailures": failures,
    });
    assert!(size <= budget);
    assert!(
        serde_json::to_vec(&page).unwrap().len() <= super::super::DESKTOP_STREAM_BATCH_MAX_BYTES
    );
}
