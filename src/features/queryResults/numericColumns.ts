// Numeric-column judgement shared by the table and virtual result renderers, so a
// money or NUMERIC column is right-aligned the same way in a table page and in a
// SQL result. NUMERIC/MONEY arrive as exact decimal strings (the Rust side
// serializes them lossless), so the judgement reads value shape, per column rather
// than per cell — one digit-only value in a text column must not render ragged.
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

export function isNumericGridValue(value: unknown): boolean {
  return (
    typeof value === "number" ||
    (typeof value === "string" && NUMERIC_TEXT.test(value))
  );
}

/**
 * Judge each column over the rows the renderer can actually see. A windowed
 * renderer cannot scan every row, so `sticky` carries the previous judgement of
 * the same column set forward: a column that already read as numeric stays
 * right-aligned while scrolling instead of snapping back on each new window.
 * Callers drop `sticky` whenever the column set changes.
 */
export function numericGridColumns(
  columnCount: number,
  rows: Iterable<readonly unknown[] | undefined>,
  sticky?: readonly boolean[],
): boolean[] {
  const seen = new Array<boolean>(columnCount).fill(false);
  const numeric = new Array<boolean>(columnCount).fill(true);
  for (const row of rows) {
    if (!row) continue;
    for (let column = 0; column < columnCount; column += 1) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      seen[column] = true;
      if (!isNumericGridValue(value)) numeric[column] = false;
    }
  }
  return numeric.map(
    (isNumeric, column) =>
      (isNumeric && seen[column]) || sticky?.[column] === true,
  );
}
