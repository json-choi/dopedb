import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import capability from "../../../src-tauri/capabilities/default.json";
import tauriBenchmarkConfig from "../../../src-tauri/tauri.benchmark.conf.json";
import tauriConfig from "../../../src-tauri/tauri.conf.json";
import tauriDevConfig from "../../../src-tauri/tauri.dev.conf.json";
import { desktopWorkspaceAccessCallbackUrl } from "../../../workspace-cloud/lib/desktop-deep-link";
import {
  onWorkspaceAdminRequested,
  requestWorkspaceAdmin,
  takePendingWorkspaceAdminFocus,
} from "../workspaceAdmin/navigationRequest";
import {
  AGENT_SETUP_URLS,
  DOPEDB_RELEASES_URL,
} from "../../lib/externalLinks";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import {
  agentDockInteraction,
  agentDockLayout,
  clampAgentDockWidth,
  shouldOverlayAgentDock,
  shouldDismissAgentOverlayFromEscape,
} from "../agents/layout";
import { agentSessionErrorLabel } from "../agents/agentErrorLabels";
import { closedBeforeTurnCompleted } from "../agents/transcript";
import { retainInertShellChildren } from "../appShell/useInertShellBackground";
import {
  isDialogKeyboardTarget,
  menuKeyboardOwner,
  menuInitialFocusForTriggerKey,
  menuNavigationTargetIndex,
} from "../../design-system/menuInteraction";
import {
  cancelWorkspaceResourceQueries,
  invalidateJobQueries,
  resetConnectionResourceQueries,
  resetWorkspaceResourceQueries,
  resumePendingWorkspaceResourceQueries,
} from "../../lib/queryClient";
import { sharedWorkspaceScopeAvailable, useCatalogScope, type CatalogScope } from "../../lib/queries";
import { queryServiceSessionProjection } from "../queryServices/useQueryServices";
import { jobConnectionId, type JobChangedEvent } from "../jobs/domain";
import {
  shouldRevalidateWorkspaceAuth,
  workspaceAuthRetryDelay,
  WORKSPACE_AUTH_RECHECK_MS,
  WORKSPACE_AUTH_RETRY_MS,
  WORKSPACE_AUTH_RETRY_MAX_MS,
} from "./authPolicy";
import {
  runWorkspaceAuthorityTransition,
  synchronizeWorkspaceScope,
  workspaceAuthorityChanged,
  workspaceResourceQueryScopeChanged,
} from "./cache";
import {
  accountId,
  workspaceId,
  type WorkspaceAuthState,
  type WorkspaceRole,
} from "./domain";
import type { WorkspaceContextState } from "./queries";
import * as workspaceQueries from "./queries";
import * as workspaceAdapter from "./tauriAdapter";
import * as ipc from "../../ipc/core";

function authState(
  userId: string,
  membership?: { workspace: string; role: WorkspaceRole },
): WorkspaceAuthState {
  const user = {
    id: accountId(userId),
    email: `${userId}@example.test`,
    displayName: userId,
  };
  return {
    authenticated: true,
    user,
    authorityGeneration: 1,
    accounts: [{
      user,
      memberships: membership
        ? [{ workspaceId: workspaceId(membership.workspace), role: membership.role }]
        : [],
    }],
  };
}

function workspaceContext(id: string): WorkspaceContextState {
  const now = "2026-08-13T00:00:00Z";
  const active = {
    id: workspaceId(id),
    name: id,
    kind: "team" as const,
    lifecycleState: "active" as const,
    createdAt: now,
    updatedAt: now,
  };
  return { feature: { enabled: true }, workspaces: [active], active };
}

describe("workspace auth lifecycle", () => {
  it("keeps a recently verified signed-in state stable", () => {
    const recentlyVerifiedFocusMayRefreshAuthority = shouldRevalidateWorkspaceAuth(
      true,
      1_000,
      false,
      1_000 + 60_000,
    );
    // WorkspaceAccount uses this exact gate before native membership/auth
    // verification; an unchanged proof must leave active ACP and PTY work alive.
    expect(recentlyVerifiedFocusMayRefreshAuthority).toBe(false);
  });

  it("revalidates a signed-in state after the cooldown", () => {
    expect(WORKSPACE_AUTH_RETRY_MS).toBeLessThan(WORKSPACE_AUTH_RECHECK_MS);
    expect(workspaceAuthRetryDelay(1, () => 0)).toBe(WORKSPACE_AUTH_RETRY_MS);
    expect(workspaceAuthRetryDelay(3, () => 0)).toBe(WORKSPACE_AUTH_RETRY_MS * 4);
    expect(workspaceAuthRetryDelay(100, () => 1)).toBe(WORKSPACE_AUTH_RETRY_MAX_MS);
    expect(
      shouldRevalidateWorkspaceAuth(
        true,
        1_000,
        false,
        1_000 + WORKSPACE_AUTH_RECHECK_MS,
      ),
    ).toBe(true);
  });

  it("deduplicates checks, clears private observers, and restricts auth URLs", async () => {
    expect(shouldRevalidateWorkspaceAuth(true, 0, true, WORKSPACE_AUTH_RECHECK_MS)).toBe(false);
    expect(shouldRevalidateWorkspaceAuth(false, 0, false, WORKSPACE_AUTH_RECHECK_MS)).toBe(false);

    const opener = capability.permissions.find((permission) => (
      typeof permission !== "string" && permission.identifier === "opener:allow-open-url"
    ));
    const allowedUrls = typeof opener === "string"
      ? []
      : opener?.allow?.flatMap((entry) => entry.url ?? []) ?? [];
    expect(allowedUrls).toContain(
      "https://github.com/apps/dopedb-knowledge/installations/new?state=*",
    );
    expect(allowedUrls).toContain("https://dopedb.dev/privacy");
    expect(allowedUrls).toContain(AGENT_SETUP_URLS.claude);
    expect(allowedUrls).toContain(AGENT_SETUP_URLS.codex);
    expect(allowedUrls).toContain(DOPEDB_RELEASES_URL);
    expect(allowedUrls).toContain("https://app.dopedb.dev/analyses/*");
    expect(allowedUrls).not.toContain("https://github.com/*");
    expect(allowedUrls).not.toContain("https://app.dopedb.dev/auth/desktop?*");
    expect(allowedUrls).not.toContain("https://app.dopedb.dev/auth/device?user_code=*");
    expect(allowedUrls.some((url) => url.startsWith("http:"))).toBe(false);

    const desktopAuthorization = {
      attemptId: "desktop-attempt",
      authorizationUrl: "http://127.0.0.1:32123/start/desktop-attempt",
      expiresIn: 300,
    };
    const desktopLoginInvoke = vi.spyOn(ipc, "invoke")
      .mockResolvedValueOnce(desktopAuthorization)
      .mockResolvedValueOnce({ status: "denied", user: null })
      .mockResolvedValueOnce(undefined);
    try {
      expect(await workspaceAdapter.beginDesktopWorkspaceLogin()).toEqual(desktopAuthorization);
      expect(await workspaceAdapter.completeDesktopWorkspaceLogin(desktopAuthorization.attemptId))
        .toEqual({ status: "denied", user: null });
      await workspaceAdapter.cancelDesktopWorkspaceLogin(desktopAuthorization.attemptId);
      expect(desktopLoginInvoke.mock.calls).toEqual([
        ["begin_desktop_workspace_login"],
        ["complete_desktop_workspace_login", { attemptId: "desktop-attempt" }],
        ["cancel_desktop_workspace_login", { attemptId: "desktop-attempt" }],
      ]);
    } finally {
      desktopLoginInvoke.mockRestore();
    }

    expect(desktopWorkspaceAccessCallbackUrl).toBe("dopedb://workspace/access-complete");
    // Managed-connection recovery and the shared-database shortcut open exactly
    // Workspace management → Providers and hand their focus over once; a stale or
    // superseded focus never reaches the panel.
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = new EventTarget();
    try {
      const recoveryTarget = "10000000-0000-4000-8000-000000000001";
      const recoveryFocus = { kind: "connection", connectionId: recoveryTarget } as const;
      const requested: string[] = [];
      const stopListening = onWorkspaceAdminRequested((section) => requested.push(section));
      requestWorkspaceAdmin("workspace-providers", recoveryFocus);
      expect(requested).toEqual(["workspace-providers"]);
      expect(takePendingWorkspaceAdminFocus()).toEqual(recoveryFocus);
      expect(takePendingWorkspaceAdminFocus()).toBeNull();
      requestWorkspaceAdmin("workspace-providers", { kind: "addDatabase" });
      expect(takePendingWorkspaceAdminFocus()).toEqual({ kind: "addDatabase" });
      requestWorkspaceAdmin("workspace-providers", recoveryFocus);
      requestWorkspaceAdmin("workspace-members");
      expect(takePendingWorkspaceAdminFocus()).toBeNull();
      requestWorkspaceAdmin("workspace-providers", recoveryFocus);
      expect(takePendingWorkspaceAdminFocus(Date.now() + 61_000)).toBeNull();
      stopListening();
      requestWorkspaceAdmin("workspace-access");
      expect(requested).toEqual([
        "workspace-providers",
        "workspace-providers",
        "workspace-providers",
        "workspace-members",
        "workspace-providers",
      ]);
    } finally {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
    expect(tauriConfig.plugins["deep-link"].desktop.schemes).toEqual(["dopedb"]);
    expect(tauriDevConfig.plugins["deep-link"].desktop.schemes).toEqual(["dopedb-dev"]);
    expect(tauriBenchmarkConfig.plugins["deep-link"].desktop.schemes).toEqual([
      "dopedb-benchmark",
    ]);

    const translateKey = ((key: string) => key) as Parameters<
      typeof agentSessionErrorLabel
    >[1];
    expect(agentSessionErrorLabel("workspace_authority_changed", translateKey))
      .toBe("agent.acpInterruptedWorkspaceAuthority");
    expect(agentSessionErrorLabel("connection_authority_changed", translateKey))
      .toBe("agent.acpInterruptedConnectionAuthority");
    expect(agentSessionErrorLabel("agent_process_closed", translateKey))
      .toBe("agent.acpInterruptedProcessClosed");
    expect(agentSessionErrorLabel("agent_process_unavailable", translateKey))
      .toBe("agent.acpInterruptedProcessUnavailable");
    expect(agentSessionErrorLabel("agent_session_metadata_unavailable", translateKey))
      .toBe("agent.acpInterruptedSessionMetadataUnavailable");
    expect(agentSessionErrorLabel("provider detail", translateKey))
      .toBe("provider detail");
    expect(closedBeforeTurnCompleted("closed", null, [
      { kind: "user" },
      { kind: "tool" },
    ])).toBe(true);
    expect(closedBeforeTurnCompleted("closed", null, [
      { kind: "user" },
      { kind: "turnEnd" },
    ])).toBe(false);
    expect(closedBeforeTurnCompleted("failed", null, [
      { kind: "user" },
    ])).toBe(false);

    expect(agentDockLayout(false, false)).toBe("docked");
    expect(agentDockLayout(false, true)).toBe("overlay");
    expect(agentDockLayout(true, true)).toBe("compact");
    expect(clampAgentDockWidth(680, 1_200)).toBe(600);
    expect(shouldOverlayAgentDock({
      viewportWidth: 1_200,
      leftToolWindowWidth: 355,
      requestedAgentWidth: 466,
    })).toBe(true);
    expect(shouldOverlayAgentDock({
      viewportWidth: 1_200,
      leftToolWindowWidth: 296,
      requestedAgentWidth: 466,
    })).toBe(false);
    expect(shouldOverlayAgentDock({
      viewportWidth: 1_000,
      leftToolWindowWidth: 355,
      requestedAgentWidth: 466,
    })).toBe(true);
    expect(shouldOverlayAgentDock({
      viewportWidth: 1_440,
      leftToolWindowWidth: 396,
      requestedAgentWidth: 396,
    })).toBe(false);
    expect(shouldOverlayAgentDock({
      viewportWidth: 1_200,
      leftToolWindowWidth: 0,
      requestedAgentWidth: 466,
    })).toBe(false);
    expect(agentDockInteraction("docked")).toEqual({
      role: undefined,
      ariaModal: undefined,
      shellInert: false,
    });
    expect(agentDockInteraction("overlay")).toEqual({
      role: "dialog",
      ariaModal: undefined,
      shellInert: false,
    });
    expect(agentDockInteraction("compact")).toEqual({
      role: "dialog",
      ariaModal: true,
      shellInert: true,
    });
    const preInert = { inert: true, isConnected: true };
    const workbench = { inert: false, isConnected: true };
    const agent = { inert: false, isConnected: true };
    const releaseInert = retainInertShellChildren([
      { element: preInert, agentSurface: false },
      { element: workbench, agentSurface: false },
      { element: agent, agentSurface: true },
    ], true);
    expect(preInert.inert).toBe(true);
    expect(workbench.inert).toBe(true);
    expect(agent.inert).toBe(false);
    releaseInert();
    expect(preInert.inert).toBe(true);
    expect(workbench.inert).toBe(false);
    expect(shouldDismissAgentOverlayFromEscape({
      defaultPrevented: false,
      focusInside: true,
      nestedModal: false,
    })).toBe(true);
    expect(shouldDismissAgentOverlayFromEscape({
      defaultPrevented: false,
      focusInside: false,
      nestedModal: false,
    })).toBe(false);
    expect(shouldDismissAgentOverlayFromEscape({
      defaultPrevented: false,
      focusInside: true,
      nestedModal: true,
    })).toBe(false);
    expect([
      "Enter",
      " ",
      "Spacebar",
      "ArrowDown",
      "ArrowUp",
      "Escape",
    ].map(menuInitialFocusForTriggerKey)).toEqual([
      "first",
      "first",
      "first",
      "first",
      "last",
      null,
    ]);
    expect([
      menuNavigationTargetIndex({ key: "ArrowDown", currentIndex: 2, itemCount: 3 }),
      menuNavigationTargetIndex({ key: "ArrowUp", currentIndex: 0, itemCount: 3 }),
      menuNavigationTargetIndex({ key: "Home", currentIndex: 1, itemCount: 3 }),
      menuNavigationTargetIndex({ key: "End", currentIndex: 1, itemCount: 3 }),
      menuNavigationTargetIndex({ key: "ArrowDown", currentIndex: -1, itemCount: 3 }),
      menuNavigationTargetIndex({ key: "ArrowUp", currentIndex: -1, itemCount: 3 }),
      menuNavigationTargetIndex({ key: "ArrowDown", currentIndex: 0, itemCount: 0 }),
    ]).toEqual([0, 2, 0, 2, 0, 2, null]);

    // The smoke runner is Node-only. Exercise the actual scope resolver with
    // explicit closest/portal answers; real browser focus remains a UI check.
    class KeyboardScopeElement {
      dataset: { floatingOwnerId?: string } = {};
      scope: KeyboardScopeElement | null = null;
      modal: KeyboardScopeElement | null = null;
      portal: KeyboardScopeElement | null = null;
      constructor(readonly role = "button") {}
      matches(selector: string) {
        return selector.includes(`[role="${this.role}"]`);
      }
      closest(selector: string) {
        if (selector === "[data-floating-owner-id]") return this.portal;
        return selector.includes('[role="menu"]') ? this.scope : this.modal;
      }
    }
    vi.stubGlobal("Element", KeyboardScopeElement);
    const parentMenu = new KeyboardScopeElement("menu");
    const dialog = new KeyboardScopeElement("alertdialog");
    dialog.dataset.floatingOwnerId = "parent-menu";
    const confirm = new KeyboardScopeElement();
    confirm.scope = dialog;
    confirm.modal = dialog;
    confirm.portal = dialog;
    const nestedMenu = new KeyboardScopeElement("menu");
    const nestedItem = new KeyboardScopeElement();
    nestedItem.scope = nestedMenu;
    nestedItem.modal = dialog;
    const ownedPortal = new KeyboardScopeElement();
    ownedPortal.dataset.floatingOwnerId = "parent-menu";
    const portalledItem = new KeyboardScopeElement();
    portalledItem.portal = ownedPortal;
    vi.stubGlobal("document", {
      getElementById: (id: string) => id === "parent-menu" ? parentMenu : dialog,
    });
    try {
      expect(isDialogKeyboardTarget(confirm as unknown as EventTarget)).toBe(true);
      expect(isDialogKeyboardTarget(parentMenu as unknown as EventTarget)).toBe(false);
      expect(menuKeyboardOwner(confirm as unknown as Node)).toBeNull();
      expect(menuKeyboardOwner(nestedItem as unknown as Node)).toBe(nestedMenu);
      expect(menuKeyboardOwner(portalledItem as unknown as Node)).toBe(parentMenu);
      ownedPortal.dataset.floatingOwnerId = "dialog";
      expect(menuKeyboardOwner(portalledItem as unknown as Node)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }

    const scopeWorkspaceId = "20000000-0000-4000-8000-000000000001";
    const scopeActorId = "20000000-0000-4000-8000-000000000002";
    expect(sharedWorkspaceScopeAvailable({
      workspaceKind: "personal",
      accountScope: scopeActorId,
    })).toBe(false);
    expect(sharedWorkspaceScopeAvailable({
      workspaceKind: "team",
      accountScope: null,
    })).toBe(false);
    expect(sharedWorkspaceScopeAvailable({
      workspaceKind: "team",
      accountScope: scopeActorId,
    })).toBe(true);
    const scopeClient = new QueryClient();
    const signedInScope = workspaceContext(scopeWorkspaceId);
    scopeClient.setQueryData(workspaceQueries.workspaceQueryKeys.auth(), {
      authenticated: true,
      user: { id: accountId(scopeActorId), email: "member@dopedb.example", displayName: "Member" },
      accounts: [],
      authorityGeneration: 1,
    } satisfies WorkspaceAuthState);
    const renderScope = () => {
      const scopes: CatalogScope[] = [];
      function ScopeProbe() {
        scopes.push(useCatalogScope());
        return null;
      }
      renderToStaticMarkup(createElement(QueryClientProvider, { client: scopeClient }, createElement(ScopeProbe)));
      return scopes[0];
    };
    scopeClient.setQueryData(workspaceQueries.workspaceQueryKeys.context(), {
      ...signedInScope,
      active: { ...signedInScope.active, kind: "personal" },
    });
    const localScope = renderScope();
    expect(localScope.accountScope).toBeNull();
    expect(localScope.key).toContain(`account:${scopeActorId}`);
    expect(queryServiceSessionProjection(localScope, localScope.key)).toBe("memory");
    scopeClient.setQueryData(workspaceQueries.workspaceQueryKeys.context(), signedInScope);
    const teamScope = renderScope();
    expect(teamScope.accountScope).toBe(scopeActorId);
    expect(queryServiceSessionProjection(teamScope, teamScope.key)).toBe("persistent");
    scopeClient.clear();
    const importClient = new QueryClient();
    let storedRowCount = 2;
    const rowsKey = ["tableRows", "import-connection", "qa_records"];
    const countKey = ["tableCount", "import-connection", "qa_records"];
    const unrelatedKey = ["tableCount", "other-connection", "qa_records"];
    const importObservers = [rowsKey, countKey, unrelatedKey].map((queryKey) =>
      new QueryObserver(importClient, {
        queryKey,
        initialData: 2,
        staleTime: Infinity,
        queryFn: async () => storedRowCount,
      })
    );
    const stopImportObservers = importObservers.map((observer) => observer.subscribe(() => {}));
    const jobEvent: JobChangedEvent = {
      connectionId: jobConnectionId("import-connection"),
      jobId: "import-job" as JobChangedEvent["jobId"],
      kind: "import",
      state: "running",
      rowsProcessed: 2,
      bytesProcessed: 40,
    };
    storedRowCount = 4;
    await invalidateJobQueries(importClient, jobEvent);
    await invalidateJobQueries(importClient, { ...jobEvent, kind: "export", state: "succeeded" });
    expect(importClient.getQueryData(rowsKey)).toBe(2);
    expect(importClient.getQueryData(countKey)).toBe(2);
    for (const state of ["succeeded", "paused", "cancelled", "failed"] as const) {
      await invalidateJobQueries(importClient, { ...jobEvent, state });
      expect(importClient.getQueryData(rowsKey)).toBe(storedRowCount);
      expect(importClient.getQueryData(countKey)).toBe(storedRowCount);
      expect(importClient.getQueryData(unrelatedKey)).toBe(2);
      storedRowCount++;
    }
    stopImportObservers.forEach((stop) => stop());
    importClient.clear();

    const accountA = authState("account-a");
    const workspaceA = workspaceContext("workspace-a");
    expect(
      workspaceAuthorityChanged(accountA, workspaceA, accountA, workspaceA),
    ).toBe(false);
    expect(
      workspaceAuthorityChanged(
        accountA,
        workspaceA,
        authState("account-b"),
        workspaceA,
      ),
    ).toBe(true);
    expect(
      workspaceAuthorityChanged(
        accountA,
        workspaceA,
        accountA,
        workspaceContext("workspace-b"),
      ),
    ).toBe(true);
    const roleBefore = authState(
      "account-a",
      { workspace: "workspace-a", role: "admin" },
    );
    const roleAfter = authState(
      "account-a",
      { workspace: "workspace-a", role: "viewer" },
    );
    expect(
      workspaceAuthorityChanged(
        roleBefore,
        workspaceA,
        roleAfter,
        workspaceA,
      ),
    ).toBe(true);
    expect(
      workspaceResourceQueryScopeChanged(
        roleBefore,
        workspaceA,
        roleAfter,
        workspaceA,
      ),
    ).toBe(false);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let catalogReads = 0;
    const catalogObserver = new QueryObserver(queryClient, {
      queryKey: ["catalog", "connection-a"],
      queryFn: async () => ++catalogReads,
    });
    const stopCatalog = catalogObserver.subscribe(() => undefined);
    await catalogObserver.refetch();
    await resetConnectionResourceQueries(queryClient, ["connection-a"]);
    expect(catalogReads).toBe(2);
    expect(catalogObserver.getCurrentResult().data).toBe(2);

    let agentEnvironmentReads = 0;
    const agentEnvironmentObserver = new QueryObserver(queryClient, {
      queryKey: knowledgeQueryKeys.agentEnvironments(
        "connection-a",
        "scope-a",
      ),
      queryFn: async () => ++agentEnvironmentReads,
    });
    const stopAgentEnvironments = agentEnvironmentObserver.subscribe(
      () => undefined,
    );
    await agentEnvironmentObserver.refetch();
    await resetConnectionResourceQueries(queryClient, ["connection-a"]);
    expect(agentEnvironmentReads).toBe(2);

    let privateReads = 0;
    const privateObserver = new QueryObserver(queryClient, {
      queryKey: ["providerCredentials"],
      queryFn: async () => ++privateReads,
    });
    const stopPrivate = privateObserver.subscribe(() => undefined);
    await privateObserver.refetch();
    await resetWorkspaceResourceQueries(queryClient);
    expect(privateReads).toBe(1);
    expect(privateObserver.getCurrentResult().data).toBeUndefined();
    await resumePendingWorkspaceResourceQueries(queryClient);
    expect(privateReads).toBe(2);
    expect(privateObserver.getCurrentResult().data).toBe(2);

    // Startup authority verification can race the Explorer's first Knowledge read.
    // TanStack reverts that cancelled observer to pending + idle, so the verified
    // unchanged-authority path must explicitly resume it rather than refreshing only
    // the Connections query owned by AppShell.
    let knowledgeReads = 0;
    const knowledgeObserver = new QueryObserver(queryClient, {
      queryKey: knowledgeQueryKeys.projects("scope-a"),
      queryFn: ({ signal }) => {
        knowledgeReads += 1;
        if (knowledgeReads > 1) return Promise.resolve(["ready"]);
        return new Promise<string[]>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("authority verification", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const stopKnowledge = knowledgeObserver.subscribe(() => undefined);
    await Promise.resolve();
    expect(knowledgeObserver.getCurrentResult().fetchStatus).toBe("fetching");
    await cancelWorkspaceResourceQueries(queryClient);
    expect(knowledgeObserver.getCurrentResult().status).toBe("pending");
    expect(knowledgeObserver.getCurrentResult().fetchStatus).toBe("idle");
    await resumePendingWorkspaceResourceQueries(queryClient);
    expect(knowledgeReads).toBe(2);
    expect(knowledgeObserver.getCurrentResult().data).toEqual(["ready"]);

    // A changed authority generation commits a new query key after the old scope
    // has already been fenced. Once that key is active, recover only its data-less
    // pending observer; successful reads and inactive old-scope entries stay still.
    let changedScopeReads = 0;
    const changedScopeObserver = new QueryObserver(queryClient, {
      queryKey: knowledgeQueryKeys.projects("scope-b"),
      queryFn: ({ signal }) => {
        changedScopeReads += 1;
        if (changedScopeReads > 1) return Promise.resolve(["new-scope"]);
        return new Promise<string[]>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("scope replacement", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const stopChangedScope = changedScopeObserver.subscribe(() => undefined);
    await Promise.resolve();
    await queryClient.cancelQueries({
      queryKey: knowledgeQueryKeys.projects("scope-b"),
      exact: true,
    });
    expect(changedScopeObserver.getCurrentResult().status).toBe("pending");
    expect(changedScopeObserver.getCurrentResult().fetchStatus).toBe("idle");

    let inactiveReads = 0;
    const inactiveObserver = new QueryObserver(queryClient, {
      queryKey: knowledgeQueryKeys.projects("old-scope"),
      queryFn: async () => ++inactiveReads,
      enabled: false,
    });
    const stopInactive = inactiveObserver.subscribe(() => undefined);
    stopInactive();
    await resumePendingWorkspaceResourceQueries(queryClient);
    expect(changedScopeReads).toBe(2);
    expect(changedScopeObserver.getCurrentResult().data).toEqual(["new-scope"]);
    expect(knowledgeReads).toBe(2);
    expect(inactiveReads).toBe(0);

    let oldReadAborted = false;
    const pendingOldRead = queryClient.fetchQuery({
      queryKey: ["knowledgeSources", "old-workspace"],
      queryFn: ({ signal }) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          oldReadAborted = true;
          reject(new DOMException("workspace changed", "AbortError"));
        }, { once: true });
      }),
    });
    await Promise.resolve();
    await expect(
      runWorkspaceAuthorityTransition(
        queryClient,
        async () => {
          expect(oldReadAborted).toBe(true);
        },
        async () => {
          // A synchronization failure may race a newly started private read. The
          // transition must fail closed and remove that partial new-scope state.
          queryClient.setQueryData(["knowledgeSources", "new-workspace"], ["partial"]);
          throw new Error("context synchronization failed");
        },
      ),
    ).rejects.toThrow("context synchronization failed");
    await pendingOldRead.catch(() => undefined);
    expect(
      queryClient.getQueryData(["knowledgeSources", "new-workspace"]),
    ).toBeUndefined();
    stopKnowledge();
    stopChangedScope();
    stopAgentEnvironments();
    stopPrivate();
    stopCatalog();
    queryClient.clear();

    // A slower workspace read must never expose the new account/generation with
    // the previous workspace. Services and catalog readers share this boundary.
    const accountB = authState("account-b");
    const workspaceB = workspaceContext("workspace-b");
    const keys = workspaceQueries.workspaceQueryKeys;
    queryClient.setQueryData(keys.auth(), accountA);
    queryClient.setQueryData(keys.context(), workspaceA);
    let releaseContext!: (context: WorkspaceContextState) => void;
    let contextRequested!: () => void;
    const requested = new Promise<void>((resolve) => { contextRequested = resolve; });
    const pendingContext = new Promise<WorkspaceContextState>((resolve) => {
      releaseContext = resolve;
    });
    const authRead = vi.spyOn(workspaceAdapter, "workspaceAuthState")
      .mockResolvedValue(accountB);
    const contextRead = vi.spyOn(workspaceQueries, "readWorkspaceContext")
      .mockImplementation(() => {
        contextRequested();
        return pendingContext;
      });
    try {
      const synchronized = synchronizeWorkspaceScope(queryClient);
      await requested;
      expect(queryClient.getQueryData(keys.auth())).toEqual(accountA);
      expect(queryClient.getQueryData(keys.context())).toEqual(workspaceA);
      releaseContext(workspaceB);
      await synchronized;
      expect(queryClient.getQueryData(keys.auth())).toEqual(accountB);
      expect(queryClient.getQueryData(keys.context())).toEqual(workspaceB);

      authRead.mockResolvedValue(accountA);
      contextRead.mockRejectedValue(new Error("workspace unavailable"));
      await expect(synchronizeWorkspaceScope(queryClient))
        .rejects.toThrow("workspace unavailable");
      expect(queryClient.getQueryData(keys.auth())).toEqual(accountB);
      expect(queryClient.getQueryData(keys.context())).toEqual(workspaceB);
    } finally {
      authRead.mockRestore();
      contextRead.mockRestore();
      queryClient.clear();
    }
  });
});
