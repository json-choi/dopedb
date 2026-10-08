// Strict field predicates shared by the Neon inventory and operation parsers. Each
// accepts only the exact shape and bounds the control plane documents, so a parser
// built from them can reject a whole response instead of guessing at a field.
import type { NeonEnvironment } from "./domain";

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** An object with exactly these own keys and no others. */
export function exact(value: unknown, fields: readonly string[]) {
  const row = record(value);
  return row
    && Object.keys(row).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(row, field))
    ? row
    : null;
}

/** Display text without control or bidirectional override characters. */
export function isSafeNeonText(value: unknown, maximum = 512): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f‪-‮⁦-⁩]/.test(value);
}

/** Neon project, branch and endpoint identifiers. */
export function isNeonSegment(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,59}$/.test(value);
}

export function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function instant(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

export function integer(value: unknown, maximum = 1_000_000): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= maximum;
}

export function nullable<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
): value is T | null {
  return value === null || predicate(value);
}

export function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

/** Integration generations are decimal text so a 64-bit counter survives JSON. */
export function generation(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

export function warningCodes(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 16
    && value.every((code) => typeof code === "string" && /^NEON_[A-Z0-9_]{1,95}$/.test(code));
}

export function environment(value: unknown): value is NeonEnvironment {
  return value === "development" || value === "production";
}

/** Server reason codes such as deletion blockers and failure codes. */
export function reasonCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value);
}
