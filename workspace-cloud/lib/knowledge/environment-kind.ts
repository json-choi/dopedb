// The fixed Project environment list. The kind is the environment: a Project
// holds at most one environment per kind. Pre-kind Desktops still send and read
// `{name, riskClass}`; this module is the only place that maps between the shapes.

export const ENVIRONMENT_KINDS = ["development", "staging", "production", "test"] as const;

export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

const LEGACY_DISPLAY_NAMES: Record<EnvironmentKind, string> = {
  development: "Development",
  staging: "Staging",
  production: "Production",
  test: "Test",
};

export function isEnvironmentKind(value: unknown): value is EnvironmentKind {
  return typeof value === "string" && (ENVIRONMENT_KINDS as readonly string[]).includes(value);
}

/** Pre-kind fields derived from the kind, so older Desktops keep reading a name and class. */
export function legacyEnvironmentFields(kind: EnvironmentKind) {
  return { name: LEGACY_DISPLAY_NAMES[kind], riskClass: kind };
}

/** The `name` column value for a kind (the column survives only for older Desktops). */
export function legacyEnvironmentName(kind: EnvironmentKind) {
  return LEGACY_DISPLAY_NAMES[kind];
}

/**
 * Accepts `{kind}` or the legacy `{name, riskClass}` (name ignored, `custom` read as
 * development). Any other shape or value is invalid. `extraKeys` lets a caller allow its
 * own sibling fields (for example `id` and `revision`).
 */
export function parseEnvironmentKind(
  value: unknown,
  extraKeys: readonly string[] = [],
): EnvironmentKind | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => !extraKeys.includes(key)).sort().join(",");
  if (keys === "kind") return isEnvironmentKind(record.kind) ? record.kind : null;
  if (keys === "name,riskClass") {
    if (typeof record.name !== "string") return null;
    if (record.riskClass === "custom") return "development";
    return isEnvironmentKind(record.riskClass) ? record.riskClass : null;
  }
  return null;
}

const CONNECTION_LABEL_TOKENS: Record<EnvironmentKind, string> = {
  production: "prod",
  development: "dev",
  staging: "staging",
  test: "test",
};

/**
 * The connection label stored in D1 and returned to Desktops. Desktops that predate the fixed
 * list only check `prod`, so a kind is stored as its legacy token (`production` becomes
 * `prod`, `development` becomes `dev`) and tokens pass through. Both forms are accepted on
 * input; any other free text is left as it was.
 */
export function connectionEnvironmentLabel(label: string | null): string | null {
  return isEnvironmentKind(label) ? CONNECTION_LABEL_TOKENS[label] : label;
}

/** Reads a stored connection label (a kind or a legacy token) back as a kind; other text is none. */
export function connectionEnvironmentKind(label: string | null | undefined): EnvironmentKind | null {
  if (label === "prod") return "production";
  if (label === "dev") return "development";
  return isEnvironmentKind(label) ? label : null;
}
