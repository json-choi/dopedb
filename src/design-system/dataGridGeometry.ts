// Canonical compact result-grid geometry. Both table and virtual renderers
// consume this product-owned contract.
export const DATA_GRID_HEADER_HEIGHT = 28;
export const DATA_GRID_ROW_HEIGHT = 28;
export const DATA_GRID_ROW_NUMBER_WIDTH = 28;
export const DATA_GRID_DEFAULT_COLUMN_WIDTH = 144;

// Monospace digit advance at the 14px grid text size, plus the cell's 8px side
// padding and its row-number divider.
const ROW_NUMBER_DIGIT_WIDTH = 8.5;
const ROW_NUMBER_CHROME_WIDTH = 18;

/** Row-number column wide enough for the largest number it shows (28px minimum). */
export function dataGridRowNumberWidth(largestRowNumber: number): number {
  const digits = String(Math.max(1, Math.trunc(largestRowNumber))).length;
  return Math.max(
    DATA_GRID_ROW_NUMBER_WIDTH,
    Math.ceil(digits * ROW_NUMBER_DIGIT_WIDTH) + ROW_NUMBER_CHROME_WIDTH,
  );
}
