import { hasWorkspaceConnectionCapability, type WorkspaceConnectionCapability } from "../../lib/workspace-permissions";

/** Lowering a grant drains existing managed credentials through the removal gate. */
export async function changeConnectionGrant(input: {
  workspaceId: string;
  connectionId: string;
  memberId: string;
  previous: WorkspaceConnectionCapability | null;
  next: WorkspaceConnectionCapability | "";
}): Promise<Response | null> {
  const endpoint = `/api/v1/workspaces/${input.workspaceId}/connections/${input.connectionId}/grants`;
  const reducing = input.previous && input.next
    && !hasWorkspaceConnectionCapability(input.next, input.previous);
  try {
    if (!input.next || reducing) {
      const removed = await fetch(`${endpoint}?memberId=${encodeURIComponent(input.memberId)}`, { method: "DELETE" });
      if (!removed.ok || !input.next) return removed;
    }
    return await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: input.memberId, capability: input.next }),
    });
  } catch {
    return null;
  }
}
