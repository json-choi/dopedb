// Pure provider-account rules for the Connect accounts view: which catalog
// entries Desktop can connect, grouping accounts under their provider, form
// checks that mirror the control plane's bounds, managed-database counts, and
// the change detection that proves a browser authorization saved an account.
import type { OAuthProvider } from "../../domain";
import type {
  Integration,
  ManagedConnection,
  NeonConfiguration,
  Provider,
  VaultConfiguration,
} from "../domain";

export type ConnectableProvider = OAuthProvider | "neon" | "vault";
export type FormProvider = "neon" | "vault";

export type ProviderAccountGroup = {
  id: string;
  provider: Provider | null;
  connectable: ConnectableProvider | null;
  integrations: Integration[];
};

/** Opens the credential form of a provider that connects without a browser sign-in. */
export type ConnectDialogRequest = {
  provider: FormProvider;
  providerName: string;
  mode: "connect" | "reconnect";
};

const NEON_IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,59}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Only configured providers whose setup kind Desktop implements are connectable. */
export function connectableProvider(provider: Provider): ConnectableProvider | null {
  if (!provider.configured) return null;
  if (provider.id === "planetScale" && provider.setupKind === "oauth") return "planetScale";
  if (provider.id === "gcpCloudSql" && provider.setupKind === "oauth") return "gcpCloudSql";
  if (provider.id === "neon" && provider.setupKind === "apiKey") return "neon";
  if (provider.id === "vault" && provider.setupKind === "appRole") return "vault";
  return null;
}

/**
 * Provider rows in catalog order. A provider appears when it can be connected
 * here or still owns accounts, so an account is never hidden from disconnect.
 */
export function providerAccountGroups(
  providers: Provider[],
  integrations: Integration[],
): ProviderAccountGroup[] {
  const groups: ProviderAccountGroup[] = providers.flatMap((provider) => {
    const owned = integrations.filter((item) => item.provider === provider.id);
    const connectable = connectableProvider(provider);
    return connectable || owned.length > 0
      ? [{ id: provider.id, provider, connectable, integrations: owned }]
      : [];
  });
  const known = new Set(providers.map((provider) => provider.id));
  const unknown = [...new Set(
    integrations.filter((item) => !known.has(item.provider)).map((item) => item.provider),
  )];
  for (const id of unknown) {
    groups.push({
      id,
      provider: null,
      connectable: null,
      integrations: integrations.filter((item) => item.provider === id),
    });
  }
  return groups;
}

export function integrationNeedsReconnect(integration: Integration): boolean {
  return integration.status === "reconnect_required" || integration.reconnectRequired === true;
}

export function hasBroadNeonKey(integration: Integration): boolean {
  return integration.provider === "neon"
    && (integration.grantedScope ?? "").includes(":personal:broad:");
}

/** The server labels Neon accounts with a Korean project count; expose the number. */
export function neonProjectCount(displayName: string): number | null {
  const match = /^Neon · 프로젝트 (\d+)개$/.exec(displayName);
  return match ? Number(match[1]) : null;
}

export function managedDatabaseCount(
  managed: ManagedConnection[] | null | undefined,
  integrationId: string,
): number | null {
  if (!managed) return null;
  return managed.filter((item) => item.integrationId === integrationId).length;
}

export function managedConnectionIds(
  managed: ManagedConnection[] | null | undefined,
  integrationId: string,
): string[] {
  return (managed ?? [])
    .filter((item) => item.integrationId === integrationId)
    .map((item) => item.connectionId);
}

/** Snapshot of one provider's accounts before a browser authorization starts. */
export function integrationBaseline(
  integrations: Integration[],
  provider: string,
): ReadonlyMap<string, string> {
  return new Map(
    integrations
      .filter((item) => item.provider === provider)
      .map((item) => [item.id, item.updatedAt]),
  );
}

/** True when an account was added or re-saved since the baseline snapshot. */
export function integrationChangedSince(
  baseline: ReadonlyMap<string, string>,
  integrations: Integration[],
  provider: string,
): boolean {
  return integrations.some(
    (item) => item.provider === provider && baseline.get(item.id) !== item.updatedAt,
  );
}

export type NeonFormIssues = {
  apiKey: boolean;
  projectId: boolean;
  organizationId: boolean;
};

export function neonFormIssues(form: NeonConfiguration): NeonFormIssues {
  const apiKey = form.apiKey.trim();
  const projectId = form.projectId.trim();
  const organizationId = form.organizationId.trim();
  return {
    apiKey: apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey),
    projectId: projectId !== "" && !NEON_IDENTIFIER.test(projectId),
    organizationId: organizationId !== "" && !NEON_IDENTIFIER.test(organizationId),
  };
}

export function hasNeonFormIssues(issues: NeonFormIssues): boolean {
  return issues.apiKey || issues.projectId || issues.organizationId;
}

export type VaultFieldIssue = "required" | "invalid";
export type VaultFormIssues = Partial<Record<keyof VaultConfiguration, VaultFieldIssue>>;

function requiredText(value: string, maximum: number): VaultFieldIssue | null {
  const trimmed = value.trim();
  if (!trimmed) return "required";
  return trimmed.length > maximum || CONTROL.test(trimmed) ? "invalid" : null;
}

function optionalText(value: string, maximum: number): VaultFieldIssue | null {
  const trimmed = value.trim();
  return trimmed && (trimmed.length > maximum || CONTROL.test(trimmed)) ? "invalid" : null;
}

function httpsOrigin(value: string): VaultFieldIssue | null {
  const issue = requiredText(value, 2_048);
  if (issue) return issue;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname ? null : "invalid";
  } catch {
    return "invalid";
  }
}

function port(value: string): VaultFieldIssue | null {
  const trimmed = value.trim();
  if (!trimmed) return "required";
  const number = Number(trimmed);
  return /^\d{1,5}$/.test(trimmed) && number >= 1 && number <= 65_535 ? null : "invalid";
}

/** Mirrors the native request bounds so an invalid form never reaches the service. */
export function vaultFormIssues(form: VaultConfiguration): VaultFormIssues {
  const checks: Array<[keyof VaultConfiguration, VaultFieldIssue | null]> = [
    ["address", httpsOrigin(form.address)],
    ["namespace", optionalText(form.namespace, 512)],
    ["authMount", requiredText(form.authMount, 512)],
    ["roleId", requiredText(form.roleId, 2_048)],
    ["secretId", requiredText(form.secretId, 2_048)],
    ["databaseMount", requiredText(form.databaseMount, 512)],
    ["databaseConnection", requiredText(form.databaseConnection, 512)],
    ["readRole", requiredText(form.readRole, 512)],
    ["writeRole", optionalText(form.writeRole, 512)],
    ["host", requiredText(form.host, 512)],
    ["port", port(form.port)],
    ["database", requiredText(form.database, 512)],
  ];
  return Object.fromEntries(
    checks.filter((entry): entry is [keyof VaultConfiguration, VaultFieldIssue] => entry[1] !== null),
  );
}

/** Keeps a custom port while switching engines replaces only the previous default. */
export function vaultEngineChange(
  form: VaultConfiguration,
  engine: VaultConfiguration["engine"],
): VaultConfiguration {
  const previousDefault = form.engine === "postgres" ? "5432" : "3306";
  return {
    ...form,
    engine,
    port: form.port === previousDefault ? (engine === "postgres" ? "5432" : "3306") : form.port,
  };
}
