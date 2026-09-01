"use client";

// Resolves a browser-only repair intent against the server-projected managed
// connection inventory before the GCP setup controller may act on it.
import { useCallback, useEffect, useState } from "react";

import type { ManagedConnection } from "./domain";
import {
  clearManagedConnectionRecoveryIntent,
  readManagedConnectionRecoveryIntent,
  resolveGcpManagedConnectionRecoveryTarget,
  type ManagedConnectionRecoveryIntent,
} from "./managedConnectionRecovery";

export function useGcpRecoveryState(input: {
  workspaceId: string;
  gcpSetupId: string | null;
  managedConnections: ManagedConnection[];
}) {
  const [intent, setIntent] = useState<ManagedConnectionRecoveryIntent | null>(null);
  const [intentLoaded, setIntentLoaded] = useState(!input.gcpSetupId);
  const [inventorySettled, setInventorySettled] = useState(false);
  const target = resolveGcpManagedConnectionRecoveryTarget(
    intent,
    input.managedConnections,
  );

  useEffect(() => {
    if (!input.gcpSetupId) {
      setIntent(null);
      setIntentLoaded(true);
      return;
    }
    setIntentLoaded(false);
    setIntent(readManagedConnectionRecoveryIntent(
      window.sessionStorage,
      input.workspaceId,
    ));
    setIntentLoaded(true);
  }, [input.gcpSetupId, input.workspaceId]);

  const clear = useCallback(() => {
    clearManagedConnectionRecoveryIntent(
      window.sessionStorage,
      input.workspaceId,
    );
    setIntent(null);
  }, [input.workspaceId]);
  const beginInventoryLoad = useCallback(() => setInventorySettled(false), []);
  const finishInventoryLoad = useCallback(() => setInventorySettled(true), []);
  const pending = Boolean(
    input.gcpSetupId
    && (!intentLoaded || (intent && !inventorySettled)),
  );
  const targetMissing = Boolean(
    intentLoaded && intent && inventorySettled && !target,
  );

  return {
    intent,
    target,
    pending,
    targetMissing,
    inventorySettled,
    beginInventoryLoad,
    finishInventoryLoad,
    clear,
  };
}
