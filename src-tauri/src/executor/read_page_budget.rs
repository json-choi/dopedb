//! Page budget for streamed rows. A page's envelope (column names, identity)
//! and every row's failure metadata are counted before its rows, so a wide
//! result never overflows the page limit. One huge value must not fail a whole
//! result: the largest cells of an oversized row become bounded text previews,
//! each reported as failure metadata with its original size so the grid can mark
//! it and copy/export can refuse the incomplete value.

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::model::CellDecodeFailure;

/// Failure-metadata type of a cell shortened so its row fits one result page. The
/// cell keeps a bounded text preview; copy and export refuse it as incomplete.
pub(crate) const TRUNCATED_CELL_TYPE_PREFIX: &str = "dopedb.truncated:";
const TRUNCATED_PREVIEW_BYTES: usize = 16 * 1024;
const TRUNCATED_MIN_PREVIEW_BYTES: usize = 256;

/// Serialized JSON size, counted without allocating the serialization.
pub(super) fn json_size(value: &impl serde::Serialize) -> AppResult<usize> {
    struct Counter(usize);
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter(0);
    serde_json::to_writer(&mut counter, value)?;
    Ok(counter.0)
}

/// The longest prefix of `text` within `max_bytes` that ends on a character.
fn utf8_prefix(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Serialized bytes of a page's fixed fields (operation id, sequence, row start,
/// field names, brackets), reserved before its columns, rows, and failures.
const PAGE_ENVELOPE_BYTES: usize = 1024;
/// A page must keep at least this much room for rows after its column names.
const PAGE_MIN_ROW_BYTES: usize = 16 * 1024;

/// Room left on one page for rows and their failure metadata once the envelope
/// and the column names are counted, so a wide result never overflows a page.
pub(super) fn page_row_budget(columns: &[String]) -> AppResult<usize> {
    super::DESKTOP_STREAM_BATCH_MAX_BYTES
        .checked_sub(PAGE_ENVELOPE_BYTES + json_size(&columns)?)
        .filter(|budget| *budget >= PAGE_MIN_ROW_BYTES)
        .ok_or(AppError::ResultRowTooLarge)
}

/// Serialized bytes of failure entries, each with its list separator.
fn failures_size(failures: &[CellDecodeFailure]) -> AppResult<usize> {
    failures
        .iter()
        .try_fold(0, |total, failure| Ok(total + json_size(failure)? + 1))
}

/// Keeps one huge value from failing the whole result: the largest cells of an
/// oversized row become bounded text previews, each reported with its original
/// size so the grid can mark it and copy/export can refuse the incomplete value.
/// `failures` holds this row's failure metadata, which shares the page with it.
/// Returns the bytes the row and its failures add to a page.
pub(super) fn fit_row_to_page(
    values: &mut [Value],
    failures: &mut Vec<CellDecodeFailure>,
    row_index: usize,
    budget: usize,
) -> AppResult<usize> {
    let mut total = json_size(&values)? + 1 + failures_size(failures)?;
    if total <= budget {
        return Ok(total);
    }
    let mut sizes = values
        .iter()
        .map(json_size)
        .collect::<AppResult<Vec<_>>>()?;
    let mut shortened = vec![false; values.len()];
    while total > budget {
        let candidate = (0..values.len())
            .filter(|&index| {
                !shortened[index]
                    && !values[index].is_null()
                    && sizes[index] > TRUNCATED_MIN_PREVIEW_BYTES * 2
            })
            .max_by_key(|&index| sizes[index]);
        let Some(index) = candidate else {
            return Err(AppError::ResultRowTooLarge);
        };
        let text = match std::mem::take(&mut values[index]) {
            Value::String(text) => text,
            other => other.to_string(),
        };
        let failure = CellDecodeFailure {
            row_index,
            column_index: index,
            database_type: format!("{TRUNCATED_CELL_TYPE_PREFIX}{}", text.len()),
        };
        let failure_bytes = json_size(&failure)? + 1;
        // Shorten by the excess plus the failure entry and the preview's quotes the
        // shortening itself adds, so every step makes progress toward the budget.
        let keep = sizes[index]
            .saturating_sub(total - budget + failure_bytes + 2)
            .clamp(TRUNCATED_MIN_PREVIEW_BYTES, TRUNCATED_PREVIEW_BYTES);
        values[index] = Value::String(utf8_prefix(&text, keep).to_owned());
        let size = json_size(&values[index])?;
        total = total - sizes[index] + size + failure_bytes;
        failures.push(failure);
        sizes[index] = size;
        shortened[index] = true;
    }
    Ok(total)
}

/// Streams a materialized remote result (BigQuery, D1) as the same bounded pages a
/// cursor produces, shrinking any row too large for one page.
pub(super) async fn stream_materialized<F, Fut>(
    result: crate::model::QueryResult,
    batch_rows: usize,
    started: std::time::Instant,
    on_batch: &mut F,
) -> AppResult<super::StreamedRead>
where
    F: FnMut(super::ReadBatch) -> Fut + Send,
    Fut: std::future::Future<Output = AppResult<()>> + Send,
{
    let columns = result.columns.clone();
    let row_count = result.rows.len();
    let first_row_ms = (!result.rows.is_empty()).then(|| started.elapsed().as_millis() as u64);
    let budget = page_row_budget(&columns)?;
    let mut failures_by_row = std::collections::BTreeMap::<usize, Vec<CellDecodeFailure>>::new();
    for failure in result.decode_failures {
        failures_by_row
            .entry(failure.row_index)
            .or_default()
            .push(failure);
    }
    let mut batch = Vec::with_capacity(batch_rows);
    let mut batch_failures = Vec::new();
    let mut batch_bytes = 0usize;
    for (row_index, mut row) in result.rows.into_iter().enumerate() {
        let mut row_failures = failures_by_row.remove(&row_index).unwrap_or_default();
        let row_bytes = fit_row_to_page(&mut row, &mut row_failures, row_index, budget)?;
        if !batch.is_empty() && batch_bytes.saturating_add(row_bytes) > budget {
            on_batch(super::ReadBatch {
                columns: columns.clone(),
                rows: std::mem::take(&mut batch),
                decode_failures: std::mem::take(&mut batch_failures),
            })
            .await?;
            batch = Vec::with_capacity(batch_rows);
            batch_bytes = 0;
        }
        batch_bytes += row_bytes;
        batch.push(row);
        batch_failures.extend(row_failures);
        if batch.len() == batch_rows {
            on_batch(super::ReadBatch {
                columns: columns.clone(),
                rows: std::mem::take(&mut batch),
                decode_failures: std::mem::take(&mut batch_failures),
            })
            .await?;
            batch = Vec::with_capacity(batch_rows);
            batch_bytes = 0;
        }
    }
    if !batch.is_empty() || row_count == 0 {
        on_batch(super::ReadBatch {
            columns: columns.clone(),
            rows: batch,
            decode_failures: batch_failures,
        })
        .await?;
    }
    Ok(super::StreamedRead {
        columns,
        row_count,
        truncated: result.truncated,
        duration_ms: started.elapsed().as_millis() as u64,
        first_row_ms,
    })
}
