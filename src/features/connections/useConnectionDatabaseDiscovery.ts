// Owns ephemeral database discovery for the exact endpoint the draft connects to.
// Credentials stay in the command call; neither query keys nor results retain them.
// A draft that moved away from its saved password's endpoint is refused before
// connecting, and the person is offered the password field instead of a list.
import { useEffect, useRef, useState } from "react";
import { errDetails } from "../../ipc/types";
import { connectionTestResultIsCurrent } from "./connectionEditorInteraction";
import { discoverConnectionProfileDatabases } from "./tauriAdapter";
import type { ConnectionProfileState } from "./useConnectionProfileState";

type Discovery = {
  revision: number;
  phase:
    | "idle"
    | "loading"
    | "ready"
    | "empty"
    | "error"
    | "credentialRequired"
    | "credentialStoreDenied";
  databases: string[];
};

export function useConnectionDatabaseDiscovery({ form, credentials, tabs, verification }: ConnectionProfileState) {
  const [result, setResult] = useState<Discovery>({ revision: -1, phase: "idle", databases: [] });
  const request = useRef({ id: 0, revision: -1, pending: false });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Renaming the draft or changing its labels does not change which server it
  // reaches, so only endpoint, credential, or transport edits invalidate a list.
  const revision = verification.endpointRevision();
  const current = result.revision === revision
    ? result : { phase: "idle" as const, databases: [] };

  /**
   * Focus starts discovery once per endpoint revision; a ready or empty list is
   * reused. Only the explicit retry command repeats a finished request.
   */
  async function discover({ force = false }: { force?: boolean } = {}) {
    const startedRevision = verification.endpointRevision();
    if (!form.flags.canDiscoverDatabases ||
      (request.current.pending && request.current.revision === startedRevision)) return;
    if (!force && result.revision === startedRevision && result.phase !== "idle") return;
    const requestId = request.current.id + 1;
    request.current = { id: requestId, revision: startedRevision, pending: true };
    setResult({ revision: startedRevision, phase: "loading", databases: [] });
    const isCurrent = () => mounted.current && connectionTestResultIsCurrent(
      startedRevision, verification.endpointRevision(), requestId, request.current.id,
    );
    try {
      const receipt = await discoverConnectionProfileDatabases(
        credentials.probeProfile(), credentials.password || undefined,
      );
      const databases = receipt.databases.map((database) => database.name);
      if (isCurrent()) setResult({
        revision: startedRevision,
        phase: receipt.refusal === "savedCredentialEndpointChanged" ? "credentialRequired"
          : receipt.refusal ? "error"
            : databases.length ? "ready" : "empty",
        databases,
      });
    } catch (error) {
      // The OS credential store refusing the saved password is its own recovery.
      const phase = errDetails(error).kind === "keychain" ? "credentialStoreDenied" : "error";
      if (isCurrent()) setResult({ revision: startedRevision, phase, databases: [] });
    } finally {
      if (request.current.id === requestId) request.current.pending = false;
    }
  }

  return {
    ...current,
    pending: current.phase === "loading",
    discover,
    /** Typing the password changes the endpoint revision, so the next focus retries. */
    enterPassword: () => tabs.focusField("general", "connection-password"),
  };
}
