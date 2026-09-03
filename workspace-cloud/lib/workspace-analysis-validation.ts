const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UNSAFE_DISPLAY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/u;

export function exactRecord(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(record, field))
    ? record
    : null;
}

export function displayText(
  value: unknown,
  maxChars: number,
  allowEmpty = false,
) {
  if (typeof value !== "string" || UNSAFE_DISPLAY.test(value)) return null;
  const trimmed = value.trim();
  if ((!allowEmpty && trimmed.length === 0) || [...value].length > maxChars) {
    return null;
  }
  return allowEmpty ? value : trimmed;
}

export function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

export function analysisId(value: unknown) {
  return typeof value === "string" && ID.test(value) ? value : null;
}

export function uniqueValues(values: readonly string[]) {
  return new Set(values).size === values.length;
}
