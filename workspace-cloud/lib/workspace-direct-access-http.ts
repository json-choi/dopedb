// HTTP boundary helpers shared by the direct shared database routes: request budgets,
// the administrator-device authorization (manage grant + admin role + live provisioned
// connection), the typed `direct_revocation_required` refusal, and the wire projections
// that are validated through the same strict parsers the clients use.
import "server-only";
import { jsonError, privateJson } from "./http";
import { consumeRateLimit } from "./rate-limit";
import {
  parseDirectProvisioningStatus,
  parseDirectRevocationEntry,
  parseDirectWorkList,
  type DirectProvisioningStatus,
  type DirectRevocationEntry,
  type DirectWorkList,
  type DirectWorkListItem,
} from "./control-plane-contracts";
import { DIRECT_REVOCATION_REQUIRED } from "./workspace-direct-access-core";
import {
  listDirectWorkItems,
  listPendingDirectRevocations,
  loadDirectEndpoint,
  type DirectBlocker,
  type DirectRevocationItem,
  type DirectWorkItem,
} from "./workspace-direct-access-store";
import { authorizeWorkspaceConnection } from "./workspace-authorization";
import { publicDirectProvisioning, type DirectConnectionView } from "./workspace-connections";
import type { MemberAuthority } from "./d1/member-authority";

/** 429 response when the per-route budget is exhausted, otherwise null. */
export async function directRateLimited(namespace: string, discriminator: string, limit: number) {
  return await consumeRateLimit({ namespace, discriminator, limit })
    ? null
    : jsonError("Too many direct database requests. Retry shortly.", 429);
}

/** The refusal every lowering path returns until the affected principals are lowered. */
export function directRevocationRequired(blockers: readonly DirectBlocker[]) {
  return privateJson({
    error: "Lower the affected database principals before this access change",
    code: DIRECT_REVOCATION_REQUIRED,
    blockers: blockers.map(({ connectionId, memberId }) => ({ connectionId, memberId })),
  }, { status: 409 });
}

/**
 * Administrator-device authority over one live provisioned connection. The manage grant
 * is checked by the existing connection authorization; the workspace role must be
 * admin or owner, as for every other connection administration route.
 */
export async function authorizeDirectAdmin(request: Request, organizationId: string, connectionId: string) {
  const authorization = await authorizeWorkspaceConnection(request, organizationId, connectionId, "manage");
  if (!authorization.ok) return { ok: false as const, response: jsonError(authorization.error, authorization.status) };
  if (authorization.role !== "admin" && authorization.role !== "owner") {
    return { ok: false as const, response: jsonError("Insufficient workspace permission", 403) };
  }
  const endpoint = await loadDirectEndpoint(organizationId, connectionId);
  if (!endpoint) return { ok: false as const, response: jsonError("Direct database not found", 404) };
  const authority: MemberAuthority = {
    sessionId: authorization.session.session.id,
    userId: authorization.session.user.id,
    membershipId: authorization.membership.id,
    role: authorization.role,
  };
  return { ok: true as const, authorization, endpoint, authority };
}

export function directWorkItemWire(item: DirectWorkItem): DirectWorkListItem {
  return {
    principalId: item.principalId,
    memberId: item.memberId,
    principalName: item.principalName,
    marker: item.marker,
    verifierKind: item.verifierKind,
    verifier: item.verifier,
    verifierVersion: item.verifierVersion,
    appliedVerifierVersion: item.appliedVerifierVersion,
    appliedLevel: item.appliedLevel,
    desiredLevel: item.desiredLevel,
    state: item.state,
    serverRoleOid: item.serverRoleOid,
    claimExpiresAt: item.claimExpiresAt,
    action: item.action,
  };
}

export function directRevocationWire(item: DirectRevocationItem): DirectRevocationEntry {
  return parseDirectRevocationEntry(item);
}

export function directProvisioningWire(view: DirectConnectionView): DirectProvisioningStatus {
  return parseDirectProvisioningStatus(publicDirectProvisioning(view));
}

/** The work list of one connection, validated against the shared contract before it leaves. */
export async function directWorkListWire(
  organizationId: string,
  connectionId: string,
  endpoint: NonNullable<Awaited<ReturnType<typeof loadDirectEndpoint>>>,
): Promise<DirectWorkList> {
  const [items, revocations] = await Promise.all([
    listDirectWorkItems({ organizationId, connectionId }),
    listPendingDirectRevocations({ organizationId, connectionId }),
  ]);
  return parseDirectWorkList({
    connectionId,
    engine: endpoint.engine,
    scope: endpoint.scope,
    scopeRevision: endpoint.scopeRevision,
    writeCeiling: endpoint.writeCeiling,
    serverFingerprint: endpoint.serverFingerprint,
    items: items.map(directWorkItemWire),
    revocations: revocations.map(directRevocationWire),
  });
}
