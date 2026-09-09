import "server-only";

import { sql } from "drizzle-orm";
import { utcNow } from "./d1/schema/values";

import { db } from "./db";
import {
  providerMutationAuthoritySql,
  type ProviderMutationAuthority,
} from "./provider-integrations/authority";
import { verifyProviderOperationOwnershipMarker } from "./provider-operation-marker";
import {
  member,
  session,
  workspaceAuditEvent,
  workspaceConnection,
  workspaceConnectionGrant,
  workspaceCredentialLease,
  workspaceProviderIntegration,
  workspaceProviderOperation,
  workspaceProviderOperationApproval,
  workspaceProviderResource,
  workspaceResourceVersion,
} from "./schema";
import { workspaceAuditEventId } from "./workspace-audit-id";
import { canonicalHash, canonicalJson } from "./workspace-versioning";
import {
  MAX_PROVIDER_RESULTS,
  providerResourceFingerprint,
  type ProviderImportProjection,
} from "./providers/adapter-contract";
import type { NeonBranchCreatePlan } from "./providers/neon-branch-plan";
import type { NeonBranchDeletePlan } from "./providers/neon-branch-delete-plan";
import type { NeonBranchSwitchPlan } from "./providers/neon-branch-switch-plan";
import { NEON_OPERATION_STATUSES } from "./providers/neon-branch-mutation";
import { ProviderRequestError } from "./providers/provider-types";

import { isProviderOperationKind, type ProviderOperationKind } from "./provider-operation-records";

export type ProviderOperationExecutionIdentity = {
  authority: ProviderMutationAuthority;
  integrationId: string;
  integrationGeneration: bigint;
  operationId: string;
  kind: ProviderOperationKind;
  planHash: string;
  ownershipMarker: string;
};

export function assertExecutionIdentity(input: ProviderOperationExecutionIdentity) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.integrationId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.operationId)
    || !/^[0-9a-f]{64}$/.test(input.planHash)
    || !isProviderOperationKind(input.kind)
    || input.integrationGeneration < 1n
    || !verifyProviderOperationOwnershipMarker({
      organizationId: input.authority.organizationId,
      integrationId: input.integrationId,
      integrationGeneration: input.integrationGeneration,
      operationId: input.operationId,
      planHash: input.planHash,
      marker: input.ownershipMarker,
    })
  ) {
    throw new Error("Invalid provider operation execution identity");
  }
}

export function currentExecutionAuthoritySql(input: ProviderOperationExecutionIdentity) {
  const actor = providerMutationAuthoritySql({
    ...input.authority,
    requireManager: true,
    integration: {
      id: input.integrationId,
      provider: "neon",
      generation: input.integrationGeneration,
      claimId: null,
    },
  });
  return sql`${actor} AND EXISTS (
    SELECT 1
    FROM ${workspaceProviderOperationApproval} AS operation_approval
    JOIN ${session} AS requester_session
      ON requester_session."id" = operation."requested_by_session_id"
     AND requester_session."user_id" = operation."requested_by_user_id"
     AND requester_session."expires_at" > ${utcNow}
    JOIN ${member} AS requester_member
      ON requester_member."id" = operation."requested_by_member_id"
     AND requester_member."organization_id" = operation."organization_id"
     AND requester_member."user_id" = operation."requested_by_user_id"
     AND requester_member."role" = operation."requested_by_role"
     AND requester_member."role" IN ('admin', 'owner')
     AND requester_member."revocation_pending_at" IS NULL
     AND requester_member."revocation_claim_id" IS NULL
    JOIN ${session} AS approver_session
      ON approver_session."id" = operation_approval."actor_session_id"
     AND approver_session."user_id" = operation_approval."actor_user_id"
     AND approver_session."expires_at" > ${utcNow}
    JOIN ${member} AS approver_member
      ON approver_member."id" = operation_approval."actor_member_id"
     AND approver_member."organization_id" = operation_approval."organization_id"
     AND approver_member."user_id" = operation_approval."actor_user_id"
     AND approver_member."role" = operation_approval."actor_role"
     AND approver_member."role" IN ('admin', 'owner')
     AND approver_member."revocation_pending_at" IS NULL
     AND approver_member."revocation_claim_id" IS NULL
    WHERE operation_approval."organization_id" = operation."organization_id"
      AND operation_approval."operation_id" = operation."id"
      AND operation_approval."plan_hash" = operation."plan_hash"
      AND operation_approval."decision" = 'approved'
      AND (
        operation."approval_policy" <> 'separate_admin'
        OR (
          operation_approval."actor_member_id" <> operation."requested_by_member_id"
          AND operation_approval."actor_user_id" <> operation."requested_by_user_id"
        )
      )
  )`;
}
