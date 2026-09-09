// One approval-gated Neon preparation flow: sealed discovery leaf -> preflight
// -> exact plan approval -> apply/verify -> receipt. No SQL or secret crosses it.
import { sql } from "drizzle-orm";

import { jsonEqual } from "../../../../../../../../lib/d1/json";
import { db } from "../../../../../../../../lib/db";
import { env } from "../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../lib/http";
import {
  activeProviderIntegration,
  discoverProviderResources,
  recordProviderDiscoveryReceipt,
  revalidateProviderDiscoveryAuthority,
  verifiedNeonCredential,
} from "../../../../../../../../lib/provider-integrations";
import {
  openProviderDiscoveryProof,
  sameProviderResourceItem,
} from "../../../../../../../../lib/provider-discovery-proof";
import {
  completeProviderOperationBootstrap,
  neonBranchManagedAccessBoundaryFor,
  type NeonBranchManagedAccessBoundary,
} from "../../../../../../../../lib/provider-operation-store";
import {
  applyNeonBootstrap,
  inspectNeonBootstrap,
  NeonBootstrapRepairRequiredError,
  type NeonEnvironmentClassification,
} from "../../../../../../../../lib/providers/neon-bootstrap";
import {
  neonBranchDatabaseFingerprint,
} from "../../../../../../../../lib/providers/neon";
import { parseNeonResource } from "../../../../../../../../lib/providers/neon-core";
import { providerImportProjection } from "../../../../../../../../lib/providers/import-projection";
import {
  ProviderRequestError,
  type NeonProviderResourceTarget,
} from "../../../../../../../../lib/providers/provider-types";
import {
  openNeonBootstrapPlan,
  sealNeonBootstrapPlan,
} from "../../../../../../../../lib/secret-envelope";
import { workspaceAuditEvent } from "../../../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../../../lib/workspace-authorization";
import { workspaceAuditEventId } from "../../../../../../../../lib/workspace-audit-id";

type RouteContext = {
  params: Promise<{ workspaceId: string; integrationId: string }>;
};

const PLAN_VERSION = 1 as const;
const PLAN_TTL_MS = 10 * 60 * 1_000;
const RECEIPT_TTL_MS = 5 * 60 * 1_000;

type PlanPayload = {
  version: typeof PLAN_VERSION;
  organizationId: string;
  integrationId: string;
  integrationGeneration: string;
  memberId: string;
  userId: string;
  sessionId: string;
  resource: unknown;
  providerTarget: NeonProviderResourceTarget;
  environment: NeonEnvironmentClassification | null;
  planHash: string;
  readyHash: string;
  findingCodes: string[];
  branchOperation: BranchOperationPayload | null;
  issuedAt: number;
  expiresAt: number;
};

const branchStates = ["init", "resetting", "ready", "archived", "unknown"] as const;

function parsedProviderTarget(
  value: unknown,
  resource: { project: string; branch: string },
): NeonProviderResourceTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  const fields = [
    "provider", "projectId", "branchId", "name", "currentState", "pendingState",
    "default", "protected",
  ];
  if (
    Object.keys(target).length !== fields.length
    || fields.some((field) => !Object.hasOwn(target, field))
    || target.provider !== "neon"
    || target.projectId !== resource.project
    || target.branchId !== resource.branch
    || typeof target.name !== "string"
    || target.name.length === 0
    || target.name.length > 256
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(target.name)
    || !branchStates.includes(target.currentState as typeof branchStates[number])
    || (target.pendingState !== null
      && !branchStates.includes(target.pendingState as typeof branchStates[number]))
    || typeof target.default !== "boolean"
    || typeof target.protected !== "boolean"
  ) {
    return null;
  }
  return target as NeonProviderResourceTarget;
}

type BranchOperationPayload = Readonly<{
  operationId: string;
  planHash: string;
  ownershipMarker: string;
  branchId: string;
  databaseFingerprint: string;
  credentialFenceFingerprint: string;
}>;

function branchOperationPayload(
  boundary: NeonBranchManagedAccessBoundary | null,
  databaseFingerprint: string,
): BranchOperationPayload | null {
  if (!boundary) return null;
  if (
    boundary.state !== "succeeded"
    || (boundary.managedAccessState !== "bootstrap_required"
      && boundary.managedAccessState !== "ready")
    || boundary.databaseFingerprint === null
    || boundary.credentialFenceFingerprint === null
    || boundary.databaseFingerprint !== databaseFingerprint
  ) {
    throw new ProviderRequestError(
      "neon",
      "Neon branch managed access needs repair before bootstrap",
      409,
    );
  }
  return {
    operationId: boundary.operationId,
    planHash: boundary.planHash,
    ownershipMarker: boundary.ownershipMarker,
    branchId: boundary.branchId,
    databaseFingerprint: boundary.databaseFingerprint,
    credentialFenceFingerprint: boundary.credentialFenceFingerprint,
  };
}

function parsedBranchOperation(
  value: unknown,
  branchId: string,
): BranchOperationPayload | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const operation = value as Record<string, unknown>;
  const fields = [
    "operationId", "planHash", "ownershipMarker", "branchId",
    "databaseFingerprint", "credentialFenceFingerprint",
  ];
  if (
    Object.keys(operation).length !== fields.length
    || fields.some((field) => !Object.hasOwn(operation, field))
    || typeof operation.operationId !== "string"
    || !isUuid(operation.operationId)
    || typeof operation.planHash !== "string"
    || !/^[0-9a-f]{64}$/.test(operation.planHash)
    || typeof operation.ownershipMarker !== "string"
    || !/^v1\.[A-Za-z0-9_-]{43}$/.test(operation.ownershipMarker)
    || operation.branchId !== branchId
    || typeof operation.databaseFingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(operation.databaseFingerprint)
    || typeof operation.credentialFenceFingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(operation.credentialFenceFingerprint)
  ) {
    return undefined;
  }
  return operation as BranchOperationPayload;
}

function sameBranchOperation(
  expected: BranchOperationPayload,
  current: NeonBranchManagedAccessBoundary | null,
) {
  return current !== null
    && current.state === "succeeded"
    && (current.managedAccessState === "bootstrap_required"
      || current.managedAccessState === "ready")
    && current.operationId === expected.operationId
    && current.planHash === expected.planHash
    && current.ownershipMarker === expected.ownershipMarker
    && current.branchId === expected.branchId
    && current.databaseFingerprint === expected.databaseFingerprint
    && current.credentialFenceFingerprint === expected.credentialFenceFingerprint;
}

function environment(value: unknown): NeonEnvironmentClassification | null | undefined {
  if (value === null || value === "") return null;
  return value === "development" || value === "production" ? value : undefined;
}

async function recordBootstrapAudit(input: {
  kind: string;
  organizationId: string;
  actorUserId: string;
  action: string;
  resourceId: string;
  summary: Record<string, unknown>;
  requestId: string;
}) {
  const id = workspaceAuditEventId(
    `neon-bootstrap:${input.kind}`,
    input.requestId,
  );
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO ${workspaceAuditEvent} AS existing
      ("id", "organization_id", "actor_user_id", "action", "resource_type",
       "resource_id", "redacted_summary", "request_id")
    VALUES (
      ${id}, ${input.organizationId}, ${input.actorUserId}, ${input.action},
      'provider_resource', ${input.resourceId},
      ${JSON.stringify(input.summary)}, ${input.requestId}
    )
    ON CONFLICT ("id") DO UPDATE SET "id" = existing."id"
    WHERE existing."organization_id" = EXCLUDED."organization_id"
      AND existing."actor_user_id" = EXCLUDED."actor_user_id"
      AND existing."action" = EXCLUDED."action"
      AND existing."resource_type" = EXCLUDED."resource_type"
      AND existing."resource_id" = EXCLUDED."resource_id"
      AND ${jsonEqual(sql`existing."redacted_summary"`, sql`EXCLUDED."redacted_summary"`)}
      AND existing."request_id" = EXCLUDED."request_id"
    RETURNING "id"
  `);
  return result.rows.length === 1;
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

function parsePlan(
  integrationId: string,
  token: unknown,
  expected: {
    workspaceId: string;
    generation: bigint;
    memberId: string;
    userId: string;
    sessionId: string;
  },
): PlanPayload | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 64 * 1_024) {
    return null;
  }
  try {
    const plan = openNeonBootstrapPlan<PlanPayload>(integrationId, token);
    const fields = [
      "version", "organizationId", "integrationId", "integrationGeneration",
      "memberId", "userId", "sessionId", "resource", "providerTarget", "environment", "planHash",
      "readyHash", "findingCodes", "branchOperation", "issuedAt", "expiresAt",
    ];
    if (
      !plan
      || typeof plan !== "object"
      || Array.isArray(plan)
      || Object.keys(plan).length !== fields.length
      || fields.some((field) => !Object.hasOwn(plan, field))
      || plan.version !== PLAN_VERSION
      || plan.organizationId !== expected.workspaceId
      || plan.integrationId !== integrationId
      || plan.integrationGeneration !== expected.generation.toString()
      || plan.memberId !== expected.memberId
      || plan.userId !== expected.userId
      || plan.sessionId !== expected.sessionId
      || environment(plan.environment) === undefined
      || typeof plan.planHash !== "string"
      || !/^[0-9a-f]{64}$/.test(plan.planHash)
      || typeof plan.readyHash !== "string"
      || !/^[0-9a-f]{64}$/.test(plan.readyHash)
      || !Array.isArray(plan.findingCodes)
      || plan.findingCodes.length === 0
      || plan.findingCodes.length > 64
      || !plan.findingCodes.every(
        (code) => typeof code === "string" && /^NEON_[A-Z0-9_]{1,96}$/.test(code),
      )
      || !Number.isSafeInteger(plan.issuedAt)
      || !Number.isSafeInteger(plan.expiresAt)
      || plan.issuedAt > Date.now() + 30_000
      || plan.expiresAt <= Date.now()
      || plan.expiresAt <= plan.issuedAt
      || plan.expiresAt - plan.issuedAt > PLAN_TTL_MS
    ) {
      return null;
    }
    const resource = parseNeonResource(plan.resource);
    const providerTarget = parsedProviderTarget(plan.providerTarget, resource);
    const operation = parsedBranchOperation(plan.branchOperation, resource.branch);
    return operation === undefined || providerTarget === null
      ? null
      : { ...plan, providerTarget, branchOperation: operation };
  } catch {
    return null;
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
  if (authorization.role !== "admin" && authorization.role !== "owner") {
    return jsonError("Workspace access denied", 403);
  }
  const integration = await activeProviderIntegration(workspaceId, integrationId);
  if (!integration || integration.provider !== "neon") {
    return jsonError("Neon integration not found", 404);
  }
  const parsed = await boundedJsonBody(request, 64 * 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large"
        ? "Neon bootstrap request is too large"
        : "Invalid Neon bootstrap request",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || (body.action !== "preflight" && body.action !== "apply")) {
    return jsonError("Invalid Neon bootstrap request", 400);
  }
  const authority = authorityFor(
    workspaceId,
    integrationId,
    integration,
    authorization,
  );
  let repairContext: null | {
    idempotencyKey: string;
    planHash: string;
    findingCodes: string[];
    publicAclApproved: boolean;
    productionApproved: boolean;
  } = null;

  try {
    if (body.action === "preflight") {
      if (
        Object.keys(body).some((key) => !["action", "selectionProof", "environment"].includes(key))
        || typeof body.selectionProof !== "string"
        || body.selectionProof.length === 0
        || body.selectionProof.length > 16 * 1_024
      ) {
        return jsonError("Invalid Neon bootstrap selection", 400);
      }
      const selectedEnvironment = environment(body.environment);
      if (selectedEnvironment === undefined) {
        return jsonError("Invalid Neon environment classification", 400);
      }
      const proof = openProviderDiscoveryProof({
        organizationId: workspaceId,
        integrationId,
        proof: body.selectionProof,
      });
      if (
        !proof
        || proof.provider !== "neon"
        || proof.kind !== "databases"
        || proof.integrationGeneration !== integration.generation
        || proof.memberId !== authorization.membership.id
        || proof.userId !== authorization.session.user.id
        || proof.sessionId !== authorization.session.session.id
      ) {
        return jsonError("Neon selection proof expired or changed", 409);
      }
      const resources = await discoverProviderResources({
        integration,
        kind: proof.kind,
        selection: proof.selection,
      });
      const matching = resources.filter((item) => sameProviderResourceItem(item, proof.item));
      if (matching.length !== 1) {
        return jsonError("Neon database is no longer selectable", 409);
      }
      const resource = parseNeonResource({
        project: proof.selection.project,
        branch: proof.selection.branch,
        databaseId: matching[0].id,
        database: matching[0].value,
        engine: "postgres",
      });
      const providerTarget = matching[0].providerTarget;
      if (!providerTarget || !parsedProviderTarget(providerTarget, resource)) {
        return jsonError("Neon branch identity is no longer selectable", 409);
      }
      const branchOperation = branchOperationPayload(
        await neonBranchManagedAccessBoundaryFor({
          organizationId: workspaceId,
          integrationId,
          integrationGeneration: integration.generation,
          projectId: resource.project,
          branchId: resource.branch,
        }),
        neonBranchDatabaseFingerprint(resources),
      );
      const credential = await verifiedNeonCredential(integration);
      const inspection = await inspectNeonBootstrap({
        credential,
        resource,
        environment: selectedEnvironment,
      });
      if (!await revalidateProviderDiscoveryAuthority(authority)) {
        return jsonError("Workspace access denied", 403);
      }
      const issuedAt = Date.now();
      const payload: PlanPayload = {
        version: PLAN_VERSION,
        organizationId: workspaceId,
        integrationId,
        integrationGeneration: integration.generation.toString(),
        memberId: authorization.membership.id,
        userId: authorization.session.user.id,
        sessionId: authorization.session.session.id,
        resource: inspection.resource,
        providerTarget,
        environment: selectedEnvironment,
        planHash: inspection.report.planHash,
        readyHash: inspection.readyHash,
        findingCodes: inspection.report.findings.map((item) => item.code),
        branchOperation,
        issuedAt,
        expiresAt: issuedAt + PLAN_TTL_MS,
      };
      return privateJson({
        report: inspection.report,
        plan: sealNeonBootstrapPlan(integrationId, payload),
        planExpiresAt: new Date(payload.expiresAt).toISOString(),
      });
    }

    const fields = [
      "action", "plan", "idempotencyKey", "publicAclApproved", "productionApproved",
    ];
    if (
      Object.keys(body).length !== fields.length
      || fields.some((field) => !Object.hasOwn(body, field))
      || typeof body.idempotencyKey !== "string"
      || !isUuid(body.idempotencyKey)
      || typeof body.publicAclApproved !== "boolean"
      || typeof body.productionApproved !== "boolean"
    ) {
      return jsonError("Invalid Neon bootstrap approval", 400);
    }
    const plan = parsePlan(integrationId, body.plan, {
      workspaceId,
      generation: integration.generation,
      memberId: authorization.membership.id,
      userId: authorization.session.user.id,
      sessionId: authorization.session.session.id,
    });
    if (!plan) return jsonError("Neon bootstrap plan expired or changed", 409);
    repairContext = {
      idempotencyKey: body.idempotencyKey,
      planHash: plan.planHash,
      findingCodes: plan.findingCodes,
      publicAclApproved: body.publicAclApproved,
      productionApproved: body.productionApproved,
    };
    const plannedResource = parseNeonResource(plan.resource);
    if (plan.branchOperation) {
      const current = await neonBranchManagedAccessBoundaryFor({
        organizationId: workspaceId,
        integrationId,
        integrationGeneration: integration.generation,
        projectId: plannedResource.project,
        branchId: plannedResource.branch,
      });
      if (!sameBranchOperation(plan.branchOperation, current)) {
        return jsonError("Neon branch bootstrap authority changed", 409);
      }
    }
    const credential = await verifiedNeonCredential(integration);
    const applied = await applyNeonBootstrap({
      credential,
      resource: plannedResource,
      environment: plan.environment,
      expectedPlanHash: plan.planHash,
      expectedReadyHash: plan.readyHash,
      publicAclApproved: body.publicAclApproved,
      productionApproved: body.productionApproved,
    });
    if (plan.branchOperation) {
      const databases = await discoverProviderResources({
        integration,
        kind: "databases",
        selection: {
          project: applied.resource.project,
          branch: applied.resource.branch,
        },
      });
      if (
        neonBranchDatabaseFingerprint(databases)
          !== plan.branchOperation.databaseFingerprint
      ) {
        return jsonError("Neon branch database inventory changed during bootstrap", 409);
      }
    }
    if (!await revalidateProviderDiscoveryAuthority(authority)) {
      return jsonError("Workspace access denied", 403);
    }
    const projection = providerImportProjection("neon", applied.resource, {
      production: applied.report.production,
      writeAvailable: true,
      neonBranchTarget: plan.providerTarget,
    });
    let branchOperation = null;
    if (plan.branchOperation) {
      branchOperation = await completeProviderOperationBootstrap({
        authority: {
          organizationId: workspaceId,
          membershipId: authorization.membership.id,
          userId: authorization.session.user.id,
          sessionId: authorization.session.session.id,
          role: authorization.role,
        },
        integrationId,
        integrationGeneration: integration.generation,
        operationId: plan.branchOperation.operationId,
        kind: "neon.branch.create",
        planHash: plan.branchOperation.planHash,
        ownershipMarker: plan.branchOperation.ownershipMarker,
        projectId: applied.resource.project,
        branchId: applied.resource.branch,
        databaseFingerprint: plan.branchOperation.databaseFingerprint,
        credentialFenceFingerprint: plan.branchOperation.credentialFenceFingerprint,
        providerAuditId: applied.providerAuditId,
        resourceFingerprint: projection.fingerprint,
        bootstrapPlanHash: plan.planHash,
        now: new Date(),
      });
      if (!branchOperation) {
        return jsonError("Neon branch bootstrap authority changed", 409);
      }
    }
    const receiptId = crypto.randomUUID();
    const receiptExpiresAt = new Date(Date.now() + RECEIPT_TTL_MS);
    const receipt = await recordProviderDiscoveryReceipt({
      organizationId: workspaceId,
      integrationId,
      memberId: authorization.membership.id,
      userId: authorization.session.user.id,
      sessionId: authorization.session.session.id,
      role: authorization.role,
      provider: "neon",
      integrationGeneration: integration.generation,
      receiptId,
      expiresAt: receiptExpiresAt,
      projection,
    });
    if (!receipt) return jsonError("Workspace access denied", 403);
    const redactedSummary = {
      provider: "neon",
      providerAuditId: applied.providerAuditId,
      planHash: plan.planHash,
      production: applied.report.production,
      writeAvailable: true,
      productionApproved: body.productionApproved,
      publicAclApproved: body.publicAclApproved,
      findingCodes: plan.findingCodes,
      ...(branchOperation ? {
        operationId: branchOperation.operationId,
        managedAccessState: branchOperation.managedAccessState,
      } : {}),
    };
    const audited = await recordBootstrapAudit({
      kind: "success",
      organizationId: workspaceId,
      actorUserId: authorization.session.user.id,
      action: "provider.neon.bootstrap",
      resourceId: projection.fingerprint,
      summary: redactedSummary,
      requestId: body.idempotencyKey,
    });
    if (!audited) {
      return jsonError("Neon bootstrap idempotency key conflicts", 409);
    }
    return privateJson({
      report: applied.report,
      receipt: receipt.id,
      receiptExpiresAt: receipt.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof NeonBootstrapRepairRequiredError && repairContext) {
      const repairSummary = {
        provider: "neon",
        providerAuditId: error.providerAuditId,
        planHash: repairContext.planHash,
        productionApproved: repairContext.productionApproved,
        publicAclApproved: repairContext.publicAclApproved,
        findingCodes: repairContext.findingCodes,
        repairCode: error.repairCode,
        temporaryRole: error.temporaryRole,
        temporaryObject: error.temporaryObject,
      };
      await recordBootstrapAudit({
        kind: `repair:${error.repairCode}:${error.temporaryRole ?? "policy"}:${
          error.temporaryObject ?? "object"
        }`,
        organizationId: workspaceId,
        actorUserId: authorization.session.user.id,
        action: "provider.neon.bootstrap_needs_repair",
        resourceId: error.providerAuditId,
        summary: repairSummary,
        requestId: repairContext.idempotencyKey,
      }).catch(() => false);
      return jsonError(
        "Neon bootstrap needs manual repair. Review the workspace audit before retrying.",
        503,
      );
    }
    if (error instanceof ProviderRequestError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Neon bootstrap failed", 502);
  }
}
