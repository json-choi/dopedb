// Owns ephemeral database discovery for the exact editable draft revision.
// Credentials stay in the command call; neither query keys nor results retain them.
import { useEffect, useRef, useState } from "react";
import { connectionTestResultIsCurrent } from "./connectionEditorInteraction";
import { discoverConnectionProfileDatabases } from "./tauriAdapter";
import type { ConnectionProfileState } from "./useConnectionProfileState";

type Discovery = {
  revision: number;
  phase: "idle" | "loading" | "ready" | "empty" | "error";
  databases: string[];
};

export function useConnectionDatabaseDiscovery({ form, credentials, verification }: ConnectionProfileState) {
  const [result, setResult] = useState<Discovery>({ revision: -1, phase: "idle", databases: [] });
  const request = useRef({ id: 0, revision: -1, pending: false });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const revision = verification.currentRevision();
  const current = result.revision === revision
    ? result : { phase: "idle" as const, databases: [] };

  async function discover() {
    const startedRevision = verification.currentRevision();
    if (!form.flags.canDiscoverDatabases ||
      (request.current.pending && request.current.revision === startedRevision)) return;
    const requestId = request.current.id + 1;
    request.current = { id: requestId, revision: startedRevision, pending: true };
    setResult({ revision: startedRevision, phase: "loading", databases: [] });
    const isCurrent = () => mounted.current && connectionTestResultIsCurrent(
      startedRevision, verification.currentRevision(), requestId, request.current.id,
    );
    try {
      const databases = (await discoverConnectionProfileDatabases(
        form.value, credentials.password || undefined,
      )).map((database) => database.name);
      if (isCurrent()) setResult({
        revision: startedRevision, phase: databases.length ? "ready" : "empty", databases,
      });
    } catch {
      if (isCurrent()) setResult({ revision: startedRevision, phase: "error", databases: [] });
    } finally {
      if (request.current.id === requestId) request.current.pending = false;
    }
  }

  return { ...current, pending: current.phase === "loading", discover };
}
