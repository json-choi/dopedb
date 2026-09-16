// Server-side verification for opaque settings deep-link resources. Every read
// intersects the exact Workspace, account, lifecycle, and member boundary.
import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db";
import { inD1Strings } from "./d1/json";
import {
  providerSetupSession,
  workspaceConnection,
  workspaceConnectionGrant,
  workspaceProviderIntegration,
} from "./schema";

export type RequestedSettingsResourceEvidence = Readonly<{
  connection: Readonly<{
    id: string;
    providerIntegrationId: string | null;
  }> | null;
  integrationId: string | null;
  setupId: string | null;
}>;

export const emptyRequestedSettingsResourceEvidence: RequestedSettingsResourceEvidence = {
  connection: null,
  integrationId: null,
  setupId: null,
};

export async function loadRequestedSettingsResourceEvidence(input: {
  workspaceId: string;
  membershipId: string;
  userId: string;
  area: "access" | "providers";
  connectionId: string | null;
  integrationId: string | null;
  setupId: string | null;
}): Promise<RequestedSettingsResourceEvidence> {
  const [connection, integration, setup] = await Promise.all([
    input.connectionId
      ? (input.area === "access"
          ? db.select({
              id: workspaceConnection.id,
              providerIntegrationId: workspaceConnection.providerIntegrationId,
            }).from(workspaceConnection).innerJoin(
              workspaceConnectionGrant,
              and(
                eq(workspaceConnectionGrant.organizationId, workspaceConnection.organizationId),
                eq(workspaceConnectionGrant.connectionId, workspaceConnection.id),
              ),
            ).where(and(
              eq(workspaceConnection.id, input.connectionId),
              eq(workspaceConnection.organizationId, input.workspaceId),
              eq(workspaceConnectionGrant.memberId, input.membershipId),
              isNull(workspaceConnection.deletedAt),
              isNull(workspaceConnection.revocationPendingAt),
            )).limit(1)
          : db.select({
              id: workspaceConnection.id,
              providerIntegrationId: workspaceConnection.providerIntegrationId,
            }).from(workspaceConnection).where(and(
              eq(workspaceConnection.id, input.connectionId),
              eq(workspaceConnection.organizationId, input.workspaceId),
              eq(workspaceConnection.credentialMode, "managed"),
              isNull(workspaceConnection.deletedAt),
              isNull(workspaceConnection.revocationPendingAt),
            )).limit(1)
        ).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.integrationId
      ? db.select({ id: workspaceProviderIntegration.id })
        .from(workspaceProviderIntegration)
        .where(and(
          eq(workspaceProviderIntegration.id, input.integrationId),
          eq(workspaceProviderIntegration.organizationId, input.workspaceId),
          inD1Strings(workspaceProviderIntegration.status, ["active", "reconnect_required"]),
          isNull(workspaceProviderIntegration.revokedAt),
        )).limit(1).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.setupId
      ? db.select({ id: providerSetupSession.id })
        .from(providerSetupSession)
        .where(and(
          eq(providerSetupSession.id, input.setupId),
          eq(providerSetupSession.organizationId, input.workspaceId),
          eq(providerSetupSession.userId, input.userId),
          eq(providerSetupSession.provider, "gcpCloudSql"),
          gt(providerSetupSession.expiresAt, new Date()),
          isNull(providerSetupSession.consumedAt),
        )).limit(1).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);
  const connectionIntegration = input.area === "providers"
    && connection?.providerIntegrationId
    ? await db.select({ id: workspaceProviderIntegration.id })
      .from(workspaceProviderIntegration)
      .where(and(
        eq(workspaceProviderIntegration.id, connection.providerIntegrationId),
        eq(workspaceProviderIntegration.organizationId, input.workspaceId),
        inD1Strings(workspaceProviderIntegration.status, ["active", "reconnect_required"]),
        isNull(workspaceProviderIntegration.revokedAt),
      )).limit(1).then((rows) => rows[0] ?? null)
    : null;
  const accessibleConnection = input.area === "providers"
    && connection?.providerIntegrationId !== connectionIntegration?.id
      ? null
      : connection;
  return {
    connection: accessibleConnection,
    integrationId: integration?.id ?? null,
    setupId: setup?.id ?? null,
  };
}
