import "server-only";

import { MAX_PROVIDER_RESULTS } from "../providers/adapter-contract";
import { openProviderCredential, sealProviderCredential } from "../secret-envelope";
import {
  claimPlanetScaleCredentialRefresh,
  finalizePlanetScaleCredentialRefresh,
  markPlanetScaleCredentialRefreshRemoteStarted,
  requirePlanetScaleCredentialReconnect,
} from "../provider-integration-mutation-store";
import {
  listPlanetScaleBranches,
  listPlanetScaleDatabases,
  listPlanetScaleOrganizations,
  PlanetScaleRequestError,
  refreshPlanetScaleToken,
  revokePlanetScaleAuthorization,
  type PlanetScaleToken,
} from "../providers/planetscale";
import { missingPlanetScaleManagedScopes } from "../providers/planetscale-core";
import {
  inspectNeonCredential,
  listNeonBranchInventory,
  listNeonBranches,
  listNeonDatabases,
  listNeonProjects,
} from "../providers/neon";
import { neonBranchQueryable } from "../providers/neon-branches";
import { parseNeonCredential } from "../providers/neon-core";
import {
  listGcpCloudSqlDatabases,
  listGcpCloudSqlInstances,
  listGcpProjects,
} from "../providers/gcp-cloud-sql";
import {
  parseGcpCloudSqlCredential,
  type GcpCloudSqlCredential,
} from "../providers/gcp-cloud-sql-core";
import {
  ProviderRequestError,
  type ProviderResourceItem,
} from "../providers/provider-types";
import {
  parseVaultCredential,
  vaultManagedResource,
} from "../providers/vault";
import {
  type ActiveProviderIntegration,
  type ProviderMutationAuthority,
} from "./authority";
import { isSegment } from "./domain";

function boundedDiscoveryResults(items: ProviderResourceItem[]): ProviderResourceItem[] {
  const neonStates = new Set(["init", "resetting", "ready", "archived", "unknown"]);
  if (items.length > MAX_PROVIDER_RESULTS) {
    throw new ProviderRequestError("provider", "Provider discovery result is too large", 409);
  }
  return items.map((item) => {
    if (
      typeof item.id !== "string" || item.id.length === 0 || item.id.length > 512
      || typeof item.name !== "string" || item.name.length === 0 || item.name.length > 512
      || typeof item.value !== "string" || item.value.length === 0 || item.value.length > 512
      || /[\u0000-\u001f\u007f]/.test(item.id)
      || /[\u0000-\u001f\u007f]/.test(item.name)
      || /[\u0000-\u001f\u007f]/.test(item.value)
      || (item.kind !== undefined && item.kind !== "postgres" && item.kind !== "mysql")
      // `unknown` is an intentional tri-state adapter value. It is preserved
      // for the UI and must never be silently lowered to a safe-looking false;
      // allowDiscoveryImport below still accepts only explicit false.
      || (item.production !== undefined
        && typeof item.production !== "boolean"
        && item.production !== "unknown")
      || (item.ready !== undefined && typeof item.ready !== "boolean")
      || (item.safeMigrations !== undefined && typeof item.safeMigrations !== "boolean")
      || (item.providerTarget !== undefined && (
        item.providerTarget.provider !== "neon"
        || !isSegment(item.providerTarget.projectId)
        || !isSegment(item.providerTarget.branchId)
        || item.providerTarget.name.length === 0
        || item.providerTarget.name.length > 256
        || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(item.providerTarget.name)
        || !neonStates.has(item.providerTarget.currentState)
        || (item.providerTarget.pendingState !== null
          && !neonStates.has(item.providerTarget.pendingState))
        || typeof item.providerTarget.default !== "boolean"
        || typeof item.providerTarget.protected !== "boolean"
      ))
    ) {
      throw new ProviderRequestError("provider", "Provider returned an invalid resource", 502);
    }
    // Rebuild the wire DTO so a provider SDK/runtime response cannot smuggle
    // unexpected token, password, endpoint or metadata fields into the browser.
    return {
      id: item.id,
      name: item.name,
      value: item.value,
      ...(item.kind !== undefined ? { kind: item.kind } : {}),
      ...(item.production !== undefined ? { production: item.production } : {}),
      ...(item.ready !== undefined ? { ready: item.ready } : {}),
      ...(item.safeMigrations !== undefined
        ? { safeMigrations: item.safeMigrations }
        : {}),
    };
  });
}

export async function providerAccessToken(
  integration: ActiveProviderIntegration,
  authority: ProviderMutationAuthority,
): Promise<string> {
  if (integration.provider !== "planetScale") {
    throw new Error("PlanetScale access token requested for another provider");
  }
  const credential = openProviderCredential<PlanetScaleToken>(
    integration.id,
    integration.encryptedCredential,
  );
  if (missingPlanetScaleManagedScopes(credential.scope).length > 0) {
    throw new PlanetScaleRequestError(
      "PlanetScale authorization is missing required managed-access scopes",
      403,
    );
  }
  const expiresAt = new Date(credential.expiresAt);
  if (
    credential.accessToken
    && credential.refreshToken
    && !Number.isNaN(expiresAt.valueOf())
    && expiresAt.valueOf() > Date.now() + 2 * 60 * 1_000
  ) {
    return credential.accessToken;
  }

  const claimId = crypto.randomUUID();
  if (!await claimPlanetScaleCredentialRefresh({
    authority, integrationId: integration.id, generation: integration.generation,
    claimId, now: new Date(),
  })) {
    throw new PlanetScaleRequestError(
      "PlanetScale authorization refresh requires a current workspace manager or reconnect",
      409,
    );
  }
  if (!await markPlanetScaleCredentialRefreshRemoteStarted({
    integrationId: integration.id,
    generation: integration.generation,
    claimId,
    now: new Date(),
  })) {
    throw new PlanetScaleRequestError(
      "PlanetScale authorization refresh requires reconnect",
      409,
    );
  }
  let refreshed: PlanetScaleToken;
  try {
    refreshed = await refreshPlanetScaleToken(credential.refreshToken, credential.scope);
  } catch (error) {
    await requirePlanetScaleCredentialReconnect({
      integrationId: integration.id, generation: integration.generation, claimId, now: new Date(),
    }).catch(() => undefined);
    throw error;
  }
  if (missingPlanetScaleManagedScopes(refreshed.scope).length > 0) {
    await requirePlanetScaleCredentialReconnect({
      integrationId: integration.id, generation: integration.generation, claimId, now: new Date(),
    }).catch(() => undefined);
    throw new PlanetScaleRequestError(
      "PlanetScale authorization lost required managed-access scopes",
      403,
    );
  }
  const encryptedCredential = sealProviderCredential(integration.id, refreshed);
  const refreshedAt = new Date();
  if (!await finalizePlanetScaleCredentialRefresh({
    authority,
    integrationId: integration.id,
    generation: integration.generation,
    claimId,
    encryptedCredential,
    credentialExpiresAt: new Date(refreshed.expiresAt),
    grantedScope: refreshed.scope,
    now: refreshedAt,
  })) {
    await requirePlanetScaleCredentialReconnect({
      integrationId: integration.id, generation: integration.generation, claimId, now: new Date(),
    }).catch(() => undefined);
    throw new PlanetScaleRequestError(
      "PlanetScale authorization refresh requires reconnect",
      409,
    );
  }
  integration.encryptedCredential = encryptedCredential;
  integration.credentialExpiresAt = new Date(refreshed.expiresAt);
  integration.generation += 1n;
  integration.updatedAt = refreshedAt;
  return refreshed.accessToken;
}

// Cleanup paths never refresh credentials without a live user authority. They
// may use an already-valid token that was decrypted server-side for the exact
// integration, otherwise the durable lease sweeper records a retry.
export function currentPlanetScaleAccessToken(integration: ActiveProviderIntegration): string {
  const credential = openProviderCredential<PlanetScaleToken>(integration.id, integration.encryptedCredential);
  if (missingPlanetScaleManagedScopes(credential.scope).length > 0) {
    throw new PlanetScaleRequestError(
      "PlanetScale authorization is missing required managed-access scopes",
      403,
    );
  }
  const expiresAt = new Date(credential.expiresAt);
  if (!credential.accessToken || Number.isNaN(expiresAt.valueOf()) || expiresAt.valueOf() <= Date.now() + 2 * 60 * 1_000) {
    throw new PlanetScaleRequestError("PlanetScale credential refresh is required", 409);
  }
  return credential.accessToken;
}

export function neonCredential(integration: ActiveProviderIntegration) {
  return parseNeonCredential(openProviderCredential<unknown>(
    integration.id,
    integration.encryptedCredential,
  ));
}

async function verifiedNeonCredentialScope(
  integration: ActiveProviderIntegration,
) {
  if (integration.provider !== "neon") {
    throw new Error("Neon credential requested for another provider");
  }
  const credential = neonCredential(integration);
  const auth = await inspectNeonCredential(credential);
  if (auth.externalAccountId !== integration.externalAccountId) {
    throw new ProviderRequestError(
      "neon",
      "Neon API key identity or project scope changed; reconnect the account",
      409,
    );
  }
  return { credential, auth };
}

export async function verifiedNeonCredential(
  integration: ActiveProviderIntegration,
) {
  const { credential } = await verifiedNeonCredentialScope(integration);
  return credential;
}

export async function verifiedNeonProjectCredential(
  integration: ActiveProviderIntegration,
  projectId: string,
) {
  const { credential, auth } = await verifiedNeonCredentialScope(integration);
  if (!auth.projectIds.includes(projectId)) {
    throw new ProviderRequestError(
      "neon",
      "Neon project is outside this integration scope",
      404,
    );
  }
  return credential;
}

export function gcpCredential(integration: ActiveProviderIntegration) {
  return parseGcpCloudSqlCredential(
    openProviderCredential<GcpCloudSqlCredential>(
      integration.id,
      integration.encryptedCredential,
    ),
  );
}

export function vaultCredential(integration: ActiveProviderIntegration) {
  if (integration.provider !== "vault") {
    throw new Error("Vault credential requested for another provider");
  }
  return parseVaultCredential(openProviderCredential<unknown>(
    integration.id,
    integration.encryptedCredential,
  ));
}

export function requiredOidcToken(value: string | null | undefined) {
  if (!value) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Vercel OIDC is not available for GCP federation",
      503,
    );
  }
  return value;
}

export async function revokeProviderAuthorization(
  integration: ActiveProviderIntegration,
) {
  if (integration.provider === "planetScale") {
    const credential = openProviderCredential<PlanetScaleToken>(
      integration.id,
      integration.encryptedCredential,
    );
    // PlanetScale documents access- and refresh-token revocation separately;
    // revoking only the access token leaves a refresh token usable.
    await revokePlanetScaleAuthorization(credential.accessToken);
    await revokePlanetScaleAuthorization(credential.refreshToken);
    return;
  }
  if (
    integration.provider === "neon"
    || integration.provider === "gcpCloudSql"
    || integration.provider === "vault"
  ) {
    // Neon API keys, GCP trust, and Vault AppRoles are customer-owned and may be
    // shared by another workspace. Disconnect scrubs our encrypted copy without
    // deleting that trust.
    return;
  }
  throw new Error("Managed credential provider is not available");
}

export async function discoverProviderResources(input: {
  integration: ActiveProviderIntegration;
  kind: string;
  selection: Record<string, string>;
  oidcToken?: string | null;
}): Promise<ProviderResourceItem[]> {
  const { integration, kind, selection } = input;
  switch (integration.provider) {
    case "planetScale": {
      // Discovery is read-only by construction. Credential rotation remains in
      // guarded lease issuance; an expiring token asks the caller to retry after
      // that explicit mutation path instead of mutating from a GET.
      const token = currentPlanetScaleAccessToken(integration);
      if (kind === "organizations") return boundedDiscoveryResults(await listPlanetScaleOrganizations(token));
      if (kind === "databases" && isSegment(selection.organization)) {
        return boundedDiscoveryResults(await listPlanetScaleDatabases(token, selection.organization));
      }
      if (
        kind === "branches"
        && isSegment(selection.organization)
        && isSegment(selection.database)
      ) {
        const databases = await listPlanetScaleDatabases(token, selection.organization);
        const database = databases.find((item) => item.value === selection.database);
        if (!database?.kind || (selection.engine && selection.engine !== database.kind)) {
          throw new ProviderRequestError("planetScale", "PlanetScale database is no longer importable", 409);
        }
        return boundedDiscoveryResults((await listPlanetScaleBranches(
          token,
          selection.organization,
          selection.database,
          database.kind,
        )).map((branch) => ({ ...branch, kind: database.kind })));
      }
      break;
    }
    case "neon": {
      const credential = await verifiedNeonCredential(integration);
      if (kind === "projects") return boundedDiscoveryResults(await listNeonProjects(credential));
      if (kind === "branches" && isSegment(selection.project)) {
        return boundedDiscoveryResults(await listNeonBranches(credential, selection.project));
      }
      if (
        kind === "databases"
        && isSegment(selection.project)
        && isSegment(selection.branch)
      ) {
        const inventory = await listNeonBranchInventory(credential, selection.project);
        const branch = inventory.branches.find((item) => item.id === selection.branch);
        if (!branch || !neonBranchQueryable(branch)) {
          throw new ProviderRequestError(
            "neon",
            "Neon branch is starting or resetting. Try again shortly.",
            409,
          );
        }
        return boundedDiscoveryResults(await listNeonDatabases(
          credential,
          selection.project,
          selection.branch,
        )).map((item) => ({
          ...item,
          production: branch.production,
          providerTarget: {
            provider: "neon" as const,
            projectId: branch.projectId,
            branchId: branch.id,
            name: branch.name,
            currentState: branch.currentState,
            pendingState: branch.pendingState,
            default: branch.default,
            protected: branch.protected,
          },
        }));
      }
      break;
    }
    case "gcpCloudSql": {
      const credential = gcpCredential(integration);
      const oidcToken = requiredOidcToken(input.oidcToken);
      if (kind === "projects") return boundedDiscoveryResults(await listGcpProjects(credential));
      if (kind === "instances" && selection.project === credential.projectId) {
        return boundedDiscoveryResults(await listGcpCloudSqlInstances(credential, oidcToken));
      }
      if (
        kind === "databases"
        && selection.project === credential.projectId
        && isSegment(selection.instance)
      ) {
        const instances = await listGcpCloudSqlInstances(credential, oidcToken);
        const instance = instances.find((item) => item.value === selection.instance);
        if (
          !instance
          || instance.ready !== true
          || (
            instance.production !== false
            && instance.production !== true
          )
          || !instance.kind
        ) {
          throw new ProviderRequestError("gcpCloudSql", "Cloud SQL instance is no longer importable", 409);
        }
        if (selection.engine && selection.engine !== instance.kind) {
          throw new ProviderRequestError("gcpCloudSql", "Cloud SQL engine does not match the selected instance", 409);
        }
        return boundedDiscoveryResults(await listGcpCloudSqlDatabases(
          credential,
          oidcToken,
          selection.instance,
          instance.kind,
        )).map((item) => ({ ...item, production: instance.production }));
      }
      break;
    }
    case "vault": {
      const credential = vaultCredential(integration);
      const resource = vaultManagedResource(credential);
      if (kind === "brokers" && Object.keys(selection).length === 0) {
        return boundedDiscoveryResults([{
          id: resource.targetFingerprint,
          name: new URL(credential.address).hostname,
          value: "configured",
          ready: true,
        }]);
      }
      if (
        kind === "targets"
        && selection.broker === "configured"
        && Object.keys(selection).length === 1
      ) {
        return boundedDiscoveryResults([{
          id: resource.targetFingerprint,
          name: `${resource.host}:${resource.port}`,
          value: "configured",
          ready: true,
        }]);
      }
      if (
        kind === "databases"
        && selection.broker === "configured"
        && selection.target === "configured"
        && Object.keys(selection).length === 2
      ) {
        return boundedDiscoveryResults([{
          id: resource.targetFingerprint,
          name: resource.database,
          value: resource.database,
          kind: resource.engine,
          production: credential.target.production,
          ready: true,
        }]);
      }
      break;
    }
    default:
      throw new Error("Managed credential provider is not available");
  }
  throw new ProviderRequestError(
    integration.provider,
    "Invalid provider resource query",
    400,
  );
}
