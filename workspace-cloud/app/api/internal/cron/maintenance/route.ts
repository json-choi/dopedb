// Event-driven cleanup for durable workspace data with an explicit future due
// time. A null receipt makes this task fully dormant instead of polling Neon.
import { cronRequestAuthorized } from "../../../../../lib/cron-auth";
import { privateJson } from "../../../../../lib/http";
import { cleanupProviderDiscoveryReceipts } from "../../../../../lib/provider-discovery-receipt-store";
import { deliverAnalysisSignalEmailNotifications } from "../../../../../lib/signal-notifications";
import {
  nextMaintenanceBackgroundRunAt,
  workspaceSchedulerReceipt,
  workspaceSchedulerRequest,
  workspaceSchedulerResponseHeaders,
} from "../../../../../lib/workspace-background-scheduler";
import { cleanupExpiredAnalysisResults } from "../../../../../lib/workspace-analysis-retention";
import { cleanupWorkspaceRetention } from "../../../../../lib/workspace-lifecycle";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronRequestAuthorized(request) || !workspaceSchedulerRequest(request)) {
    return privateJson({ error: "Unauthorized" }, { status: 401 });
  }
  const [discoveryReceiptsDeleted, analysisResults, analysisEmails] = await Promise.all([
    cleanupProviderDiscoveryReceipts(),
    cleanupExpiredAnalysisResults(),
    deliverAnalysisSignalEmailNotifications(),
  ]);
  const retention = await cleanupWorkspaceRetention();
  const nextRunAt = await nextMaintenanceBackgroundRunAt();
  return privateJson(
    {
      ok: retention.workspacesDeferred === 0,
      scheduler: workspaceSchedulerReceipt(nextRunAt),
      discoveryReceiptsDeleted,
      analysisResults,
      analysisEmails,
      retention,
    },
    {
      status: retention.workspacesDeferred === 0 ? 200 : 503,
      headers: workspaceSchedulerResponseHeaders(),
    },
  );
}
