import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import capability from "../../../src-tauri/capabilities/default.json";
import tauriBenchmarkConfig from "../../../src-tauri/tauri.benchmark.conf.json";
import tauriConfig from "../../../src-tauri/tauri.conf.json";
import tauriDevConfig from "../../../src-tauri/tauri.dev.conf.json";
import { desktopWorkspaceLoginCallbackUrl } from "../../../workspace-cloud/lib/desktop-deep-link";
import {
  AGENT_SETUP_URLS,
  DOPEDB_RELEASES_URL,
} from "../../lib/externalLinks";
import productAnalyticsGoldenSource from "../../../tests/fixtures/product-analytics-v1.json";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import {
  agentDockInteraction,
  agentDockLayout,
  shouldOverlayAgentDock,
  shouldDismissAgentOverlayFromEscape,
} from "../agents/layout";
import {
  agentSessionErrorLabel,
} from "../agents/acpTranscriptPresentation";
import { closedBeforeTurnCompleted } from "../agents/transcript";
import { retainInertShellChildren } from "../appShell/useInertShellBackground";
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
import {
  ProductAnalyticsLocalStore,
  productAnalyticsInstallationReadyInput,
  productAnalyticsRetryDelay,
  productAnalyticsRetryIsBlocked,
  type ProductAnalyticsStorage,
} from "../productAnalytics/storage";
import {
  isProductAnalyticsAppVersion,
  isProductAnalyticsEvent,
  isProductAnalyticsEventInput,
  type ProductEventName,
  type QueuedProductAnalyticsEvent,
} from "../productAnalytics/domain";
import {
  productAnalyticsAccessMode,
  productAnalyticsConnectionEngine,
  productAnalyticsCredentialMode,
  productAnalyticsDurationBucket,
  productAnalyticsRowCountBucket,
  productAnalyticsStatementClass,
  productAnalyticsWorkspaceContext,
} from "../productAnalytics/outcomes";

type ProductAnalyticsGolden = Readonly<{
  schemaVersion: number;
  installationId: string;
  sessionId: string;
  appVersion: string;
  platform: string;
  locale: string;
  events: readonly Readonly<{
    eventId: string;
    name: ProductEventName;
    occurredAt: string;
    actorKey?: string;
    workspaceKey?: string;
    workspaceKind?: string;
    properties: Readonly<Record<string, unknown>>;
  }>[];
}>;

const productAnalyticsGolden = productAnalyticsGoldenSource as ProductAnalyticsGolden;

const analyticsPropertyKeys = {
  desktop_installation_ready: [],
  workspace_authentication_completed: ["outcome"],
  workspace_scope_ready: [],
  knowledge_environment_created: ["creationKind"],
  connection_verification_completed: ["outcome", "engine", "credentialMode", "ssh"],
  environment_connection_bound: ["accessMode", "engine"],
  query_execution_completed: [
    "outcome",
    "statementClass",
    "rowCountBucket",
    "durationBucket",
    "approvalRequired",
  ],
  knowledge_source_sync_completed: ["outcome", "sourceKind", "syncReason"],
  agent_session_initialization_completed: ["outcome", "provider"],
  agent_turn_completed: ["outcome", "provider", "durationBucket"],
  analysis_article_run_completed: ["outcome", "trigger", "durationBucket"],
  workspace_membership_ready: ["role"],
  shared_connection_access_ready: ["accessMode", "engine"],
} as const satisfies Record<ProductEventName, readonly string[]>;

function sortedKeys(value: Readonly<Record<string, unknown>>) {
  return Object.keys(value).sort();
}

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

    const loginCallback = new URL(desktopWorkspaceLoginCallbackUrl);
    expect(loginCallback.protocol).toBe("dopedb:");
    expect(loginCallback.host).toBe("auth");
    expect(loginCallback.pathname).toBe("/device-complete");
    expect(loginCallback.username).toBe("");
    expect(loginCallback.password).toBe("");
    expect(loginCallback.search).toBe("");
    expect(loginCallback.hash).toBe("");
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
    expect(shouldOverlayAgentDock({
      viewportWidth: 1_200,
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

    expect(sortedKeys(productAnalyticsGolden)).toEqual([
      "appVersion",
      "events",
      "installationId",
      "locale",
      "platform",
      "schemaVersion",
      "sessionId",
    ]);
    expect(productAnalyticsGolden.events.map((event) => event.name)).toEqual(
      Object.keys(analyticsPropertyKeys),
    );
    for (const version of [
      "0.3.98",
      "1.0.0-alpha.1+darwin-arm64",
      "999999999999999999999999.0.0",
    ]) {
      expect(isProductAnalyticsAppVersion(version), version).toBe(true);
    }
    for (const version of [
      "01.0.0",
      "1.0.0-01",
      "1.0.0+",
      "1.0.0-alpha..1",
      `1.0.0-${"--.".repeat(40)}`,
    ]) {
      expect(isProductAnalyticsAppVersion(version), version).toBe(false);
    }
    for (const event of productAnalyticsGolden.events) {
      expect(isProductAnalyticsEvent(event), event.name).toBe(true);
      expect(sortedKeys(event.properties), event.name).toEqual(
        [...analyticsPropertyKeys[event.name]].sort(),
      );
      const identityKeys = event.name === "desktop_installation_ready"
        ? []
        : event.name === "workspace_authentication_completed"
          ? ["actorKey"]
          : event.workspaceKind === "personal"
            ? ["workspaceKey", "workspaceKind"]
            : ["actorKey", "workspaceKey", "workspaceKind"];
      expect(sortedKeys(event), event.name).toEqual([
        "eventId",
        "name",
        "occurredAt",
        "properties",
        ...identityKeys,
      ].sort());
    }
    expect(productAnalyticsGolden.events[2]?.workspaceKind).toBe("personal");
    expect(
      productAnalyticsGolden.events[productAnalyticsGolden.events.length - 2]
        ?.workspaceKind,
    ).toBe("team");

    const analyticsMemory = new Map<string, string>();
    const analyticsStorage: ProductAnalyticsStorage = {
      getItem: (key) => analyticsMemory.get(key) ?? null,
      setItem: (key, value) => analyticsMemory.set(key, value),
      removeItem: (key) => analyticsMemory.delete(key),
    };
    const analyticsNow = () => Date.parse("2026-08-13T00:00:00Z");
    const analyticsStore = new ProductAnalyticsLocalStore(
      analyticsStorage,
      analyticsNow,
    );
    const analyticsEvent = (
      sessionId: string,
      eventId: string,
      consentGeneration = 0,
    ): QueuedProductAnalyticsEvent => ({
      installationId: "10000000-0000-4000-8000-000000000003",
      consentGeneration,
      sessionId,
      appVersion: "0.3.49",
      platform: "macos",
      locale: "en",
      event: {
        eventId,
        name: "desktop_installation_ready",
        occurredAt: "2026-08-13T00:00:00Z",
        properties: {},
      },
    });
    const firstAnalyticsEvent = analyticsEvent(
      "10000000-0000-4000-8000-000000000001",
      "a".repeat(64),
    );
    let installationAllocations = 0;
    const allocateInstallation = () => {
      installationAllocations += 1;
      return "10000000-0000-4000-8000-000000000003";
    };
    expect(analyticsStore.enqueue(firstAnalyticsEvent)).toBe(false);
    expect(analyticsStore.ensureInstallation(allocateInstallation)).toBeNull();
    expect(installationAllocations).toBe(0);
    expect(analyticsMemory.size).toBe(0);
    analyticsStore.applyConsent("granted", 1);
    const installation = analyticsStore.ensureInstallation(allocateInstallation);
    expect(installation?.id).toBe("10000000-0000-4000-8000-000000000003");
    if (!installation) throw new Error("analytics installation was not created");
    expect(analyticsStore.ensureInstallation(allocateInstallation)).toEqual(
      installation,
    );
    expect(installationAllocations).toBe(1);
    expect(productAnalyticsInstallationReadyInput(installation)).toMatchObject({
      name: "desktop_installation_ready",
      dedupeId: installation.id,
      properties: {},
    });
    const installationStorageEntry = [...analyticsMemory.entries()].find(
      ([, value]) => value.includes(installation.id),
    );
    if (!installationStorageEntry) {
      throw new Error("analytics installation was not persisted");
    }
    analyticsMemory.set(installationStorageEntry[0], JSON.stringify({
      id: installation.id,
      createdAt: "2026-08-13T00:00:00Z",
    }));
    const strictAnalyticsStore = new ProductAnalyticsLocalStore(
      analyticsStorage,
      analyticsNow,
    );
    strictAnalyticsStore.applyConsent("granted", 0);
    expect(strictAnalyticsStore.installation()).toBeNull();
    expect(analyticsMemory.size).toBe(0);
    expect(strictAnalyticsStore.ensureInstallation(allocateInstallation)).toEqual({
      id: installation.id,
      generation: 0,
      readyRecorded: false,
    });
    expect(strictAnalyticsStore.enqueue(analyticsEvent(
      "10000000-0000-4000-8000-000000000001",
      "018f1f7e-7b44-7cc1-8d4e-4f31b7315fe7",
    ))).toBe(false);
    expect(strictAnalyticsStore.enqueue(firstAnalyticsEvent)).toBe(true);
    expect(strictAnalyticsStore.enqueue(firstAnalyticsEvent)).toBe(true);
    expect(strictAnalyticsStore.getSnapshot().queueSize).toBe(1);
    expect(
      strictAnalyticsStore.markInstallationReadyRecorded(installation.id),
    ).toBe(true);
    expect(strictAnalyticsStore.installation()?.readyRecorded).toBe(true);
    if (firstAnalyticsEvent.event.name !== "desktop_installation_ready") {
      throw new Error("unexpected product analytics event");
    }
    (firstAnalyticsEvent.event.properties as Record<string, unknown>).sql =
      "select must-not-survive";
    const relaunchedAnalyticsStore = new ProductAnalyticsLocalStore(
      analyticsStorage,
      analyticsNow,
    );
    relaunchedAnalyticsStore.applyConsent("granted", 0);
    expect(relaunchedAnalyticsStore.installation()?.readyRecorded).toBe(true);
    expect(relaunchedAnalyticsStore.enqueue(analyticsEvent(
      "10000000-0000-4000-8000-000000000001",
      "a".repeat(64),
    ))).toBe(true);
    expect(relaunchedAnalyticsStore.getSnapshot().queueSize).toBe(1);
    const isolatedAnalyticsEvent = relaunchedAnalyticsStore.peekBatch()[0]?.event;
    if (isolatedAnalyticsEvent?.name !== "desktop_installation_ready") {
      throw new Error("queued product analytics event was not preserved");
    }
    expect(isolatedAnalyticsEvent.properties).toEqual({});
    expect(relaunchedAnalyticsStore.enqueue(analyticsEvent(
      "10000000-0000-4000-8000-000000000002",
      "b".repeat(64),
    ))).toBe(true);
    expect(
      relaunchedAnalyticsStore.peekBatch().map((item) => item.event.eventId),
    ).toEqual(["a".repeat(64)]);
    relaunchedAnalyticsStore.applyConsent("denied", 1);
    expect(relaunchedAnalyticsStore.getSnapshot()).toEqual({
      consent: "denied",
      queueSize: 0,
    });
    expect(relaunchedAnalyticsStore.installation()).toBeNull();
    expect(analyticsMemory.size).toBe(0);

    const acceptedButUnpersisted = new Map<string, string>();
    let failAcceptedRemoval = false;
    const acceptedButUnpersistedStore = new ProductAnalyticsLocalStore({
      getItem: (key) => acceptedButUnpersisted.get(key) ?? null,
      setItem: (key, value) => acceptedButUnpersisted.set(key, value),
      removeItem: (key) => {
        if (failAcceptedRemoval) throw new Error("storage unavailable");
        acceptedButUnpersisted.delete(key);
      },
    }, analyticsNow);
    acceptedButUnpersistedStore.applyConsent("granted", 1);
    acceptedButUnpersistedStore.ensureInstallation(allocateInstallation);
    expect(acceptedButUnpersistedStore.enqueue(analyticsEvent(
      "10000000-0000-4000-8000-000000000001",
      "a".repeat(64),
      1,
    ))).toBe(true);
    failAcceptedRemoval = true;
    expect(acceptedButUnpersistedStore.removeEvents(["a".repeat(64)])).toBe(false);
    expect(acceptedButUnpersistedStore.getSnapshot().queueSize).toBe(0);
    expect(acceptedButUnpersisted.size).toBeGreaterThan(0);
    failAcceptedRemoval = false;
    const expiredAnalyticsStore = new ProductAnalyticsLocalStore({
      getItem: (key) => acceptedButUnpersisted.get(key) ?? null,
      setItem: (key, value) => acceptedButUnpersisted.set(key, value),
      removeItem: (key) => acceptedButUnpersisted.delete(key),
    }, () => Date.parse("2026-08-21T00:00:00Z"));
    expiredAnalyticsStore.applyConsent("granted", 1);
    expect(expiredAnalyticsStore.getSnapshot().queueSize).toBe(0);
    expect([...acceptedButUnpersisted.values()].some(
      (value) => value.includes('"eventId"'),
    )).toBe(false);

    const revocationMemory = new Map<string, string>();
    let failPrivateRemoval = false;
    const revocationStorage: ProductAnalyticsStorage = {
      getItem: (key) => revocationMemory.get(key) ?? null,
      setItem: (key, value) => revocationMemory.set(key, value),
      removeItem: (key) => {
        if (failPrivateRemoval) throw new Error("storage unavailable");
        revocationMemory.delete(key);
      },
    };
    const revocationStore = new ProductAnalyticsLocalStore(
      revocationStorage,
      analyticsNow,
    );
    revocationStore.applyConsent("granted", 1);
    const preRevocation = revocationStore.ensureInstallation(
      () => "10000000-0000-4000-8000-000000000004",
    );
    expect(preRevocation?.generation).toBe(1);
    failPrivateRemoval = true;
    expect(revocationStore.beginRevocation()).toBe(false);
    expect(revocationStore.revocationPending()).toBe(true);
    const restartedDuringRevocation = new ProductAnalyticsLocalStore(
      revocationStorage,
      analyticsNow,
    );
    expect(restartedDuringRevocation.applyConsent("granted", 1)).toBe(false);
    expect(restartedDuringRevocation.installation()).toBeNull();
    failPrivateRemoval = false;
    restartedDuringRevocation.applyConsent("denied", 2);
    expect(restartedDuringRevocation.completeRevocation()).toBe(true);
    expect(restartedDuringRevocation.applyConsent("granted", 3)).toBe(true);
    const postRevocation = restartedDuringRevocation.ensureInstallation(
      () => "10000000-0000-4000-8000-000000000005",
    );
    expect(postRevocation).toMatchObject({
      id: "10000000-0000-4000-8000-000000000005",
      generation: 3,
    });
    expect(postRevocation?.id).not.toBe(preRevocation?.id);
    expect(productAnalyticsRetryDelay(60_000, 0, 0)).toBe(60_000);
    expect(productAnalyticsRetryDelay(60_000, 0, 1)).toBe(72_000);
    expect(productAnalyticsRetryDelay(0, 0, 0)).toBe(1_000);
    expect(productAnalyticsRetryIsBlocked(5_000, 60_000)).toBe(true);
    expect(productAnalyticsRetryIsBlocked(60_000, 60_000)).toBe(false);

    const pressureMemory = new Map<string, string>();
    const pressureStore = new ProductAnalyticsLocalStore({
      getItem: (key) => pressureMemory.get(key) ?? null,
      setItem: (key, value) => pressureMemory.set(key, value),
      removeItem: (key) => pressureMemory.delete(key),
    }, analyticsNow);
    pressureStore.applyConsent("granted", 1);
    pressureStore.ensureInstallation(
      () => "10000000-0000-4000-8000-000000000003",
    );
    const pressureInstallation = analyticsEvent(
      "10000000-0000-4000-8000-000000000001",
      "d".repeat(64),
      1,
    );
    const pressureScope: QueuedProductAnalyticsEvent = {
      ...pressureInstallation,
      event: {
        eventId: "e".repeat(64),
        name: "workspace_scope_ready",
        occurredAt: "2026-08-13T00:00:00Z",
        workspaceKey: "f".repeat(64),
        workspaceKind: "personal",
        properties: {},
      },
    };
    expect(pressureStore.enqueue(pressureInstallation)).toBe(true);
    expect(pressureStore.enqueue(pressureScope)).toBe(true);
    for (let index = 0; index < 120; index += 1) {
      expect(pressureStore.enqueue({
        ...pressureInstallation,
        event: {
          eventId: (index + 16).toString(16).padStart(64, "0"),
          name: "query_execution_completed",
          occurredAt: "2026-08-13T00:00:00Z",
          workspaceKey: "f".repeat(64),
          workspaceKind: "personal",
          properties: {
            outcome: "success",
            statementClass: "select",
            rowCountBucket: "zero",
            durationBucket: "under_100ms",
            approvalRequired: false,
          },
        },
      })).toBe(true);
    }
    expect(pressureStore.getSnapshot().queueSize).toBe(100);
    expect(pressureStore.peekBatch().map((item) => item.event.name)).toEqual(
      expect.arrayContaining([
        "desktop_installation_ready",
        "workspace_scope_ready",
      ]),
    );

    const analyticsWorkspaceId = "20000000-0000-4000-8000-000000000001";
    const analyticsActorId = "20000000-0000-4000-8000-000000000002";
    expect(sharedWorkspaceScopeAvailable({
      workspaceKind: "personal",
      accountScope: analyticsActorId,
    })).toBe(false);
    expect(sharedWorkspaceScopeAvailable({
      workspaceKind: "team",
      accountScope: null,
    })).toBe(false);
    expect(sharedWorkspaceScopeAvailable({
      workspaceKind: "team",
      accountScope: analyticsActorId,
    })).toBe(true);
    const scopeClient = new QueryClient();
    const signedInScope = workspaceContext(analyticsWorkspaceId);
    scopeClient.setQueryData(workspaceQueries.workspaceQueryKeys.auth(), {
      authenticated: true,
      user: { id: accountId(analyticsActorId), email: "member@dopedb.example", displayName: "Member" },
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
    expect(localScope.key).toContain(`account:${analyticsActorId}`);
    expect(queryServiceSessionProjection(localScope, localScope.key)).toBe("memory");
    scopeClient.setQueryData(workspaceQueries.workspaceQueryKeys.context(), signedInScope);
    const teamScope = renderScope();
    expect(teamScope.accountScope).toBe(analyticsActorId);
    expect(queryServiceSessionProjection(teamScope, teamScope.key)).toBe("persistent");
    scopeClient.clear();
    const personalAnalyticsContext = productAnalyticsWorkspaceContext({
      key: "personal-ready",
      ready: true,
      workspaceId: analyticsWorkspaceId,
      accountScope: null,
      workspaceKind: "personal",
    });
    expect(personalAnalyticsContext).toEqual({
      workspaceId: analyticsWorkspaceId,
      workspaceKind: "personal",
    });
    expect(productAnalyticsWorkspaceContext({
      key: "team-not-ready",
      ready: false,
      workspaceId: analyticsWorkspaceId,
      accountScope: analyticsActorId,
      workspaceKind: "team",
    })).toBeNull();
    expect(productAnalyticsWorkspaceContext({
      key: "team-missing-actor",
      ready: true,
      workspaceId: analyticsWorkspaceId,
      accountScope: null,
      workspaceKind: "team",
    })).toBeNull();
    expect(productAnalyticsWorkspaceContext({
      key: "team-ready",
      ready: true,
      workspaceId: analyticsWorkspaceId,
      accountScope: analyticsActorId,
      workspaceKind: "team",
    })).toEqual({
      workspaceId: analyticsWorkspaceId,
      workspaceKind: "team",
      actorId: analyticsActorId,
    });
    expect([
      productAnalyticsDurationBucket(-1),
      productAnalyticsDurationBucket(99),
      productAnalyticsDurationBucket(100),
      productAnalyticsDurationBucket(1_000),
      productAnalyticsDurationBucket(10_000),
      productAnalyticsDurationBucket(60_000),
    ]).toEqual([
      "unknown",
      "under_100ms",
      "100ms_1s",
      "1s_10s",
      "10s_60s",
      "over_60s",
    ]);
    expect([
      productAnalyticsRowCountBucket(-1),
      productAnalyticsRowCountBucket(0),
      productAnalyticsRowCountBucket(1),
      productAnalyticsRowCountBucket(10),
      productAnalyticsRowCountBucket(100),
      productAnalyticsRowCountBucket(1_000),
      productAnalyticsRowCountBucket(1_001),
    ]).toEqual([
      "unknown",
      "zero",
      "one",
      "2_10",
      "11_100",
      "101_1000",
      "over_1000",
    ]);
    expect(productAnalyticsStatementClass(
      " /* leading ; comment */ -- another comment\n SELECT ';'",
    )).toBe("select");
    expect(productAnalyticsStatementClass("EXPLAIN SELECT 1")).toBe("explain");
    expect(productAnalyticsStatementClass("# comment\n SHOW TABLES")).toBe("show");
    expect(productAnalyticsStatementClass(
      "WITH changed AS (DELETE FROM sample RETURNING *) SELECT * FROM changed",
    )).toBe("write");
    expect(productAnalyticsStatementClass(
      "WITH sample AS (SELECT 1) SELECT * FROM sample",
    )).toBe("select");
    expect(productAnalyticsStatementClass(
      "SELECT ';'; /* separator ; */ SELECT 2",
    )).toBe("script");
    expect(productAnalyticsConnectionEngine("sqlite")).toBe("sqlite");
    expect(productAnalyticsAccessMode("memberLocal")).toBe("local");
    expect(productAnalyticsAccessMode("managed")).toBe("managed");
    expect(productAnalyticsCredentialMode(null)).toBe("none");
    expect(productAnalyticsCredentialMode("local")).toBe("local");
    expect(productAnalyticsCredentialMode("managed")).toBe("managed");
    const validQueryAnalyticsInput = {
      name: "query_execution_completed",
      properties: {
        outcome: "success",
        statementClass: "select",
        rowCountBucket: "one",
        durationBucket: "under_100ms",
        approvalRequired: false,
      },
      context: personalAnalyticsContext,
    } as const;
    expect(isProductAnalyticsEventInput(validQueryAnalyticsInput)).toBe(true);
    expect(isProductAnalyticsEventInput({
      ...validQueryAnalyticsInput,
      properties: {
        ...validQueryAnalyticsInput.properties,
        sql: "SELECT private_value",
      },
    })).toBe(false);
    expect(isProductAnalyticsEventInput({
      ...validQueryAnalyticsInput,
      error: "private error detail",
    })).toBe(false);

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
