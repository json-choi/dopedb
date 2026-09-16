// D1 owns one-time approval/code consumption and rechecks the approving session.
// Better Auth remains the sole writer of the resulting Desktop session.
import "server-only";
import { sql } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import { createWorkspaceD1, workspaceD1 } from "./d1/database";
import {
  desktopDigest, desktopPkceChallenge, newDesktopSecret,
  type DesktopAuthorization, type DesktopTokenRequest,
} from "./desktop-authorization";

export async function issueDesktopAuthorizationCode(input: {
  request: DesktopAuthorization; approvalNonce: string; sessionId: string; userId: string; denied?: boolean;
}, binding: D1Database = workspaceD1(), now = new Date()): Promise<string | null> {
  const code = newDesktopSecret();
  const db = createWorkspaceD1(binding);
  const results = await binding.batch([
    // Keep consumed approval proofs until their nonce can no longer be replayed.
    db.statement(sql`DELETE FROM desktop_authorization_code WHERE id IN (
      SELECT id FROM desktop_authorization_code WHERE created_at < ${new Date(now.getTime() - 600_000)}
      ORDER BY created_at LIMIT 32)`),
    db.statement(sql`INSERT INTO desktop_authorization_code
      (id, code_hash, approval_hash, client_id, redirect_uri, code_challenge, user_id, session_id, created_at, expires_at, consumed_at)
      SELECT ${crypto.randomUUID()}, ${desktopDigest(code)}, ${desktopDigest(input.approvalNonce)},
        ${input.request.client_id}, ${input.request.redirect_uri}, ${input.request.code_challenge},
        user_id, id, ${now}, ${new Date(now.getTime() + 120_000)}, ${input.denied ? now : null} FROM session
      WHERE id = ${input.sessionId} AND user_id = ${input.userId} AND expires_at > ${now}
      ON CONFLICT (approval_hash) DO NOTHING RETURNING id`),
  ]);
  return results[1].results.length === 1 ? code : null;
}

export async function consumeDesktopAuthorizationCode(request: DesktopTokenRequest,
  binding: D1Database = workspaceD1(), now = new Date()): Promise<{ userId: string; sessionId: string } | null> {
  const result = await createWorkspaceD1(binding).statement(sql`UPDATE desktop_authorization_code
    SET consumed_at = ${now} WHERE code_hash = ${desktopDigest(request.code)}
      AND client_id = ${request.client_id} AND redirect_uri = ${request.redirect_uri}
      AND code_challenge = ${desktopPkceChallenge(request.code_verifier)}
      AND consumed_at IS NULL AND expires_at > ${now}
      AND EXISTS (SELECT 1 FROM session WHERE session.id = desktop_authorization_code.session_id
        AND session.user_id = desktop_authorization_code.user_id AND session.expires_at > ${now})
    RETURNING user_id AS userId, session_id AS sessionId`).first<{ userId: string; sessionId: string }>();
  return result;
}

export async function desktopApprovalSessionActive(sessionId: string, userId: string,
  binding: D1Database = workspaceD1()): Promise<boolean> {
  return !!await createWorkspaceD1(binding).statement(sql`SELECT id FROM session
    WHERE id = ${sessionId} AND user_id = ${userId} AND expires_at > ${new Date()}`).first();
}
