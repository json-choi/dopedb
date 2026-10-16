// Owns one browser authorization at a time for the OAuth providers. Rust opens the
// control plane's start page; this hook then waits for the window to regain focus
// or for the token-free return link, and re-reads the accounts (PlanetScale) or the
// caller's unconsumed Google Cloud setups. OAuth approval alone never counts as a
// saved account: success is a changed account list or a setup to continue here.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useI18n } from "../../../../lib/i18n";
import { useEventCallback } from "../../../../lib/useEventCallback";
import { onWorkspaceAccessCallback } from "../../../workspaces/tauriAdapter";
import type { OAuthProvider, WorkspaceAdminScope } from "../../domain";
import { isAdminSuccess, WorkspaceAdminRequestError } from "../../requests";
import { startWorkspaceProviderAuthorization } from "../../tauriAdapter";
import {
  forgetGcpRepair,
  rememberGcpRepair,
  type GcpRepairTarget,
  type GcpSetupSession,
} from "../gcp/gcpModel";
import { gcpSetupsQuery } from "../gcp/queries";
import { providerAccountsQuery } from "../queries";
import { integrationBaseline, integrationChangedSince } from "./accountModel";
import { providerErrorMessage } from "./providerErrors";
import { invalidateProviderReads } from "./providerReads";

/** The one-use start link the browser opens expires after ten minutes. */
const START_LINK_TTL_MS = 10 * 60_000;
const RETURN_SETTLE_MS = 300;

export type AuthorizationRequest = {
  provider: OAuthProvider;
  providerName: string;
  /** A Cloud SQL repair keeps its project and instance pinned through the round trip. */
  repair: GcpRepairTarget | null;
};

type AuthorizationFlow = AuthorizationRequest & {
  startedAt: number;
  baseline: ReadonlyMap<string, string>;
};

export type AuthorizationStatus =
  | { kind: "idle" }
  | { kind: "starting"; request: AuthorizationRequest }
  | {
      kind: "waiting";
      request: AuthorizationRequest;
      incomplete: boolean;
      error: string | null;
      startedAt: number;
    }
  | { kind: "checking"; request: AuthorizationRequest }
  | { kind: "expired"; request: AuthorizationRequest }
  | { kind: "failed"; request: AuthorizationRequest; message: string };

export type AuthorizationOutcome =
  | { provider: "planetScale"; providerName: string }
  | {
      provider: "gcpCloudSql";
      providerName: string;
      setup: GcpSetupSession;
      repair: GcpRepairTarget | null;
    };

type ActiveAuthorization = {
  request: AuthorizationRequest;
  flow: AuthorizationFlow | null;
  phase: "starting" | "waiting" | "checking";
  returned: boolean;
};

function requestOf(flow: AuthorizationFlow): AuthorizationRequest {
  return { provider: flow.provider, providerName: flow.providerName, repair: flow.repair };
}

export function useProviderAuthorization(
  scope: WorkspaceAdminScope,
  onComplete: (outcome: AuthorizationOutcome) => void,
) {
  const { lang, t } = useI18n();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthorizationStatus>({ kind: "idle" });
  // The ref is the single writer of the flow; React state only projects it.
  const activeRef = useRef<ActiveAuthorization | null>(null);
  const leftAppRef = useRef(false);

  const waitingStatus = (flow: AuthorizationFlow, incomplete: boolean, error: string | null) => ({
    kind: "waiting" as const,
    request: requestOf(flow),
    incomplete,
    error,
    startedAt: flow.startedAt,
  });

  const check = useEventCallback(async (reason: "return" | "manual" | "deadline") => {
    const active = activeRef.current;
    if (!active) return;
    if (active.phase === "starting") {
      active.returned = true;
      return;
    }
    if (active.phase === "checking" || !active.flow) return;
    const flow = active.flow;
    active.phase = "checking";
    setStatus({ kind: "checking", request: requestOf(flow) });
    try {
      let outcome: AuthorizationOutcome | null = null;
      if (flow.provider === "planetScale") {
        const snapshot = await queryClient.fetchQuery({
          ...providerAccountsQuery(scope),
          staleTime: 0,
        });
        if (integrationChangedSince(flow.baseline, snapshot.integrations, "planetScale")) {
          outcome = { provider: "planetScale", providerName: flow.providerName };
        }
      } else {
        const setups = await queryClient.fetchQuery({ ...gcpSetupsQuery(scope), staleTime: 0 });
        // Only a setup this authorization created completes it; an older setup
        // from an earlier attempt or another administrator never does.
        const created = setups.find((setup) => !flow.baseline.has(setup.id));
        if (created) {
          outcome = {
            provider: "gcpCloudSql",
            providerName: flow.providerName,
            setup: created,
            repair: flow.repair,
          };
        }
      }
      if (activeRef.current !== active) return;
      if (outcome) {
        activeRef.current = null;
        setStatus({ kind: "idle" });
        onComplete(outcome);
        return;
      }
      if (reason === "deadline" || Date.now() - flow.startedAt >= START_LINK_TTL_MS) {
        activeRef.current = null;
        setStatus({ kind: "expired", request: requestOf(flow) });
        return;
      }
      active.phase = "waiting";
      setStatus(waitingStatus(flow, true, null));
    } catch (error) {
      if (activeRef.current !== active) return;
      active.phase = "waiting";
      setStatus(waitingStatus(
        flow,
        false,
        providerErrorMessage(error, { lang, t }, "workspaceProviders.authorizationCheckFailed"),
      ));
    }
  });

  const start = useEventCallback(async (request: AuthorizationRequest) => {
    const current = activeRef.current;
    if (current && current.phase !== "waiting") return;
    const active: ActiveAuthorization = { request, flow: null, phase: "starting", returned: false };
    activeRef.current = active;
    leftAppRef.current = false;
    setStatus({ kind: "starting", request });
    if (request.provider === "gcpCloudSql") {
      if (request.repair) rememberGcpRepair(scope, request.repair);
      else forgetGcpRepair();
    }
    const startedAt = Date.now();
    try {
      // A fresh snapshot, so another administrator's earlier change or an older
      // Cloud SQL setup is not mistaken for this authorization completing.
      const baseline = request.provider === "planetScale"
        ? integrationBaseline(
            (await queryClient.fetchQuery({ ...providerAccountsQuery(scope), staleTime: 0 }))
              .integrations,
            "planetScale",
          )
        : new Map<string, string>(
            (await queryClient.fetchQuery({ ...gcpSetupsQuery(scope), staleTime: 0 }))
              .map((setup) => [setup.id, setup.createdAt] as const),
          );
      if (activeRef.current !== active) return;
      const response = await startWorkspaceProviderAuthorization(
        scope.accountId,
        scope.workspaceId,
        request.provider,
      );
      if (activeRef.current !== active) return;
      if (!isAdminSuccess(response)) throw new WorkspaceAdminRequestError(response);
      active.flow = { ...request, startedAt, baseline };
      active.phase = "waiting";
      setStatus(waitingStatus(active.flow, false, null));
      if (active.returned) void check("return");
    } catch (error) {
      if (activeRef.current !== active) return;
      activeRef.current = null;
      setStatus({
        kind: "failed",
        request,
        message: providerErrorMessage(error, { lang, t }, "workspaceProviders.authorizationStartFailed"),
      });
    }
  });

  const cancel = useEventCallback(() => {
    activeRef.current = null;
    leftAppRef.current = false;
    setStatus({ kind: "idle" });
  });

  // The browser's return link also follows an authorization that was cancelled
  // here but finished anyway; re-read so its account or setup still appears.
  const refreshAfterUntrackedReturn = useEventCallback(() => {
    void invalidateProviderReads(queryClient, scope);
  });

  useEffect(() => {
    let timer: number | null = null;
    const schedule = (delay: number) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void check("return");
      }, delay);
    };
    const leaveApp = () => {
      if (activeRef.current) leftAppRef.current = true;
    };
    const returnToApp = () => {
      if (!leftAppRef.current) return;
      leftAppRef.current = false;
      schedule(RETURN_SETTLE_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") returnToApp();
      else leaveApp();
    };
    window.addEventListener("blur", leaveApp);
    window.addEventListener("focus", returnToApp);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unlisten = onWorkspaceAccessCallback(() => {
      leftAppRef.current = false;
      if (activeRef.current) schedule(0);
      else refreshAfterUntrackedReturn();
    });
    void unlisten.catch(() => {});
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("blur", leaveApp);
      window.removeEventListener("focus", returnToApp);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [check, refreshAfterUntrackedReturn]);

  const waitingSince = status.kind === "waiting" ? status.startedAt : null;
  useEffect(() => {
    if (waitingSince === null) return;
    const timer = window.setTimeout(
      () => void check("deadline"),
      Math.max(0, waitingSince + START_LINK_TTL_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [waitingSince, check]);

  useEffect(() => () => {
    activeRef.current = null;
  }, []);

  const inFlight = status.kind === "starting"
    || status.kind === "waiting"
    || status.kind === "checking";
  const repairingConnectionId = inFlight && status.request.repair
    ? status.request.repair.connectionId
    : null;

  return {
    status,
    /** A browser authorization is open; other provider account changes wait for it. */
    inFlight,
    /** A request is running right now; view changes are locked until it settles. */
    busy: status.kind === "starting" || status.kind === "checking",
    repairingConnectionId,
    start,
    checkNow: () => void check("manual"),
    cancel,
  };
}
