// Inventory and heartbeat registration for member-owned Analysis runners.
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "../../../../../../../lib/db";
import { env } from "../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../lib/http";
import { workspaceAnalysisRunner } from "../../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../../lib/workspace-authorization";
import {
  analysisRunnerCapabilityHeader,
  isAnalysisDesktopBearerRequest,
  parseAnalysisRunnerCapability,
  parseAnalysisRunnerCapabilityVersion,
} from "../../../../../../../lib/workspace-analysis-runner-capability";
import { registerAnalysisRunner } from "../../../../../../../lib/workspace-analysis-runner-store";
import { parseAnalysisRunnerRegistration } from "../../../../../../../lib/workspace-analysis-runs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const runners = await db.select({
    id: workspaceAnalysisRunner.id,
    deviceId: workspaceAnalysisRunner.deviceId,
    displayName: workspaceAnalysisRunner.displayName,
    runnerCapabilityGeneration: workspaceAnalysisRunner.runnerCapabilityGeneration,
    lastSeenAt: workspaceAnalysisRunner.lastSeenAt,
  }).from(workspaceAnalysisRunner).where(and(
    eq(workspaceAnalysisRunner.organizationId, workspaceId),
    eq(workspaceAnalysisRunner.memberId, authorization.membership.id),
    isNull(workspaceAnalysisRunner.revokedAt),
  )).orderBy(desc(workspaceAnalysisRunner.lastSeenAt));
  return privateJson({
    workspaceId,
    runners: runners.map((runner) => ({
      ...runner,
      lastSeenAt: runner.lastSeenAt.toISOString(),
      online: runner.lastSeenAt.getTime() > Date.now() - 120_000,
    })),
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  if (!isAnalysisDesktopBearerRequest(request)) {
    return jsonError("Analysis runner registration requires a Desktop bearer session", 401);
  }
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const body = await boundedJsonBody(request, 8 * 1024);
  if (!body.ok) return jsonError("Invalid Analysis runner request", 400);
  let registration;
  try {
    registration = parseAnalysisRunnerRegistration(body.value);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid Analysis runner", 400);
  }
  const capabilityHeader = request.headers.get(analysisRunnerCapabilityHeader);
  const runnerCapability = parseAnalysisRunnerCapability(request);
  const capabilityVersion = parseAnalysisRunnerCapabilityVersion(request);
  if (capabilityVersion === null) {
    return jsonError(
      "This Desktop version cannot create or update a possession-bound Analysis runner. Update DopeDB and try again.",
      426,
    );
  }
  if (capabilityHeader !== null && runnerCapability === null) {
    return jsonError("Invalid Analysis runner capability", 403);
  }
  const runner = await registerAnalysisRunner({
    organizationId: workspaceId,
    registration,
    runnerCapability,
    capabilityVersion,
    authority: {
      sessionId: authorization.session.session.id,
      userId: authorization.session.user.id,
      membershipId: authorization.membership.id,
      role: authorization.role,
    },
  });
  if (!runner) return jsonError("Analysis runner authority changed", 409);
  if (runner.status === "unsupported") {
    return jsonError(
      "This Desktop version cannot create a possession-bound Analysis runner. Update DopeDB and try again.",
      426,
    );
  }
  if (runner.status === "unbound" || runner.status === "replacement_required") {
    return jsonError(
      "This runner identity cannot be reused. Register again with a new Desktop device id.",
      428,
    );
  }
  if (runner.status === "missing") {
    return jsonError(
      "The Analysis runner capability is unavailable. Register again with a new Desktop device id.",
      428,
    );
  }
  if (runner.status === "invalid") return jsonError("Invalid Analysis runner capability", 403);
  if (!runner.id || !runner.deviceId || !runner.displayName || !runner.lastSeenAt
    || !runner.runnerCapabilityGeneration) {
    return jsonError("Analysis runner authority changed", 409);
  }
  return privateJson({
    runner: {
      id: runner.id,
      deviceId: runner.deviceId,
      displayName: runner.displayName,
      runnerCapabilityGeneration: runner.runnerCapabilityGeneration,
      lastSeenAt: runner.lastSeenAt.toISOString(),
      online: true,
    },
    runnerCapability: runner.runnerCapability,
    runnerCapabilityGeneration: runner.runnerCapabilityGeneration,
  }, { status: runner.status === "created" ? 201 : 200 });
}
