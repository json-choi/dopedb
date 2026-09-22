// Owns the one-shot loopback listener discovery offered on the first-run
// Welcome. Discovery never starts on its own: the caller runs it, and the
// result is a suggestion that only the connection editor can turn into a saved
// profile.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { LocalDatabaseListener } from "./domain";
import { localDatabaseListenersQuery } from "./queries";

export type LocalListenerDiscoveryStatus =
  | "idle"
  | "running"
  | "ready"
  | "failed";

export type LocalListenerDiscovery = {
  status: LocalListenerDiscoveryStatus;
  listeners: readonly LocalDatabaseListener[];
  run: () => void;
};

export function useLocalListenerDiscovery(): LocalListenerDiscovery {
  const [started, setStarted] = useState(false);
  const query = useQuery({
    ...localDatabaseListenersQuery(),
    // Only run() may probe loopback; cache invalidation and reconnects may not.
    enabled: false,
  });

  let status: LocalListenerDiscoveryStatus = "idle";
  if (started) {
    if (query.isError) status = "failed";
    else if (query.data) status = "ready";
    else status = "running";
  }

  return {
    status,
    listeners: started ? query.data ?? [] : [],
    run: () => {
      if (started) return;
      setStarted(true);
      void query.refetch({ cancelRefetch: false });
    },
  };
}
