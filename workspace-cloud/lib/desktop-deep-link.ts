// Stable, token-free browser return target for Desktop device authorization.
export const desktopWorkspaceLoginCallbackUrl =
  "dopedb://auth/device-complete";

// Navigation only. Desktop rechecks current authority independently of this signal.
export const desktopWorkspaceAccessCallbackUrl = "dopedb://workspace/access-complete";

const accessReturnKey = "dopedb:desktop-access-return";
const accessReturnTtl = 30 * 60 * 1_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type DesktopAccessReturnIntent = {
  userId: string;
  workspaceId: string;
  connectionId: string;
  createdAt: number;
  phase: "pending" | "complete" | "opened";
};

// Session-scoped navigation intent, never an authorization receipt or callback URL.
export function readDesktopAccessReturn(
  storage: Pick<Storage, "getItem" | "removeItem">,
  userId: string,
  workspaceId: string,
  now = Date.now(),
): DesktopAccessReturnIntent | null {
  try {
    const value = JSON.parse(storage.getItem(accessReturnKey) ?? "null");
    if (!value) return null;
    if (
      value.userId !== userId || value.workspaceId !== workspaceId
      || !uuid.test(value.connectionId ?? "")
      || !Number.isSafeInteger(value.createdAt) || value.createdAt > now
      || now - value.createdAt > accessReturnTtl
      || !["pending", "complete", "opened"].includes(value.phase)
    ) {
      storage.removeItem(accessReturnKey);
      return null;
    }
    return value as DesktopAccessReturnIntent;
  } catch {
    return null;
  }
}

export function saveDesktopAccessReturn(
  storage: Pick<Storage, "setItem">,
  intent: DesktopAccessReturnIntent,
) {
  try { storage.setItem(accessReturnKey, JSON.stringify(intent)); } catch { /* Manual return remains available. */ }
}

export function completeDesktopAccessReturn(
  intent: DesktopAccessReturnIntent | null,
  connectionId: string,
  now = Date.now(),
): DesktopAccessReturnIntent | null {
  return intent?.connectionId === connectionId && intent.phase === "pending"
    && intent.createdAt <= now && now - intent.createdAt <= accessReturnTtl
    ? { ...intent, phase: "complete" }
    : null;
}
