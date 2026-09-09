import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { atomicD1 } from "@/lib/d1/atomic";
import { utcNow } from "@/lib/d1/schema/values";
import { env } from "@/lib/env";
import { isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import {
  githubInstallationUrl,
  githubKnowledgeConfigured,
} from "@/lib/knowledge/github-app";
import {
  knowledgeMutationAuthority,
  knowledgeMutationAuthoritySql,
} from "@/lib/knowledge/mutation-authority";
import { authorizeWorkspace } from "@/lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  if (!githubKnowledgeConfigured()) {
    return jsonError("GitHub Project Knowledge is not configured", 503);
  }
  const state = randomBytes(32).toString("base64url");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const setupResult = await atomicD1({
    scope: sql`SELECT '{}' AS payload WHERE ${knowledgeMutationAuthoritySql(authority, workspaceId)}`,
    statements: (scope) => [
      sql`DELETE FROM knowledge_github_setup_state WHERE state_hash IN (
          SELECT state_hash FROM knowledge_github_setup_state WHERE expires_at < ${utcNow} ORDER BY expires_at LIMIT 100)
        AND EXISTS (${scope})`,
      sql`INSERT INTO knowledge_github_setup_state (state_hash, organization_id, user_id, expires_at)
        SELECT ${stateHash}, ${workspaceId}, ${authorization.session.user.id},
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+10 minutes') FROM (${scope}) RETURNING state_hash`,
    ],
  });
  if (setupResult.rows[1].length !== 1) return jsonError("Workspace access changed", 409);
  return privateJson({ authorizationUrl: githubInstallationUrl(state) });
}
