// Session inventory for the signed-in account. Session tokens never leave the
// server: native clients see only identifiers and revoke a session by its id.
import { and, desc, eq, gt } from "drizzle-orm";
import { authoritativeSession } from "../../../../../lib/authoritative-session";
import { db } from "../../../../../lib/db";
import { jsonError, privateJson } from "../../../../../lib/http";
import { session as authSession } from "../../../../../lib/schema";

const MAX_LISTED_SESSIONS = 100;

/** Desktop PKCE sessions are created outside a browser request and carry no user agent. */
function accountSessionClient(userAgent: string | null): "browser" | "desktop" {
  return userAgent?.includes("Mozilla") ? "browser" : "desktop";
}

export async function GET(request: Request) {
  const current = await authoritativeSession(request);
  if (!current) return jsonError("Unauthorized", 401);
  const rows = await db.select({
    id: authSession.id,
    createdAt: authSession.createdAt,
    updatedAt: authSession.updatedAt,
    expiresAt: authSession.expiresAt,
    ipAddress: authSession.ipAddress,
    userAgent: authSession.userAgent,
  }).from(authSession).where(and(
    eq(authSession.userId, current.user.id),
    gt(authSession.expiresAt, new Date()),
  )).orderBy(desc(authSession.updatedAt)).limit(MAX_LISTED_SESSIONS);
  return privateJson({
    sessions: rows.map((row) => ({
      id: row.id,
      current: row.id === current.session.id,
      client: accountSessionClient(row.userAgent),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      ipAddress: row.ipAddress ? row.ipAddress : null,
    })),
  });
}
