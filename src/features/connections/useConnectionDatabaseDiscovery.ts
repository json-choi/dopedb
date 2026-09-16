// Owns the connection editor's database lookup: the three outcomes a user has to
// be able to tell apart, and the request identity that stops a late answer from
// replacing a newer one.
import { useEffect, useRef, useState } from "react";

import type { I18nKey } from "../../lib/i18n";
import type { ConnectionProfile } from "./domain";
import { discoverConnectionProfileDatabases } from "./tauriAdapter";

export type ConnectionDatabaseDiscoveryState =
  | "idle"
  | "pending"
  | "loaded"
  | "failed";

export function useConnectionDatabaseDiscovery({
  profile,
  password,
  enabled,
}: {
  profile: ConnectionProfile;
  password: string;
  enabled: boolean;
}) {
  const [discovery, setDiscovery] = useState<{
    state: ConnectionDatabaseDiscoveryState;
    databases: string[];
  }>({ state: "idle", databases: [] });
  const mounted = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function discover() {
    if (!enabled || discovery.state === "pending") return;
    setDiscovery((current) => ({
      state: "pending",
      databases: current.databases,
    }));
    // Which databases a server has does not depend on the name typed in the
    // field, so this lookup keeps its own identity rather than following the
    // editor's check revision, which a keystroke in that field would bump.
    request.current += 1;
    const issued = request.current;
    const owns = () => mounted.current && request.current === issued;
    try {
      const discovered = await discoverConnectionProfileDatabases(
        profile,
        password || undefined,
      );
      if (!owns()) return;
      setDiscovery({
        state: "loaded",
        databases: discovered.map((database) => database.name),
      });
    } catch {
      if (!owns()) return;
      setDiscovery({ state: "failed", databases: [] });
    }
  }

  return { ...discovery, discover };
}

/**
 * The sentence shown under the database field, or `null` when there is nothing to
 * report yet. An empty suggestion list on its own cannot say whether the lookup is
 * still running, returned nothing, or failed.
 */
export function connectionDatabaseDiscoveryStatusKey(discovery: {
  state: ConnectionDatabaseDiscoveryState;
  databases: readonly string[];
}): I18nKey | null {
  if (discovery.state === "pending") {
    return "connections.databaseDiscoveryPending";
  }
  if (discovery.state === "failed") {
    return "connections.databaseDiscoveryFailed";
  }
  return discovery.state === "loaded" && discovery.databases.length === 0
    ? "connections.databaseDiscoveryEmpty"
    : null;
}
