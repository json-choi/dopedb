// Drives the real startup hook across deterministic rerenders and deferred ACP
// responses; the existing focus-ownership case owns this regression scenario.
import * as React from "react";
import { expect, vi } from "vitest";
import type { AcpSessionFocus, AcpSessionSummary } from "../src/features/agents/domain";
import { isCurrentAcpFocusRequest, type AcpFocusRequest } from "../src/features/agents/sessionFocus";
import { acpSessionStore } from "../src/features/agents/sessionStore";
import { closeAgentAcpSession, startAgentAcpSession } from "../src/features/agents/tauriAdapter";
import { useAcpSessionStartup } from "../src/features/agents/useAcpSessionStartup";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof React>(),
  useRef: vi.fn(), useCallback: vi.fn(), useEffect: vi.fn(),
}));
vi.mock("../src/lib/i18n", () => ({ useI18n: () => ({ t: () => "start failed" }) }));
vi.mock("../src/features/agents/productAnalytics", () => ({
  beginAgentInitializationOutcome: () => vi.fn(),
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("promise executor did not run"); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

export async function exerciseStartupOwnership(makeSession: (id: string) => AcpSessionSummary) {
  const useRef = vi.mocked(React.useRef);
  const useCallback = vi.mocked(React.useCallback).mockImplementation((callback) => callback);
  // No DOM or timers: explicit starts exercise the same callback used by prewarm.
  const useEffect = vi.mocked(React.useEffect).mockImplementation(() => undefined);
  const start = vi.mocked(startAgentAcpSession);
  const close = vi.mocked(closeAgentAcpSession);
  try {
    for (const scenario of ["replacement", "chain", "promotion", "newer-foreground"] as const) {
      // Given: one hook instance with stable refs and a pending adapter start.
      const refs = [{ current: null }, { current: null }, { current: null }, { current: null }];
      let current: AcpFocusRequest = {
        requestId: 0, scopeKey: "workspace:startup", selectionGeneration: 0, selectedSessionId: null,
      };
      const onStartingChange = vi.fn<(starting: boolean) => void>();
      const onStarted = vi.fn();
      const firstResponse = deferred<AcpSessionFocus>();
      const lastResponse = deferred<AcpSessionFocus>();
      const firstRequested = deferred<void>();
      const lastRequested = deferred<void>();
      const closeResponse = deferred<void>();
      const obsoleteClosed = deferred<void>();
      start.mockReset();
      start.mockImplementationOnce(() => {
        firstRequested.resolve();
        return firstResponse.promise;
      }).mockImplementationOnce(() => {
        lastRequested.resolve();
        return lastResponse.promise;
      });
      close.mockReset();
      close.mockImplementation(() => {
        obsoleteClosed.resolve();
        return closeResponse.promise;
      });
      acpSessionStore.activate(current.scopeKey);
      const render = (key: string) => {
        for (const ref of refs) useRef.mockReturnValueOnce(ref);
        return useAcpSessionStartup({
          activeSessionId: null,
          beginFocusRequest: () => {
            current = { ...current, requestId: current.requestId + 1 };
            return current;
          },
          currentFocusRequest: () => current,
          focusRequestIsCurrent: (request) => isCurrentAcpFocusRequest(request, current),
          catalogScope: {
            key: current.scopeKey, ready: true, workspaceId: null, accountScope: null, workspaceKind: "personal",
          },
          connectionId: makeSession("fixture").connectionId,
          selectedResourceScopes: [{
            projectEnvironmentId: key,
            authorityConnectionId: makeSession("fixture").connectionId,
            connectionIds: [makeSession("fixture").connectionId], sourceIds: [],
          }],
          selectedProvider: "codex", writeConnectionId: null,
          resourceScopeReady: true, prerequisitesReady: true, sessionsLoading: false,
          ensureSelectedResources: async () => true,
          onError: vi.fn(), onStarted, onPrepared: async () => undefined, onStartingChange,
        });
      };
      const firstStart = render("a");
      const first = firstStart("codex", scenario !== "promotion");
      await firstRequested.promise;

      // When: foreground ownership is promoted or carried through replacements.
      let latest: Promise<AcpSessionFocus | null>;
      let intermediate: Promise<AcpSessionFocus | null> | null = null;
      if (scenario === "promotion") {
        latest = render("a")("codex", true);
        expect(latest).toBe(first);
      } else {
        latest = render("b")("codex", scenario === "newer-foreground");
        if (scenario === "chain") {
          intermediate = latest;
          latest = render("c")("codex", false);
        }
      }
      const firstFocus: AcpSessionFocus = {
        session: makeSession("obsolete"), events: [], replayTruncated: false,
      };
      firstResponse.resolve(firstFocus);
      if (scenario !== "promotion") {
        await obsoleteClosed.promise;
        expect(close).toHaveBeenCalledWith(firstFocus.session.id);
        expect(start).toHaveBeenCalledTimes(1);
        closeResponse.resolve();
        expect(await first).toBeNull();
        if (intermediate) expect(await intermediate).toBeNull();
        await lastRequested.promise;
        // Then: an older finalizer cannot clear the latest foreground owner.
        expect(onStartingChange.mock.calls[onStartingChange.mock.calls.length - 1]).toEqual([true]);
        expect(onStarted).not.toHaveBeenCalled();
        lastResponse.resolve({ session: makeSession("latest"), events: [], replayTruncated: false });
      }
      const result = await latest;
      expect(result?.session.id).toBe(makeSession(scenario === "promotion" ? "obsolete" : "latest").id);
      expect(onStartingChange.mock.calls[onStartingChange.mock.calls.length - 1], scenario).toEqual([false]);
      expect(onStarted).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(scenario === "promotion" ? 1 : 2);
    }
  } finally {
    useRef.mockReset();
    useCallback.mockReset();
    useEffect.mockReset();
  }
}
