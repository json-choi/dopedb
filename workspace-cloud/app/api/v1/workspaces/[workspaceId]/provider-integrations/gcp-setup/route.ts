// Lists the caller's own unconsumed Google Cloud setup authorizations so a native
// client can continue the setup it started in the browser. Only identifiers, the
// Google account label and expiry are returned; the sealed credential never leaves.
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../../../../../../lib/db";
import { isUuid, jsonError, privateJson } from "../../../../../../../lib/http";
import { providerSetupSession } from "../../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../../lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const MAX_LISTED_SETUPS = 10;

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const setups = await db.select({
    id: providerSetupSession.id,
    account: providerSetupSession.accountLabel,
    expiresAt: providerSetupSession.expiresAt,
    createdAt: providerSetupSession.createdAt,
  }).from(providerSetupSession).where(and(
    eq(providerSetupSession.organizationId, workspaceId),
    eq(providerSetupSession.userId, authorization.session.user.id),
    eq(providerSetupSession.provider, "gcpCloudSql"),
    gt(providerSetupSession.expiresAt, new Date()),
    isNull(providerSetupSession.consumedAt),
  )).orderBy(desc(providerSetupSession.createdAt)).limit(MAX_LISTED_SETUPS);
  return privateJson({ setups });
}
