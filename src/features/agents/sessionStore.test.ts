import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tauriAdapter", () => ({
  listAgentAcpSessions: vi.fn(),
  onAgentAcpChanged: vi.fn(),
}));

import type {
  AcpSessionChanged,
  AcpSessionEvent,
  AcpSessionSummary,
  AgentKnowledgeScope,
} from "./domain";
import { buildAcpArticleContext } from "./useAcpComposerContext";
import { listAgentAcpSessions, onAgentAcpChanged } from "./tauriAdapter";
import {
  AcpSessionStore,
  mergeAcpSessionSummaries,
} from "./sessionStore";
import {
  isCurrentAcpFocusRequest,
  ownsStartedAcpSession,
} from "./sessionFocus";

function session(
  id: string,
  updatedAt = "2026-08-13T00:00:00.000Z",
): AcpSessionSummary {
  return {
    id: id as AcpSessionSummary["id"],
    connectionId: "11111111-1111-4111-8111-111111111111" as AcpSessionSummary["connectionId"],
    provider: "codex",
    title: id,
    lifecycle: "running",
    acpSessionId: id,
    knowledgeScopes: [],
    writeConnectionId: null,
    error: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt,
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function messageEvent(
  id: string,
  sequence: number,
  text: string,
): AcpSessionEvent {
  return {
    sessionId: id as AcpSessionEvent["sessionId"],
    sequence,
    createdAt: "2026-08-13T00:00:00.000Z",
    type: "userMessage",
    text,
    attachments: [],
  };
}

describe("ACP session store", () => {
  const list = vi.mocked(listAgentAcpSessions);
  const listen = vi.mocked(onAgentAcpChanged);
  let change: ((event: AcpSessionChanged) => void) | null;
  let unlisten: () => void;
  let unlistenCalls: number;

  beforeEach(() => {
    list.mockReset();
    listen.mockReset();
    change = null;
    unlistenCalls = 0;
    unlisten = () => {
      unlistenCalls += 1;
    };
    listen.mockImplementation(async (listener) => {
      change = listener;
      return unlisten;
    });
    list.mockResolvedValue([]);
  });

  it("preserves observed sessions and accepts only owned focus results", () => {
    const prior: readonly AcpSessionSummary[] = [];
    const merged = mergeAcpSessionSummaries(prior, [session("one")]);
    expect(merged).toHaveLength(1);
    expect(prior).toHaveLength(0);
    const selected = session("one").id;
    const request = {
      requestId: 4,
      scopeKey: "workspace:a",
      selectionGeneration: 2,
      selectedSessionId: selected,
    };
    expect(isCurrentAcpFocusRequest(request, request)).toBe(true);
    expect(isCurrentAcpFocusRequest(request, {
      ...request,
      requestId: 5,
      selectionGeneration: 3,
      selectedSessionId: session("two").id,
    })).toBe(false);
    const startRequest = {
      ...request,
      selectedSessionId: null,
    };
    expect(ownsStartedAcpSession(startRequest, {
      ...startRequest,
      selectionGeneration: startRequest.selectionGeneration + 1,
      selectedSessionId: selected,
    }, selected)).toBe(true);
    expect(ownsStartedAcpSession(startRequest, {
      ...startRequest,
      scopeKey: "workspace:b",
      selectionGeneration: startRequest.selectionGeneration + 1,
      selectedSessionId: selected,
    }, selected)).toBe(false);
    expect(ownsStartedAcpSession(startRequest, {
      ...startRequest,
      selectionGeneration: startRequest.selectionGeneration + 1,
      selectedSessionId: session("two").id,
    }, selected)).toBe(false);
    const article = {
      id: "article-one", revision: 3, projectEnvironmentId: "environment-one",
      environmentRevision: 2, connectionId: "remote-one", connectionRevision: 4,
      definition: { title: "Conversion analysis" },
    };
    const grant: AgentKnowledgeScope = {
      projectId: "project-one", projectEnvironmentId: article.projectEnvironmentId,
      environmentRevision: article.environmentRevision, knowledgeGrantId: null,
      authorityConnectionId: session("one").connectionId, authorityConnectionRevision: 1,
      sources: [], graphRevisionIds: [],
      connections: [{
        connectionId: session("one").connectionId, connectionRevision: 1,
        remoteConnectionId: article.connectionId, connectionContentRevision: article.connectionRevision,
        role: "primary", alias: "Analysis database",
      }],
    };
    const context = buildAcpArticleContext(article, [grant]);
    expect(context?.connectionId).toBe(grant.connections[0].connectionId);
    expect(JSON.parse(context!.documentText!)).toEqual({
      kind: "analysis_article", articleId: article.id, revision: article.revision,
      title: article.definition.title, projectEnvironmentId: article.projectEnvironmentId,
    });
    expect(context?.table).toBeNull();
    expect(buildAcpArticleContext(article, [])).toBeNull();
    expect(buildAcpArticleContext(article, [{ ...grant, connections: [] }])).toBeNull();
    expect(buildAcpArticleContext({ ...article, connectionId: "remote-other" }, [grant])).toBeNull();
    expect(buildAcpArticleContext({ ...article, connectionRevision: 5 }, [grant])).toBeNull();
    expect(buildAcpArticleContext({ ...article, environmentRevision: 3 }, [grant])).toBeNull();
    expect(buildAcpArticleContext({ ...article, projectEnvironmentId: "environment-other" }, [grant])).toBeNull();
  });

  it("rejects an older event for the same exact session", () => {
    const current = session("one", "2026-08-13T00:00:02.000Z");
    const merged = mergeAcpSessionSummaries(
      [current],
      [session("one", "2026-08-13T00:00:01.000Z")],
    );
    expect(merged).toEqual([current]);
  });

  it("retains independent session identities", () => {
    expect(mergeAcpSessionSummaries([session("one")], [session("two")]))
      .toHaveLength(2);
  });

  it("registers one listener before reading the initial snapshot", async () => {
    const store = new AcpSessionStore();
    const observedLiveChanges: AcpSessionChanged[] = [];
    const stopObservingLiveChanges = store.observeLiveChanges((event) => {
      observedLiveChanges.push(event);
    });
    store.activate("workspace:a");
    await settle();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    const focused = session("focused");
    expect(store.recordFocus("workspace:a", {
      session: focused,
      events: [messageEvent("focused", 1, "focused replay")],
      replayTruncated: false,
    })).toBe(true);
    expect(store.getSnapshot().projections.get(focused.id)?.items).toEqual([
      expect.objectContaining({ kind: "user", text: "focused replay" }),
    ]);
    expect(observedLiveChanges).toEqual([]);

    for (let index = 1; index <= 15; index += 1) {
      const candidate = session(`cached-${index}`);
      store.recordFocus("workspace:a", {
        session: candidate,
        events: [messageEvent(candidate.id, 1, `replay ${index}`)],
        replayTruncated: false,
      });
    }
    store.recordFocus("workspace:a", {
      session: focused,
      events: [messageEvent("focused", 1, "focused replay")],
      replayTruncated: false,
    });
    const overflow = session("overflow");
    store.recordFocus("workspace:a", {
      session: overflow,
      events: [messageEvent(overflow.id, 1, "overflow replay")],
      replayTruncated: false,
    });
    expect(store.getSnapshot().projections.size).toBe(16);
    expect(store.getSnapshot().projections.has(session("cached-1").id)).toBe(
      false,
    );
    expect(store.getSnapshot().projections.has(focused.id)).toBe(true);

    const eventTouched = session("cached-2");
    change?.({
      session: eventTouched,
      event: messageEvent(eventTouched.id, 2, "live event"),
    });
    expect(observedLiveChanges).toEqual([
      expect.objectContaining({ session: eventTouched }),
    ]);
    await settle();
    const secondOverflow = session("second-overflow");
    store.recordFocus("workspace:a", {
      session: secondOverflow,
      events: [messageEvent(secondOverflow.id, 1, "second overflow replay")],
      replayTruncated: false,
    });
    expect(store.getSnapshot().projections.size).toBe(16);
    expect(store.getSnapshot().projections.has(session("cached-2").id)).toBe(true);
    expect(store.getSnapshot().projections.has(session("cached-3").id)).toBe(false);
    stopObservingLiveChanges();
    change?.({
      session: eventTouched,
      event: messageEvent(eventTouched.id, 3, "unobserved live event"),
    });
    expect(observedLiveChanges).toHaveLength(1);
  });

  it("does not duplicate the listener for the same scope generation", async () => {
    const store = new AcpSessionStore();
    store.activate("workspace:a");
    store.activate("workspace:a");
    await settle();
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("clears the old account sessions synchronously on a scope change", async () => {
    list.mockResolvedValueOnce([session("private")]);
    const store = new AcpSessionStore();
    store.activate("workspace:a");
    await settle();
    store.activate("workspace:b");
    expect(store.getSnapshot()).toMatchObject({
      scopeKey: "workspace:b",
      sessions: [],
      loading: true,
    });
    expect(store.recordFocus("workspace:a", {
      session: session("private"),
      events: [messageEvent("private", 1, "old workspace")],
      replayTruncated: false,
    })).toBe(false);
    expect(store.getSnapshot().projections.size).toBe(0);
    expect(unlistenCalls).toBe(1);
  });

  it("keeps a newer event that races ahead of the initial list response", async () => {
    let resolveList: (sessions: AcpSessionSummary[]) => void = () => {
      throw new Error("initial session list was not requested");
    };
    list.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    const store = new AcpSessionStore();
    store.activate("workspace:a");
    await Promise.resolve();
    change?.({
      session: session("event", "2026-08-13T00:00:02.000Z"),
      event: messageEvent("event", 1, "newer event"),
    });
    await settle();
    expect(store.getSnapshot()).toMatchObject({
      sessions: [expect.objectContaining({ id: "event" })],
      loading: true,
      error: null,
    });
    const eventSession = session("event", "2026-08-13T00:00:02.000Z");
    expect(store.getSnapshot().projections.get(eventSession.id)?.items)
      .toEqual([expect.objectContaining({ kind: "user", text: "newer event" })]);
    resolveList([session("event", "2026-08-13T00:00:01.000Z")]);
    await settle();
    expect(store.getSnapshot().sessions).toEqual([
      session("event", "2026-08-13T00:00:02.000Z"),
    ]);
  });

  it("surfaces an inventory failure without retaining a prior scope and can retry", async () => {
    list.mockRejectedValueOnce(new Error("denied"));
    const store = new AcpSessionStore();
    store.activate("workspace:a");
    await settle();
    expect(store.getSnapshot()).toMatchObject({
      scopeKey: "workspace:a",
      sessions: [],
      loading: false,
    });
    expect(store.getSnapshot().error).toEqual(new Error("denied"));
    change?.({
      session: session("partial-event"),
      event: null,
    });
    await settle();
    expect(store.getSnapshot()).toMatchObject({
      sessions: [expect.objectContaining({ id: "partial-event" })],
      error: new Error("denied"),
    });
    list.mockResolvedValueOnce([session("recovered")]);
    store.activate("workspace:a");
    await settle();
    expect(store.getSnapshot()).toMatchObject({
      scopeKey: "workspace:a",
      sessions: [expect.objectContaining({ id: "recovered" })],
      loading: false,
      error: null,
    });
    expect(listen).toHaveBeenCalledTimes(2);
  });
});
