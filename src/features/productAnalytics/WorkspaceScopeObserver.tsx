// Effect-only observer with no rendered output. main.tsx mounts it once, outside packaged
// benchmark runs, so the session-scoped capture below has exactly one caller.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { useCatalogScope } from "../../lib/queries";
import { workspaceAuthStateQuery } from "../workspaces/queries";
import {
  captureProductEventOncePerSession,
  useProductAnalyticsSnapshot,
} from "./client";
import { productAnalyticsWorkspaceContext } from "./outcomes";

/**
 * Records one privacy-bounded ready outcome for each usable workspace scope in
 * this app session. The capture client hashes raw identities before it retains
 * any de-duplication key, and StrictMode replays share one in-flight attempt.
 */
export function ProductAnalyticsWorkspaceScopeObserver() {
  const {
    accountScope,
    error,
    key,
    ready,
    workspaceId,
    workspaceKind,
  } = useCatalogScope();
  const auth = useQuery(workspaceAuthStateQuery());
  const analytics = useProductAnalyticsSnapshot();

  useEffect(() => {
    if (
      analytics.availability !== "available" ||
      analytics.consent !== "granted"
    ) {
      return;
    }
    const context = productAnalyticsWorkspaceContext({
      accountScope,
      error,
      key,
      ready,
      workspaceId,
      workspaceKind,
    });
    if (!context) return;
    void captureProductEventOncePerSession({
      name: "workspace_scope_ready",
      properties: {},
      context,
    });
    if (context.workspaceKind === "team") {
      const role = auth.data?.accounts
        .find((account) => account.user.id === context.actorId)
        ?.memberships.find((membership) => (
          membership.workspaceId === context.workspaceId
        ))
        ?.role;
      if (role) {
        void captureProductEventOncePerSession({
          name: "workspace_membership_ready",
          properties: { role },
          context,
        });
      }
    }
  }, [
    analytics.availability,
    analytics.consent,
    auth.data,
    accountScope,
    error,
    key,
    ready,
    workspaceId,
    workspaceKind,
  ]);

  return null;
}
