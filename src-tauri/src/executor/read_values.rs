//! Lossless JSON decoding for PostgreSQL, MySQL, and SQLite rows.

use super::*;

/// JS `Number` loses precision past 2^53; anything larger is emitted as a string.
const JS_MAX_SAFE_INT: u64 = 1 << 53;

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

fn hex_str(b: Vec<u8>) -> String {
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

/// MONEY has no scale on the wire; the fractional-digit count comes from the DB's
/// `lc_monetary`. 2 is the near-universal default (en_US etc). ponytail: single knob —
/// set per-connection from `SHOW lc_monetary` (0 for KRW/JPY) if a DB ever needs it.
const PG_MONEY_FRAC_DIGITS: u32 = 2;

pub(crate) fn pg_value(row: &PgRow, i: usize) -> DecodedCell {
    let ty = row.column(i).type_info().name().to_ascii_uppercase();
    match ty.as_str() {
        "BOOL" => decode_result(row, i, &ty, row.try_get::<bool, _>(i)),
        "INT2" => decode_result(row, i, &ty, row.try_get::<i16, _>(i).map(|v| v as i64)),
        "INT4" => decode_result(row, i, &ty, row.try_get::<i32, _>(i).map(|v| v as i64)),
        "INT8" => int_result(row, i, &ty, row.try_get::<i64, _>(i)),
        "OID" => decode_result(row, i, &ty, row.try_get::<Oid, _>(i).map(|o| o.0)),
        "FLOAT4" => decode_result(row, i, &ty, row.try_get::<f32, _>(i).map(|v| v as f64)),
        "FLOAT8" => decode_result(row, i, &ty, row.try_get::<f64, _>(i)),
        // NUMERIC: exact string; out-of-range for Decimal becomes explicit failure metadata.
        "NUMERIC" => match row.try_get::<Decimal, _>(i) {
            Ok(d) => decoded(Value::String(d.to_string())),
            Err(_) => null_or_failure(row, i, &ty),
        },
        // MONEY is an i64 of minor units, NOT a Decimal on the wire (rust_decimal only
        // decodes NUMERIC), so it needs PgMoney; the old NUMERIC|MONEY arm lost the distinction.
        "MONEY" => match row.try_get::<PgMoney, _>(i) {
            Ok(m) => decoded(Value::String(
                m.to_decimal(PG_MONEY_FRAC_DIGITS).to_string(),
            )),
            Err(_) => null_or_failure(row, i, &ty),
        },
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "CITEXT" => {
            decode_result(row, i, &ty, row.try_get::<String, _>(i))
        }
        "UUID" => decode_result(
            row,
            i,
            &ty,
            row.try_get::<uuid::Uuid, _>(i).map(|u| u.to_string()),
        ),
        "JSON" | "JSONB" => decode_result(row, i, &ty, row.try_get::<Value, _>(i)),
        "TIMESTAMPTZ" => decode_result(
            row,
            i,
            &ty,
            row.try_get::<DateTime<Utc>, _>(i).map(|t| t.to_rfc3339()),
        ),
        "TIMESTAMP" => decode_result(row, i, &ty, row.try_get::<NaiveDateTime, _>(i).map(iso_dt)),
        "DATE" => decode_result(
            row,
            i,
            &ty,
            row.try_get::<NaiveDate, _>(i).map(|t| t.to_string()),
        ),
        "TIME" => decode_result(
            row,
            i,
            &ty,
            row.try_get::<NaiveTime, _>(i).map(|t| t.to_string()),
        ),
        "TIMETZ" => match row.try_get::<PgTimeTz<NaiveTime, FixedOffset>, _>(i) {
            Ok(t) => decoded(Value::from(fmt_timetz(&t))),
            Err(_) => null_or_failure(row, i, &ty),
        },
        "INTERVAL" => match row.try_get::<PgInterval, _>(i) {
            Ok(iv) => decoded(Value::from(fmt_interval(&iv))),
            Err(_) => null_or_failure(row, i, &ty),
        },
        // Ranges render via PgRange's Display ("[1,5)" canonical form).
        "INT4RANGE" => pg_range::<i32>(row, i, &ty),
        "INT8RANGE" => pg_range::<i64>(row, i, &ty),
        "NUMRANGE" => pg_range::<Decimal>(row, i, &ty),
        "DATERANGE" => pg_range::<NaiveDate>(row, i, &ty),
        "TSRANGE" => pg_range::<NaiveDateTime>(row, i, &ty),
        "TSTZRANGE" => pg_range::<DateTime<Utc>>(row, i, &ty),
        "BYTEA" => decode_result(row, i, &ty, row.try_get::<Vec<u8>, _>(i).map(hex_str)),
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
        // arrays (NAME[]/INT4[]/…) and custom enums land here.
        _ if ty.ends_with("[]") => pg_array(row, i, &ty),
        _ => pg_fallback(row, i, &ty),
    }
}

/// Render a range column as text via `PgRange<T>`'s `Display`. Generic over the element
/// so the six range types share one body; each `T` here has an owned `Decode` impl.
fn pg_range<T>(row: &PgRow, i: usize, ty: &str) -> DecodedCell
where
    T: std::fmt::Display,
    PgRange<T>: sqlx::Type<sqlx::Postgres>,
    for<'a> PgRange<T>: sqlx::Decode<'a, sqlx::Postgres>,
{
    match row.try_get::<PgRange<T>, _>(i) {
        Ok(r) => decoded(Value::from(r.to_string())),
        Err(_) => null_or_failure(row, i, ty),
    }
}

/// Map a decoded `Vec<Option<T>>` to a JSON array, NULL elements → `Value::Null`.
/// Decoding `Option<T>` per element is what lets an array containing a NULL decode at
/// all: sqlx runs `T::decode` on every element, so a bare `Vec<T>` errors on the first
/// NULL and fails the whole cell (a very common shape for real array columns).
fn arr<T>(
    r: Result<Vec<Option<T>>, sqlx::Error>,
    f: impl Fn(T) -> Value,
) -> Result<Vec<Value>, sqlx::Error> {
    r.map(|v| {
        v.into_iter()
            .map(|x| x.map(&f).unwrap_or(Value::Null))
            .collect()
    })
}

/// Decode a PG array into a JSON array of the element rendering. sqlx names array types
/// `<BASE>[]` (display_name), so the element type is the name minus the `[]` suffix.
fn pg_array(row: &PgRow, i: usize, ty: &str) -> DecodedCell {
    let elem = ty.strip_suffix("[]").unwrap_or(ty);
    let decoded_values: Result<Vec<Value>, sqlx::Error> = match elem {
        "INT2" => arr(row.try_get(i), |x: i16| Value::from(x as i64)),
        "INT4" => arr(row.try_get(i), |x: i32| Value::from(x as i64)),
        "INT8" => arr(row.try_get(i), int_json),
        "FLOAT4" => arr(row.try_get(i), |x: f32| Value::from(x as f64)),
        "FLOAT8" => arr(row.try_get(i), |x: f64| Value::from(x)),
        "BOOL" => arr(row.try_get(i), |x: bool| Value::from(x)),
        "NUMERIC" => arr(row.try_get(i), |d: Decimal| Value::from(d.to_string())),
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "CITEXT" => {
            arr(row.try_get(i), |s: String| Value::from(s))
        }
        "UUID" => arr(row.try_get(i), |u: Uuid| Value::from(u.to_string())),
        "TIMESTAMPTZ" => arr(row.try_get(i), |t: DateTime<Utc>| {
            Value::from(t.to_rfc3339())
        }),
        "TIMESTAMP" => arr(row.try_get(i), |t: NaiveDateTime| Value::from(iso_dt(t))),
        "DATE" => arr(row.try_get(i), |t: NaiveDate| Value::from(t.to_string())),
        "TIME" => arr(row.try_get(i), |t: NaiveTime| Value::from(t.to_string())),
        "JSON" | "JSONB" => arr(row.try_get(i), |v: Value| v),
        // enum[] has an arbitrary element type name; detect structurally and read labels.
        _ => return pg_enum_array(row, i, ty),
    };
    match decoded_values {
        Ok(v) => decoded(Value::Array(v)),
        Err(_) => null_or_failure(row, i, ty),
    }
}

/// An array whose element type name matched nothing above: if it is structurally an
/// array-of-enum, decode the labels (via `try_get_unchecked`, which skips the element
/// compat check that would otherwise reject the enum). Anything else is a decode failure.
fn pg_enum_array(row: &PgRow, i: usize, ty: &str) -> DecodedCell {
    if let PgTypeKind::Array(inner) = row.column(i).type_info().kind() {
        if matches!(inner.kind(), PgTypeKind::Enum(_)) {
            if let Ok(v) = row.try_get_unchecked::<Vec<Option<String>>, _>(i) {
                return decoded(Value::Array(
                    v.into_iter()
                        .map(|x| x.map(Value::from).unwrap_or(Value::Null))
                        .collect(),
                ));
            }
        }
    }
    null_or_failure(row, i, ty)
}

fn pg_fallback(row: &PgRow, i: usize, ty: &str) -> DecodedCell {
    if let Ok(s) = row.try_get::<String, _>(i) {
        return decoded(Value::from(s));
    }
    if let Ok(v) = row.try_get::<i64, _>(i) {
        return decoded(int_json(v));
    }
    if let Ok(v) = row.try_get::<f64, _>(i) {
        return decoded(Value::from(v));
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
    let mut out: Vec<String> = Vec::new();
    let (years, mons) = (iv.months / 12, iv.months % 12);
    if years != 0 {
        out.push(format!(
            "{years} year{}",
            if years.abs() == 1 { "" } else { "s" }
        ));
    }
    if mons != 0 {
        out.push(format!(
            "{mons} mon{}",
            if mons.abs() == 1 { "" } else { "s" }
        ));
    }
    if iv.days != 0 {
        out.push(format!(
            "{} day{}",
            iv.days,
            if iv.days.abs() == 1 { "" } else { "s" }
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

/// TIMETZ as "13:14:15+02:00" (NaiveTime + FixedOffset both Display to those forms).
fn fmt_timetz(t: &PgTimeTz<NaiveTime, FixedOffset>) -> String {
    format!("{}{}", t.time, t.offset)
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
        "DATETIME" | "TIMESTAMP" => MySqlDecodeRoute::DateTime,
        "DATE" => MySqlDecodeRoute::Date,
        "TIME" => MySqlDecodeRoute::Time,
        "JSON" => MySqlDecodeRoute::Json,
        _ => MySqlDecodeRoute::Fallback,
    }
}

pub(crate) fn mysql_value(row: &MySqlRow, i: usize) -> DecodedCell {
    let ty = row.column(i).type_info().name().to_ascii_uppercase();
    match mysql_decode_route(&ty) {
        // SQLx models YEAR as an unsigned integer even though its type name does
        // not carry the `UNSIGNED` suffix used by ordinary integer columns.
        MySqlDecodeRoute::UnsignedInteger => uint_result(row, i, &ty, row.try_get::<u64, _>(i)),
        MySqlDecodeRoute::Binary => {
            decode_result(row, i, &ty, row.try_get::<Vec<u8>, _>(i).map(hex_str))
        }
        MySqlDecodeRoute::SignedInteger => int_result(row, i, &ty, row.try_get::<i64, _>(i)),
        MySqlDecodeRoute::Float32 => {
            decode_result(row, i, &ty, row.try_get::<f32, _>(i).map(|v| v as f64))
        }
        MySqlDecodeRoute::Float64 => decode_result(row, i, &ty, row.try_get::<f64, _>(i)),
        MySqlDecodeRoute::Decimal => match row.try_get::<Decimal, _>(i) {
            Ok(d) => decoded(Value::String(d.to_string())),
            Err(_) => null_or_failure(row, i, &ty),
        },
        MySqlDecodeRoute::Text => decode_result(row, i, &ty, row.try_get::<String, _>(i)),
        // SET is textual on the wire, but SQLx 0.8 omits ColumnType::Set from
        // String::compatible. The unchecked get skips only that type guard while
        // retaining SQLx's normal UTF-8 decoder.
        MySqlDecodeRoute::Set => match row.try_get_unchecked::<String, _>(i) {
            Ok(value) => decoded(Value::from(value)),
            Err(_) => null_or_failure(row, i, &ty),
        },
        MySqlDecodeRoute::DateTime => decode_result(
            row,
            i,
            &ty,
            row.try_get::<chrono::NaiveDateTime, _>(i).map(iso_dt),
        ),
        MySqlDecodeRoute::Date => decode_result(
            row,
            i,
            &ty,
            row.try_get::<chrono::NaiveDate, _>(i)
                .map(|t| t.to_string()),
        ),
        MySqlDecodeRoute::Time => match row.try_get::<MySqlTime, _>(i) {
            Ok(t) => decoded(Value::from(fmt_mysql_time(&t))),
            Err(_) => mysql_fallback(row, i, &ty),
        },
        MySqlDecodeRoute::Json => decode_result(row, i, &ty, row.try_get::<Value, _>(i)),
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
        return decoded(Value::from(v));
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
    // ponytail: SQLite is dynamically typed (declared type != stored class), so probe
    // storage classes in order. The five classes are covered, so all-fail == real NULL.
    if let Ok(v) = row.try_get::<i64, _>(i) {
        return decoded(int_json(v));
    }
    if let Ok(v) = row.try_get::<f64, _>(i) {
        return decoded(Value::from(v));
    }
    if let Ok(s) = row.try_get::<String, _>(i) {
        return decoded(Value::from(s));
    }
    if let Ok(b) = row.try_get::<Vec<u8>, _>(i) {
        return decoded(Value::from(hex_str(b)));
    }
    null_or_failure(row, i, row.column(i).type_info().name())
}
