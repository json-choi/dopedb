// Projects ACP events into a bounded transcript with replay reconciliation and compaction.

import type {
  AcpSessionLifecycle,
  AcpSessionConfigOption,
  AcpSessionEvent,
} from "./domain";

const MAX_RECENT_EVENTS = 1_024;
const MAX_RECENT_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSCRIPT_ITEMS = 320;
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const COMPACTED_TEXT_BYTES = 3 * 1024 * 1024;
const COMPACT_PREFIX_AT = 256;
const MAX_ACTIVITY_TEXT_CHARS = 512;

type VersionedTranscriptItem = {
  key: string;
  revision: number;
};

export type AcpTranscriptItem = VersionedTranscriptItem &
  (
    | {
        kind: "user";
        text: string;
        attachments: string[];
      }
    | {
        kind: "agent" | "thought";
        messageId: string | null;
        chunks: string[];
        activityText: string;
      }
    | {
        kind: "tool";
        toolCallId: string;
        data: Record<string, unknown>;
      }
    | {
        kind: "permission";
        event: Extract<AcpSessionEvent, { type: "permissionRequest" }>;
      }
    | {
        kind: "plan";
        data: Record<string, unknown>;
      }
    | {
        kind: "error";
        message: string;
      }
    | {
        kind: "turnEnd";
        stopReason: string;
      }
  );

export function closedBeforeTurnCompleted(
  lifecycle: AcpSessionLifecycle,
  error: string | null,
  items: readonly Pick<AcpTranscriptItem, "kind">[],
) {
  if (lifecycle !== "closed" || error !== null) return false;
  let lastUserIndex = -1;
  let lastTurnEndIndex = -1;
  items.forEach((item, index) => {
    if (item.kind === "user") lastUserIndex = index;
    if (item.kind === "turnEnd") lastTurnEndIndex = index;
  });
  return lastUserIndex > lastTurnEndIndex;
}

/**
 * Mutable, revision-signalled ACP projection.
 *
 * Live events append into bounded arrays in place. React observes `revision`,
 * while completed transcript item identities stay stable so their Markdown is
 * not parsed again. Full reconciliation and sorting are reserved for focus or
 * an exceptional out-of-order replay.
 */
export interface AcpConversationProjection {
  revision: number;
  lastSequence: number;
  replayTruncated: boolean;
  configOptions: AcpSessionConfigOption[];
  pendingPermissionId: string | null;
  items: AcpTranscriptItem[];
  itemBytes: number[];
  itemStart: number;
  transcriptBytes: number;
  toolIndex: Map<string, number>;
  recentEvents: AcpSessionEvent[];
  recentEventBytes: number[];
  recentStart: number;
  recentBytes: number;
  recentSequences: Set<number>;
}

export function createAcpConversationProjection(
  events: AcpSessionEvent[],
  replayTruncated = false,
): AcpConversationProjection {
  const projection = emptyProjection(replayTruncated);
  for (const event of reconcileEvents(events)) {
    appendMonotonicEvent(projection, event);
  }
  projection.revision = events.length > 0 ? 1 : 0;
  return projection;
}

export function mergeAcpConversationFocus(
  current: AcpConversationProjection | undefined,
  events: AcpSessionEvent[],
  replayTruncated: boolean,
): AcpConversationProjection {
  if (!current) {
    return createAcpConversationProjection(events, replayTruncated);
  }
  const recent = current.recentEvents.slice(current.recentStart);
  return createAcpConversationProjection(
    [...events, ...recent],
    replayTruncated || current.replayTruncated,
  );
}

export function appendAcpConversationEvents(
  current: AcpConversationProjection | undefined,
  events: AcpSessionEvent[],
): { projection: AcpConversationProjection; changed: boolean } {
  let projection = current ?? emptyProjection(false);
  let changed = false;

  for (const event of events) {
    if (event.sequence <= projection.lastSequence) {
      if (projection.recentSequences.has(event.sequence)) continue;
      const earliest = projection.recentEvents[projection.recentStart]?.sequence;
      if (earliest !== undefined && event.sequence < earliest) continue;
      projection = createAcpConversationProjection(
        [...projection.recentEvents.slice(projection.recentStart), event],
        projection.replayTruncated,
      );
      changed = true;
      continue;
    }
    appendMonotonicEvent(projection, event);
    changed = true;
  }

  if (changed) projection.revision += 1;
  return { projection, changed };
}

export function visibleAcpTranscriptItems(
  projection: AcpConversationProjection | undefined,
): AcpTranscriptItem[] {
  return projection?.items.slice(projection.itemStart) ?? [];
}

function emptyProjection(replayTruncated: boolean): AcpConversationProjection {
  return {
    revision: 0,
    lastSequence: 0,
    replayTruncated,
    configOptions: [],
    pendingPermissionId: null,
    items: [],
    itemBytes: [],
    itemStart: 0,
    transcriptBytes: 0,
    toolIndex: new Map(),
    recentEvents: [],
    recentEventBytes: [],
    recentStart: 0,
    recentBytes: 0,
    recentSequences: new Set(),
  };
}

function appendMonotonicEvent(
  projection: AcpConversationProjection,
  event: AcpSessionEvent,
) {
  projection.lastSequence = event.sequence;
  appendRecentEvent(projection, event);
  projectEvent(projection, event);
}

function appendRecentEvent(
  projection: AcpConversationProjection,
  event: AcpSessionEvent,
) {
  const bytes = approximateEventBytes(event);
  projection.recentEvents.push(event);
  projection.recentEventBytes.push(bytes);
  projection.recentBytes += bytes;
  projection.recentSequences.add(event.sequence);

  while (
    projection.recentEvents.length - projection.recentStart > MAX_RECENT_EVENTS ||
    projection.recentBytes > MAX_RECENT_EVENT_BYTES
  ) {
    const removed = projection.recentEvents[projection.recentStart];
    if (!removed) break;
    projection.recentSequences.delete(removed.sequence);
    projection.recentBytes -=
      projection.recentEventBytes[projection.recentStart] ?? 0;
    projection.recentStart += 1;
  }

  if (
    projection.recentStart >= COMPACT_PREFIX_AT &&
    projection.recentStart * 2 >= projection.recentEvents.length
  ) {
    projection.recentEvents = projection.recentEvents.slice(
      projection.recentStart,
    );
    projection.recentEventBytes = projection.recentEventBytes.slice(
      projection.recentStart,
    );
    projection.recentStart = 0;
  }
}

function projectEvent(
  projection: AcpConversationProjection,
  event: AcpSessionEvent,
) {
  const key = `${event.sessionId}:${event.sequence}`;
  if (event.type === "userMessage") {
    collapseTailTextChunks(projection);
    appendItem(projection, {
      kind: "user",
      key,
      revision: 0,
      text: event.text,
      attachments: event.attachments,
    });
    return;
  }
  if (event.type === "sessionConfiguration") {
    projection.configOptions = Array.isArray(event.configOptions)
      ? event.configOptions
      : [];
    return;
  }
  if (event.type === "permissionRequest") {
    collapseTailTextChunks(projection);
    projection.pendingPermissionId = event.requestId;
    appendItem(projection, {
      kind: "permission",
      key,
      revision: 0,
      event,
    });
    return;
  }
  if (event.type === "permissionResponse") {
    if (projection.pendingPermissionId === event.requestId) {
      projection.pendingPermissionId = null;
    }
    return;
  }
  if (event.type === "error") {
    collapseTailTextChunks(projection);
    appendItem(projection, {
      kind: "error",
      key,
      revision: 0,
      message: event.message,
    });
    return;
  }
  if (event.type === "turnEnd") {
    collapseTailTextChunks(projection);
    appendItem(projection, {
      kind: "turnEnd",
      key,
      revision: 0,
      stopReason: event.stopReason,
    });
    return;
  }
  if (event.type !== "sessionUpdate") return;

  const update = event.update;
  const kind = recordString(update, "sessionUpdate");
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const text = contentText(update.content);
    if (!text) return;
    appendTextChunk(
      projection,
      kind === "agent_message_chunk" ? "agent" : "thought",
      key,
      recordString(update, "messageId"),
      text,
    );
    return;
  }
  if (kind === "tool_call") {
    collapseTailTextChunks(projection);
    const toolCallId = recordString(update, "toolCallId") ?? key;
    const index = appendItem(projection, {
      kind: "tool",
      key,
      revision: 0,
      toolCallId,
      data: update,
    });
    projection.toolIndex.set(toolCallId, index);
    return;
  }
  if (kind === "tool_call_update") {
    collapseTailTextChunks(projection);
    const toolCallId = recordString(update, "toolCallId") ?? key;
    const index = projection.toolIndex.get(toolCallId);
    const previous = index === undefined ? undefined : projection.items[index];
    if (index !== undefined && previous?.kind === "tool") {
      replaceItem(projection, index, {
        ...previous,
        revision: previous.revision + 1,
        data: { ...previous.data, ...update },
      });
    } else {
      const nextIndex = appendItem(projection, {
        kind: "tool",
        key,
        revision: 0,
        toolCallId,
        data: update,
      });
      projection.toolIndex.set(toolCallId, nextIndex);
    }
    return;
  }
  if (kind === "plan") {
    collapseTailTextChunks(projection);
    appendItem(projection, {
      kind: "plan",
      key,
      revision: 0,
      data: update,
    });
  }
}

function appendTextChunk(
  projection: AcpConversationProjection,
  kind: "agent" | "thought",
  key: string,
  messageId: string | null,
  text: string,
) {
  const index = projection.items.length - 1;
  const previous = projection.items[index];
  if (
    previous &&
    previous.kind === kind &&
    (messageId === null || previous.messageId === messageId)
  ) {
    previous.chunks.push(text);
    replaceItem(projection, index, {
      ...previous,
      revision: previous.revision + 1,
      activityText: `${previous.activityText}${text}`.slice(
        -MAX_ACTIVITY_TEXT_CHARS,
      ),
    }, utf16Bytes(text));
    compactOversizedTailText(projection);
    return;
  }
  collapseTailTextChunks(projection);
  appendItem(projection, {
    kind,
    key,
    revision: 0,
    messageId,
    chunks: [text],
    activityText: text.slice(-MAX_ACTIVITY_TEXT_CHARS),
  });
  compactOversizedTailText(projection);
}

function collapseTailTextChunks(projection: AcpConversationProjection) {
  const index = projection.items.length - 1;
  const previous = projection.items[index];
  if (
    !previous ||
    (previous.kind !== "agent" && previous.kind !== "thought") ||
    previous.chunks.length <= 1
  ) {
    return;
  }
  replaceItem(projection, index, {
    ...previous,
    revision: previous.revision + 1,
    chunks: [previous.chunks.join("")],
  });
}

function compactOversizedTailText(projection: AcpConversationProjection) {
  if (projection.transcriptBytes <= MAX_TRANSCRIPT_BYTES) return;
  const index = projection.items.length - 1;
  const previous = projection.items[index];
  if (!previous || (previous.kind !== "agent" && previous.kind !== "thought")) {
    return;
  }
  const maxChars = Math.floor(COMPACTED_TEXT_BYTES / 2);
  const text = previous.chunks.join("").slice(-maxChars);
  replaceItem(projection, index, {
    ...previous,
    revision: previous.revision + 1,
    chunks: [text],
    activityText: text.slice(-MAX_ACTIVITY_TEXT_CHARS),
  });
  projection.replayTruncated = true;
}

function appendItem(
  projection: AcpConversationProjection,
  item: AcpTranscriptItem,
): number {
  const bytes = transcriptItemBytes(item);
  projection.items.push(item);
  projection.itemBytes.push(bytes);
  projection.transcriptBytes += bytes;
  trimTranscript(projection);
  return projection.items.length - 1;
}

function replaceItem(
  projection: AcpConversationProjection,
  index: number,
  item: AcpTranscriptItem,
  appendedBytes?: number,
) {
  const previousBytes = projection.itemBytes[index] ?? 0;
  const nextBytes = appendedBytes === undefined
    ? transcriptItemBytes(item)
    : previousBytes + appendedBytes;
  projection.items[index] = item;
  projection.itemBytes[index] = nextBytes;
  projection.transcriptBytes += nextBytes - previousBytes;
  trimTranscript(projection);
}

function trimTranscript(projection: AcpConversationProjection) {
  while (
    projection.itemStart < projection.items.length - 1 &&
    (projection.items.length - projection.itemStart > MAX_TRANSCRIPT_ITEMS ||
      projection.transcriptBytes > MAX_TRANSCRIPT_BYTES)
  ) {
    const removed = projection.items[projection.itemStart];
    if (removed?.kind === "tool") {
      projection.toolIndex.delete(removed.toolCallId);
    }
    projection.transcriptBytes -=
      projection.itemBytes[projection.itemStart] ?? 0;
    projection.itemStart += 1;
    projection.replayTruncated = true;
  }

  if (
    projection.itemStart >= COMPACT_PREFIX_AT &&
    projection.itemStart * 2 >= projection.items.length
  ) {
    projection.items = projection.items.slice(projection.itemStart);
    projection.itemBytes = projection.itemBytes.slice(projection.itemStart);
    projection.itemStart = 0;
    projection.toolIndex.clear();
    projection.items.forEach((item, index) => {
      if (item.kind === "tool") projection.toolIndex.set(item.toolCallId, index);
    });
  }
}

function reconcileEvents(events: AcpSessionEvent[]): AcpSessionEvent[] {
  return [...new Map(events.map((event) => [event.sequence, event])).values()]
    .sort((left, right) => left.sequence - right.sequence);
}

function approximateEventBytes(event: AcpSessionEvent): number {
  if (event.type === "sessionUpdate") {
    const text = contentText(event.update.content);
    if (text !== null) return 128 + utf16Bytes(text);
  }
  try {
    return utf16Bytes(JSON.stringify(event));
  } catch {
    return 512 * 1024;
  }
}

function transcriptItemBytes(item: AcpTranscriptItem): number {
  if (item.kind === "user") {
    return utf16Bytes(item.text) + item.attachments.reduce(
      (total, attachment) => total + utf16Bytes(attachment),
      0,
    );
  }
  if (item.kind === "agent" || item.kind === "thought") {
    return item.chunks.reduce(
      (total, chunk) => total + utf16Bytes(chunk),
      0,
    );
  }
  if (item.kind === "error") return utf16Bytes(item.message);
  if (item.kind === "turnEnd") return utf16Bytes(item.stopReason);
  try {
    return utf16Bytes(JSON.stringify(item));
  } catch {
    return 512 * 1024;
  }
}

function utf16Bytes(value: string): number {
  return value.length * 2;
}

function recordString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}

function contentText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  return block.type === "text" && typeof block.text === "string"
    ? block.text
    : null;
}
