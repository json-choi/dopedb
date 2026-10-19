// The one-shot check of an already saved connection, for surfaces that bind a
// credential and need to report whether it works without owning the editor's
// draft: it runs the same saved-connection test as the editor's check and maps a
// failed receipt or a transport error to the same typed issue.
import { connectionTestIssue } from "./connectionTestFailure";
import type { ConnectionId, ConnectionTestIssue } from "./domain";
import { testConnection } from "./tauriAdapter";

export type SavedConnectionCheck =
  | { ok: true }
  | {
      ok: false;
      issue: ConnectionTestIssue;
      /** Whole seconds a `retryLater` refusal asked to wait. */
      retryAfterSeconds?: number;
    };

export async function checkSavedConnection(
  id: ConnectionId,
): Promise<SavedConnectionCheck> {
  try {
    const receipt = await testConnection(id);
    if (receipt.ok) return { ok: true };
    return {
      ok: false,
      issue: connectionTestIssue(receipt.failure),
      retryAfterSeconds: receipt.failure.retryAfterSeconds,
    };
  } catch {
    return { ok: false, issue: { code: "unknown", field: null } };
  }
}
