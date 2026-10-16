// Keeps unapplied Safety edits per connection for the life of the app window, so
// leaving the screen (switching connection, section, or closing Settings) never
// discards them silently. Only the screen writes here; Apply or Discard clears it.
import type { SafetySettings } from "../../ipc/types";

export type SafetyDraftValues = Readonly<{
  settings: SafetySettings;
  /** Raw text of numeric fields, validated on blur and on Apply. */
  numbers: Readonly<Record<"maxRows" | "execPreviewRowLimit", string>>;
}>;

const drafts = new Map<string, SafetyDraftValues>();

export function rememberSafetyDraft(
  connectionId: string,
  draft: SafetyDraftValues | null,
) {
  if (draft) drafts.set(connectionId, draft);
  else drafts.delete(connectionId);
}

export function restoreSafetyDraft(connectionId: string): SafetyDraftValues | null {
  return drafts.get(connectionId) ?? null;
}
