// Cloudflare-scheduled entrypoint for durable provider-credential cleanup.
// This route intentionally does no unrelated retention work, so one expiring
// lease cannot fan out into every workspace maintenance query.
import { cronRequestAuthorized } from "../../../../../lib/cron-auth";
import { privateJson } from "../../../../../lib/http";
import { cleanupExpiredManagedLeases } from "../../../../../lib/provider-integrations";
import {
  nextCredentialBackgroundRunAt,
  workspaceSchedulerReceipt,
  workspaceSchedulerRequest,
  workspaceSchedulerResponseHeaders,
} from "../../../../../lib/workspace-background-scheduler";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronRequestAuthorized(request) || !workspaceSchedulerRequest(request)) {
    return privateJson({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await cleanupExpiredManagedLeases({ limit: 10 });
  const nextRunAt = await nextCredentialBackgroundRunAt();
  return privateJson(
    {
      ok: result.deferred === 0,
      scheduler: workspaceSchedulerReceipt(nextRunAt),
      ...result,
    },
    {
      status: result.deferred === 0 ? 200 : 503,
      headers: workspaceSchedulerResponseHeaders(),
    },
  );
}
