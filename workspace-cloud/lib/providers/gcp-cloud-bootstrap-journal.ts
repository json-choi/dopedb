import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { isUuid } from "../http";
import { providerSetupSession } from "../schema";
import { sealProviderSetupCredential } from "../secret-envelope";
import type { GcpSetupCredential } from "./gcp-cloud-oauth";
import {
  parseDatabaseBootstrapRecovery,
  type GcpDatabaseBootstrapRecovery,
} from "./gcp-cloud-bootstrap-recovery";
import { ProviderRequestError } from "./provider-types";

type DatabaseBootstrapLease = {
  operationId: string;
  expiresAt: string;
};

export type DatabaseBootstrapState = {
  lease: DatabaseBootstrapLease | null;
  recovery: GcpDatabaseBootstrapRecovery | null;
};

export type GcpSetupSessionSecret = GcpSetupCredential & {
  databaseBootstrap?: unknown;
};

export function parseDatabaseBootstrapState(value: unknown): DatabaseBootstrapState {
  if (value === undefined) return { lease: null, recovery: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL privilege cleanup state is invalid",
      409,
    );
  }
  const stored = value as Record<string, unknown>;
  const recovery = stored.recovery === null || stored.recovery === undefined
    ? null
    : parseDatabaseBootstrapRecovery(stored.recovery);
  const leaseValue = stored.lease;
  const lease = leaseValue === null || leaseValue === undefined
    ? null
    : leaseValue && typeof leaseValue === "object" && !Array.isArray(leaseValue)
      ? leaseValue as Record<string, unknown>
      : null;
  if (
    (stored.recovery !== null && stored.recovery !== undefined && !recovery)
    || (leaseValue !== null && leaseValue !== undefined && !lease)
    || (lease && (
      typeof lease.operationId !== "string"
      || !isUuid(lease.operationId)
      || typeof lease.expiresAt !== "string"
      || !Number.isFinite(Date.parse(lease.expiresAt))
    ))
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL privilege cleanup state is invalid",
      409,
    );
  }
  return {
    lease: lease as DatabaseBootstrapLease | null,
    recovery,
  };
}

export function createDatabaseBootstrapJournal(input: {
  workspaceId: string;
  setupId: string;
  userId: string;
  encryptedCredential: string;
  credential: GcpSetupCredential;
  initialState: DatabaseBootstrapState;
}) {
  let envelope = input.encryptedCredential;
  let state = input.initialState;
  let claimed = false;
  const operationId = crypto.randomUUID();

  const persist = async (next: DatabaseBootstrapState) => {
    const databaseBootstrap = next.lease || next.recovery ? next : undefined;
    const nextEnvelope = sealProviderSetupCredential(input.setupId, {
      accessToken: input.credential.accessToken,
      expiresAt: input.credential.expiresAt,
      email: input.credential.email,
      ...(input.credential.quotaProjectId
        ? { quotaProjectId: input.credential.quotaProjectId }
        : {}),
      ...(databaseBootstrap ? { databaseBootstrap } : {}),
    });
    const rows = await db.update(providerSetupSession).set({
      encryptedCredential: nextEnvelope,
    }).where(and(
      eq(providerSetupSession.id, input.setupId),
      eq(providerSetupSession.organizationId, input.workspaceId),
      eq(providerSetupSession.userId, input.userId),
      eq(providerSetupSession.encryptedCredential, envelope),
      isNull(providerSetupSession.consumedAt),
    )).returning({ id: providerSetupSession.id });
    if (rows.length !== 1) {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Another Cloud SQL setup operation changed this session",
        409,
      );
    }
    envelope = nextEnvelope;
    state = next;
  };

  return {
    get recovery() {
      return state.recovery;
    },
    async claim() {
      if (state.lease && Date.parse(state.lease.expiresAt) > Date.now()) {
        throw new ProviderRequestError(
          "gcpCloudSql",
          "Another Cloud SQL setup operation is still running",
          409,
        );
      }
      await persist({
        lease: {
          operationId,
          expiresAt: new Date(Date.now() + 330_000).toISOString(),
        },
        recovery: state.recovery,
      });
      claimed = true;
    },
    async writeRecovery(recovery: GcpDatabaseBootstrapRecovery | null) {
      if (!claimed || state.lease?.operationId !== operationId) {
        throw new ProviderRequestError(
          "gcpCloudSql",
          "Cloud SQL setup operation lease changed",
          409,
        );
      }
      await persist({ lease: state.lease, recovery });
    },
    async release() {
      if (!claimed || state.lease?.operationId !== operationId) return;
      await persist({ lease: null, recovery: state.recovery });
      claimed = false;
    },
  };
}
