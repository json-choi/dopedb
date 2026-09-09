// Backup retention tombstones are admin-only and scoped by workspace id, preventing
// a known backup UUID from disclosing or deleting another tenant's ciphertext.

import { env } from "../../../../../../../lib/env";
import { isUuid, jsonError, mutationAllowed } from "../../../../../../../lib/http";
import { authorizeWorkspace } from "../../../../../../../lib/workspace-authorization";
import { kickWorkspaceBackgroundTask } from "../../../../../../../lib/workspace-background-scheduler";
import { WORKSPACE_BACKUP_RETENTION_DAYS } from "../../../../../../../lib/workspace-lifecycle";
import { tombstoneWorkspaceBackup } from "../../../../../../../lib/workspace-backup-store";

type RouteContext = { params: Promise<{ workspaceId: string; backupId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, backupId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(backupId)) return jsonError("Invalid workspace or backup id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (authorization.role !== "admin" && authorization.role !== "owner") {
    return jsonError("Workspace access denied", 403);
  }
  const deleted = await tombstoneWorkspaceBackup({ organizationId: workspaceId, backupId,
    authority: { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
      membershipId: authorization.membership.id, role: authorization.role },
    retentionDays: WORKSPACE_BACKUP_RETENTION_DAYS,
  });
  if (!deleted) return jsonError("Backup not found", 404);
  const purgeAfter = new Date(deleted.purgeAfter);
  const scheduled = !Number.isNaN(purgeAfter.valueOf()) && await kickWorkspaceBackgroundTask({
    task: "maintenance",
    notBefore: purgeAfter,
  });
  if (Number.isNaN(purgeAfter.valueOf())
    || (env.workspaceBackgroundSchedulerEnabled() && !scheduled)) {
    return jsonError("Backup deletion was recorded, but retention cleanup could not be scheduled. Retry this request.", 503);
  }
  return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
}
