import { workloadOidcToken } from "../../../../../../../../lib/workload-identity";
// Provider listing is read-only. Only the guarded POST can exchange one opaque,
// server-issued final-leaf proof for one durable, single-use import receipt.
import { env } from "../../../../../../../../lib/env";
import {
  canonicalProviderDiscoverySelection,
  openProviderDiscoveryProof,
  sameProviderResourceItem,
  sealProviderDiscoveryProof,
} from "../../../../../../../../lib/provider-discovery-proof";
import {
  activeProviderIntegration,
  discoveredProviderResource,
  discoverProviderResources,
  gcpCredential,
  recordProviderDiscoveryReceipt,
  revalidateProviderDiscoveryAuthority,
  vaultCredential,
} from "../../../../../../../../lib/provider-integrations";
import { parseNeonResource } from "../../../../../../../../lib/providers/neon-core";
import { ProviderRequestError } from "../../../../../../../../lib/providers/provider-types";
import { vaultManagedResource } from "../../../../../../../../lib/providers/vault";
import {
  neonBranchManagedAccessBoundaryFor,
  requireNeonBranchManagedAccessReady,
} from "../../../../../../../../lib/provider-operation-store";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../lib/http";
import { authorizeWorkspace } from "../../../../../../../../lib/workspace-authorization";

type RouteContext = {
  params: Promise<{ workspaceId: string; integrationId: string }>;
};

const providers = ["planetScale", "neon", "gcpCloudSql", "vault"] as const;
const kinds = [
  "organizations",
  "projects",
  "databases",
  "branches",
  "instances",
  "brokers",
  "targets",
] as const;
const selectionKeys = [
  "organization",
  "project",
  "database",
  "branch",
  "instance",
  "engine",
  "networkMode",
  "broker",
  "target",
] as const;

function providerName(value: string): value is typeof providers[number] {
  return providers.includes(value as typeof providers[number]);
}

function discoveryKind(value: string): value is typeof kinds[number] {
  return kinds.includes(value as typeof kinds[number]);
}

function discoveryQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set<string>(["kind", ...selectionKeys]);
  if (
    [...params.keys()].some((key) => !allowed.has(key))
    || [...allowed].some((key) => params.getAll(key).length > 1)
  ) {
    return null;
  }
  const kind = params.get("kind") ?? "";
  if (!discoveryKind(kind)) return null;
  const selection: Record<string, string> = {};
  for (const key of selectionKeys) {
    const value = params.get(key);
    if (value === null || value === "") continue;
    if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return null;
    selection[key] = value;
  }
  return { kind, selection };
}

function authorityFor(
  workspaceId: string,
  integrationId: string,
  integration: { provider: string; generation: bigint },
  authorization: {
    membership: { id: string };
    session: { user: { id: string }; session: { id: string } };
    role: string;
  },
) {
  return {
    organizationId: workspaceId,
    integrationId,
    provider: integration.provider,
    integrationGeneration: integration.generation,
    memberId: authorization.membership.id,
    userId: authorization.session.user.id,
    sessionId: authorization.session.session.id,
    role: authorization.role,
  };
}

function providerWriteAvailable(
  integration: Parameters<typeof gcpCredential>[0],
) {
  if (integration.provider === "planetScale") {
    return true;
  }
  if (integration.provider === "vault") {
    return vaultCredential(integration).writeRole !== null;
  }
  return integration.provider === "gcpCloudSql"
    && gcpCredential(integration).writeServiceAccountEmail !== null;
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, integrationId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(integrationId)) {
    return jsonError("Invalid workspace or integration id", 400);
  }
  const query = discoveryQuery(request);
  if (!query) return jsonError("Invalid provider resource query", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const integration = await activeProviderIntegration(workspaceId, integrationId);
  if (!integration || !providerName(integration.provider)) {
    return jsonError("Provider integration not found", 404);
  }
  const provider = integration.provider;
  const writeAvailable = providerWriteAvailable(integration);
  const vaultResource = provider === "vault"
    ? vaultManagedResource(vaultCredential(integration))
    : undefined;
  const selection = canonicalProviderDiscoverySelection(
    provider,
    query.kind,
    query.selection,
  );
  if (!selection) return jsonError("Invalid provider resource query", 400);
  const authority = authorityFor(
    workspaceId,
    integrationId,
    integration,
    authorization,
  );
  try {
    const resources = await discoverProviderResources({
      integration,
      kind: query.kind,
      selection,
      oidcToken: await workloadOidcToken(),
    });
    const branchBoundary = provider === "neon"
      && query.kind === "databases"
      && typeof selection.project === "string"
      && typeof selection.branch === "string"
      ? await neonBranchManagedAccessBoundaryFor({
        organizationId: workspaceId,
        integrationId,
        integrationGeneration: integration.generation,
        projectId: selection.project,
        branchId: selection.branch,
      })
      : null;
    if (!await revalidateProviderDiscoveryAuthority(authority)) {
      return jsonError("Workspace access denied", 403);
    }
    return privateJson({
      resources: resources.map((item) => {
        const projection = discoveredProviderResource({
          provider,
          kind: query.kind,
          selection,
          item,
          writeAvailable,
          vaultResource,
        });
        const canBootstrapNeon = provider === "neon"
          && query.kind === "databases"
          && item.ready === true
          && (
            item.production === false
            || item.production === true
            || item.production === "unknown"
          );
        return {
          ...item,
          ...(branchBoundary ? {
            managedAccess: {
              operationId: branchBoundary.operationId,
              state: branchBoundary.state,
              status: branchBoundary.managedAccessState,
            },
          } : {}),
          ...(projection || canBootstrapNeon ? {
            selectionProof: sealProviderDiscoveryProof({
              organizationId: workspaceId,
              integrationId,
              integrationGeneration: integration.generation,
              memberId: authorization.membership.id,
              userId: authorization.session.user.id,
              sessionId: authorization.session.session.id,
              provider,
              kind: query.kind,
              selection,
              item,
            }),
          } : {}),
        };
      }),
    });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Provider resource discovery failed", 502);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) {
    return jsonError("Invalid request origin", 403);
  }
  const { workspaceId, integrationId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(integrationId)) {
    return jsonError("Invalid workspace or integration id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const parsed = await boundedJsonBody(request, 20 * 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large"
        ? "Provider selection proof is too large"
        : "Invalid provider selection proof",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as Record<string, unknown> | null;
  if (
    !body
    || Array.isArray(body)
    || Object.keys(body).length !== 1
    || typeof body.selectionProof !== "string"
    || body.selectionProof.length === 0
    || body.selectionProof.length > 16 * 1_024
  ) {
    return jsonError("Invalid provider selection proof", 400);
  }
  const integration = await activeProviderIntegration(workspaceId, integrationId);
  if (!integration || !providerName(integration.provider)) {
    return jsonError("Provider integration not found", 404);
  }
  const proof = openProviderDiscoveryProof({
    organizationId: workspaceId,
    integrationId,
    proof: body.selectionProof,
  });
  if (
    !proof
    || proof.provider !== integration.provider
    || proof.integrationGeneration !== integration.generation
    || proof.memberId !== authorization.membership.id
    || proof.userId !== authorization.session.user.id
    || proof.sessionId !== authorization.session.session.id
  ) {
    return jsonError("Provider selection proof expired or changed", 409);
  }
  const authority = authorityFor(
    workspaceId,
    integrationId,
    integration,
    authorization,
  );
  const writeAvailable = providerWriteAvailable(integration);
  const vaultResource = integration.provider === "vault"
    ? vaultManagedResource(vaultCredential(integration))
    : undefined;
  try {
    // Never accept a raw external id from the browser. Re-run the exact sealed
    // query, then require the full sealed leaf to still appear unchanged.
    const resources = await discoverProviderResources({
      integration,
      kind: proof.kind,
      selection: proof.selection,
      oidcToken: await workloadOidcToken(),
    });
    if (
      integration.generation !== proof.integrationGeneration
      || !await revalidateProviderDiscoveryAuthority(authority)
    ) {
      return jsonError("Provider selection proof expired or changed", 409);
    }
    const matchingItems = resources.filter((candidate) => (
      sameProviderResourceItem(candidate, proof.item)
    ));
    if (matchingItems.length !== 1) {
      return jsonError("Provider resource is no longer importable", 409);
    }
    const [item] = matchingItems;
    const projection = discoveredProviderResource({
      provider: integration.provider,
      kind: proof.kind,
      selection: proof.selection,
      item,
      writeAvailable,
      vaultResource,
    });
    if (!projection) {
      return jsonError("Provider resource is no longer importable", 409);
    }
    if (integration.provider === "neon") {
      const resource = parseNeonResource(projection.resource);
      await requireNeonBranchManagedAccessReady({
        organizationId: workspaceId,
        integrationId,
        integrationGeneration: integration.generation,
        projectId: resource.project,
        branchId: resource.branch,
      });
    }
    const receipt = await recordProviderDiscoveryReceipt({
      organizationId: workspaceId,
      integrationId,
      memberId: authorization.membership.id,
      userId: authorization.session.user.id,
      sessionId: authorization.session.session.id,
      role: authorization.role,
      provider: integration.provider,
      integrationGeneration: proof.integrationGeneration,
      receiptId: proof.receiptId,
      expiresAt: new Date(proof.expiresAt),
      projection,
    });
    if (!receipt) return jsonError("Workspace access denied", 403);
    return privateJson({
      receipt: receipt.id,
      receiptExpiresAt: receipt.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Provider resource discovery failed", 502);
  }
}
