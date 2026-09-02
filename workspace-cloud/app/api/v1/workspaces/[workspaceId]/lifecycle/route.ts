// Reversible Owner deletion scheduling. Every destructive request is exact-name
// confirmed and idempotent; the cron-owned hard purge is never exposed here.
import { env } from "../../../../../../lib/env";
import {
  boundedJsonBody,
  isSafeDisplayText,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../lib/http";
import {
  cancelWorkspaceDeletion,
  scheduleWorkspaceDeletion,
  workspaceLifecycleStatus,
} from "../../../../../../lib/workspace-lifecycle";
import { authorizeWorkspaceLifecycle } from "../../../../../../lib/workspace-authorization";
import { kickWorkspaceBackgroundTask } from "../../../../../../lib/workspace-background-scheduler";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspaceLifecycle(request, workspaceId);
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const status = await workspaceLifecycleStatus(workspaceId);
  return status ? privateJson(status) : jsonError("Workspace not found", 404);
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const parsed = await boundedJsonBody(request, 512);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large"
        ? "Workspace lifecycle request is too large"
        : "Invalid workspace lifecycle request",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  let body: Record<string, unknown>;
  try {
    const value = parsed.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return jsonError("Workspace lifecycle request must be an object", 400);
    }
    body = value as Record<string, unknown>;
  } catch {
    return jsonError("Workspace lifecycle request must be valid JSON", 400);
  }
  const action = body.action;
  const requestId = body.requestId;
  if (
    (action !== "schedule_deletion" && action !== "cancel_deletion")
    || typeof requestId !== "string"
    || !isUuid(requestId)
  ) return jsonError("Invalid workspace lifecycle action", 400);
  const allowedKeys = action === "schedule_deletion"
    ? ["action", "confirmation", "requestId"]
    : ["action", "requestId"];
  if (
    Object.keys(body).length !== allowedKeys.length
    || Object.keys(body).some((key) => !allowedKeys.includes(key))
  ) return jsonError("Unknown workspace lifecycle field", 400);
  if (
    action === "schedule_deletion"
    && (typeof body.confirmation !== "string"
      || !isSafeDisplayText(body.confirmation, 120))
  ) return jsonError("Exact workspace name confirmation is required", 400);

  const authorization = await authorizeWorkspaceLifecycle(request, workspaceId);
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = {
    sessionId: authorization.session.session.id,
    userId: authorization.session.user.id,
    membershipId: authorization.membership.id,
  };
  const result = action === "schedule_deletion"
    ? await scheduleWorkspaceDeletion({
        organizationId: workspaceId,
        authority,
        requestId,
        confirmation: body.confirmation as string,
      })
    : await cancelWorkspaceDeletion({
        organizationId: workspaceId,
        authority,
        requestId,
      });
  const status = await workspaceLifecycleStatus(workspaceId);
  if (!result) {
    return privateJson({
      error: action === "schedule_deletion"
        ? "Workspace deletion prerequisites changed or confirmation did not match"
        : "Workspace deletion can no longer be cancelled",
      status,
    }, { status: 409 });
  }
  if (action === "schedule_deletion" && status?.purgeAfter) {
    const scheduled = await kickWorkspaceBackgroundTask({
      task: "maintenance",
      notBefore: new Date(status.purgeAfter),
    });
    if (env.workspaceBackgroundSchedulerEnabled() && !scheduled) {
      return privateJson({
        error: "Workspace deletion was recorded, but retention cleanup could not be scheduled. Retry this request.",
        result,
        status,
      }, { status: 503 });
    }
  }
  return privateJson({ result, status });
}
