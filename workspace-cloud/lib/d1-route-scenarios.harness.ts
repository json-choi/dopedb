import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { POST as bindEnvironment } from "../app/api/v1/workspaces/[workspaceId]/knowledge/environments/[environmentId]/connections/route";
import { GET as syncWorkspace } from "../app/api/v1/workspaces/[workspaceId]/sync/route";

export async function verifyD1WorkspaceRoutes(db: D1Database, input: {
  organizationId: string; connectionId: string; sessionId: string;
}) {
  const previousOrigin = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = "https://workspace.dopedb.dev";
  try {
    const token = await db.prepare("SELECT token FROM session WHERE id = ?").bind(input.sessionId).first<string>("token");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const environmentId = await db.prepare("SELECT environment.id FROM knowledge_project_environment environment JOIN knowledge_project project ON project.id = environment.project_id WHERE project.organization_id = ? AND project.deleted_at IS NULL LIMIT 1")
      .bind(input.organizationId).first<string>("id");
    const params = Promise.resolve({ workspaceId: input.organizationId, environmentId: environmentId! });
    const body = { bindingId: randomUUID(), connectionId: input.connectionId, role: "primary", alias: "Fixture" };
    const request = () => new Request("https://workspace.dopedb.dev/api/fixture", { method: "POST", headers, body: JSON.stringify(body) });
    const bound = await bindEnvironment(request(), { params });
    expect(bound.status).toBe(201);
    const boundBody = await bound.json();
    expect(boundBody.binding.id).toBe(body.bindingId);
    expect(boundBody.binding.connectionId).toBe(input.connectionId);
    expect((await bindEnvironment(request(), { params })).status).toBe(200);
    const sync = await syncWorkspace(new Request("https://workspace.dopedb.dev/api/fixture?cursor=0", { headers }),
      { params: Promise.resolve({ workspaceId: input.organizationId }) });
    expect(sync.status).toBe(200);
    const changes = await sync.json();
    expect(changes.nextCursor).toBeGreaterThan(0);
    expect(changes.tombstones.connections).toBe(true);
    await db.prepare("UPDATE workspace_connection SET revocation_pending_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), input.connectionId).run();
    expect((await bindEnvironment(request(), { params })).status).toBe(409);
    await db.prepare("UPDATE workspace_connection SET revocation_pending_at = NULL WHERE id = ?").bind(input.connectionId).run();
  } finally {
    if (previousOrigin === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousOrigin;
  }
}
