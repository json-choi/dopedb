// The fixed environment list shared by Project environments, connection labels, and every
// production safeguard. The kind is the environment: there is no free name or risk class.
import type { I18nKey } from "./i18n";

/** Most sensitive first; this is also the display order everywhere environments are listed. */
export const ENVIRONMENT_KINDS = ["production", "staging", "test", "development"] as const;

export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const ENVIRONMENT_KIND_LABEL_KEYS = {
  production: "connections.environmentKindProduction",
  staging: "connections.environmentKindStaging",
  test: "connections.environmentKindTest",
  development: "connections.environmentKindDevelopment",
} as const satisfies Record<EnvironmentKind, I18nKey>;

/** Higher is more sensitive: production > staging > test > development. */
export function environmentKindSensitivity(kind: EnvironmentKind): number {
  return ENVIRONMENT_KINDS.length - 1 - ENVIRONMENT_KINDS.indexOf(kind);
}

export function compareEnvironmentKinds(left: EnvironmentKind, right: EnvironmentKind): number {
  return environmentKindSensitivity(right) - environmentKindSensitivity(left);
}

/**
 * Reads a stored or wire label as a kind. The short labels earlier connection profiles used
 * (`prod`, `dev`) are accepted; any other label, such as `custom`, is not an environment.
 */
export function parseEnvironmentKind(label: unknown): EnvironmentKind | null {
  if (typeof label !== "string") return null;
  const normalized = label.trim().toLowerCase();
  if (normalized === "prod") return "production";
  if (normalized === "dev") return "development";
  return (ENVIRONMENT_KINDS as readonly string[]).includes(normalized)
    ? (normalized as EnvironmentKind)
    : null;
}

/**
 * The single effective-environment rule: the most sensitive of every bound kind and the
 * connection's own label. A production label is never lowered by a development binding.
 */
export function effectiveEnvironment(
  own: EnvironmentKind | null | undefined,
  bound: Iterable<EnvironmentKind>,
): EnvironmentKind | null {
  let strongest: EnvironmentKind | null = own ?? null;
  for (const kind of bound) {
    if (!strongest || compareEnvironmentKinds(kind, strongest) < 0) strongest = kind;
  }
  return strongest;
}

/** The localized display name of a kind, for headers, trees, and selects. */
export function environmentKindLabel(
  t: (key: I18nKey) => string,
  kind: EnvironmentKind,
): string {
  return t(ENVIRONMENT_KIND_LABEL_KEYS[kind]);
}

/** The order environment selects list the four kinds in. */
export const ENVIRONMENT_KIND_CHOICES = ["development", "staging", "production", "test"] as const satisfies readonly EnvironmentKind[];
