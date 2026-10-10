// Owns the Connection editor's unsaved-change decision: a fingerprint of
// everything a save would persist, compared with the last saved baseline, and the
// confirmation that must come before any action that would discard a dirty draft.
import { useState } from "react";

import { formatConnectionUrl } from "./connectionUrl";
import type { ConnectionProfile } from "./domain";
import { CONNECTION_INPUT_MODE_PARAMETER } from "./options";

/** Everything a save would persist; equal fingerprints mean nothing is unsaved. */
function draftFingerprint(
  profile: ConnectionProfile,
  portDraft: string,
  urlDraft: string | null,
): string {
  return JSON.stringify([
    profile.id,
    profile.name,
    profile.engine,
    profile.provider,
    profile.driverId,
    profile.host,
    portDraft,
    profile.database,
    profile.username,
    profile.sslmode,
    Object.entries(profile.extraParams).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    profile.readonlyDefault,
    profile.env,
    profile.schemaGroup,
    urlDraft,
  ]);
}

function initialUrlDraft(profile: ConnectionProfile): string | null {
  return profile.extraParams[CONNECTION_INPUT_MODE_PARAMETER] === "urlOnly"
    ? formatConnectionUrl(profile)
    : null;
}

export function useConnectionDraftChanges({
  initial,
  form,
  portDraft,
  urlDraft,
  credentialEdited,
}: {
  initial: ConnectionProfile;
  form: ConnectionProfile;
  portDraft: string;
  urlDraft: string | null;
  /** A typed password or a pending removal is unsaved even when the profile is not. */
  credentialEdited: boolean;
}) {
  const [baseline, setBaseline] = useState(() =>
    draftFingerprint(initial, String(initial.port), initialUrlDraft(initial)),
  );
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(
    null,
  );
  const dirty =
    draftFingerprint(form, portDraft, urlDraft) !== baseline ||
    credentialEdited;

  /**
   * Run an action that leaves this draft. Unsaved edits, including a typed
   * password, are discarded only after an explicit confirmation.
   */
  function guardDiscard(action: () => void) {
    if (dirty) setPendingDiscard(() => action);
    else action();
  }

  function confirmDiscard() {
    const action = pendingDiscard;
    setPendingDiscard(null);
    action?.();
  }

  return {
    dirty,
    pendingDiscard: pendingDiscard !== null,
    guardDiscard,
    confirmDiscard,
    keepEditing: () => setPendingDiscard(null),
    /** The saved profile becomes the new baseline for unsaved-change detection. */
    rebase: (saved: ConnectionProfile, savedUrlDraft: string | null) =>
      setBaseline(draftFingerprint(saved, String(saved.port), savedUrlDraft)),
  };
}
