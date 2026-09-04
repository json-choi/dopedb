// Native app settings own consent. This store persists only the pseudonymous
// installation identity and bounded retry queue, and will expose neither until
// the native consent status has been applied for this process.
import type {
  ProductAnalyticsConsent,
  ProductAnalyticsEventInput,
  ProductEventName,
  QueuedProductAnalyticsEvent,
} from "./domain";
import {
  isProductAnalyticsUuid,
  isQueuedProductAnalyticsEvent,
  PRODUCT_ANALYTICS_MAX_AGE_MS,
  PRODUCT_ANALYTICS_MAX_BATCH,
  PRODUCT_ANALYTICS_MAX_QUEUE,
} from "./domain";

const INSTALLATION_KEY = "dopedb:product-analytics:installation:v1";
const QUEUE_KEY = "dopedb:product-analytics:queue:v1";
const REVOCATION_PENDING_KEY = "dopedb:product-analytics:revocation-pending:v1";
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_CONSENT_GENERATION = 0xffff_ffff;
const MAX_RESERVED_MILESTONES = 32;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 5 * 60_000;
const RETRY_SERVER_MAX_MS = 18 * 60_000;
const HIGH_VOLUME_OUTCOMES = new Set<ProductEventName>([
  "query_execution_completed",
  "agent_turn_completed",
]);

export type ProductAnalyticsStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type InstallationRecord = {
  id: string;
  generation: number;
  readyRecorded: boolean;
};

export type ProductAnalyticsLocalSnapshot = {
  consent: ProductAnalyticsConsent;
  queueSize: number;
};

export function productAnalyticsRetryDelay(
  retryAfterMs: number | undefined,
  attempt: number,
  random: number,
) {
  const serverMinimum = retryAfterMs === undefined
    ? undefined
    : Math.max(1_000, retryAfterMs);
  return retryAfterMs === undefined
    ? Math.max(250, Math.min(
        Math.round(
          RETRY_BASE_MS * 2 ** Math.min(attempt, 10) *
            (0.8 + random * 0.4),
        ),
        RETRY_MAX_MS,
      ))
    : Math.max(serverMinimum ?? 1_000, Math.min(
        Math.round((serverMinimum ?? 1_000) * (1 + random * 0.2)),
        RETRY_SERVER_MAX_MS,
      ));
}

export function productAnalyticsRetryIsBlocked(now: number, notBefore: number) {
  return now < notBefore;
}

type Listener = () => void;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(storage: ProductAnalyticsStorage | null, key: string) {
  if (!storage) return null;
  try {
    const value = storage.getItem(key);
    return value === null ? null : JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeInstallation(value: unknown): InstallationRecord | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 3) return null;
  if (!keys.every((key) => (
    key === "id" ||
    key === "generation" ||
    key === "readyRecorded"
  ))) {
    return null;
  }
  if (typeof value.id !== "string" || !isProductAnalyticsUuid(value.id)) {
    return null;
  }
  if (
    typeof value.readyRecorded !== "boolean" ||
    (
      !Number.isInteger(value.generation) ||
      (value.generation as number) < 0 ||
      (value.generation as number) > MAX_CONSENT_GENERATION
    )
  ) {
    return null;
  }
  return {
    id: value.id,
    generation: value.generation as number,
    readyRecorded: value.readyRecorded,
  };
}

function sameEnvelope(
  left: QueuedProductAnalyticsEvent,
  right: QueuedProductAnalyticsEvent,
) {
  return left.installationId === right.installationId &&
    left.consentGeneration === right.consentGeneration &&
    left.sessionId === right.sessionId &&
    left.appVersion === right.appVersion &&
    left.platform === right.platform &&
    left.locale === right.locale;
}

function sanitizeQueue(value: unknown, now: number) {
  if (!Array.isArray(value)) return [];
  const oldest = now - PRODUCT_ANALYTICS_MAX_AGE_MS;
  const newest = now + MAX_FUTURE_SKEW_MS;
  const eventIds = new Set<string>();
  const queue = value
    .filter(isQueuedProductAnalyticsEvent)
    .filter((item) => {
      const occurredAt = Date.parse(item.event.occurredAt);
      return occurredAt >= oldest && occurredAt <= newest;
    })
    .filter((item) => {
      if (eventIds.has(item.event.eventId)) return false;
      eventIds.add(item.event.eventId);
      return true;
    });
  return capQueue(queue);
}

function sanitizeInstallationQueue(
  value: unknown,
  now: number,
  installation: InstallationRecord,
) {
  return sanitizeQueue(value, now).filter((item) => (
    item.installationId === installation.id &&
    item.consentGeneration === installation.generation
  ));
}

function capQueue(queue: QueuedProductAnalyticsEvent[]) {
  if (queue.length <= PRODUCT_ANALYTICS_MAX_QUEUE) return queue;
  // Reserve the pending installation anchor and the newest copy of each closed
  // milestone shape. High-volume query/turn outcomes yield first, so an offline
  // burst cannot erase the much rarer funnel anchors it is meant to explain.
  const installation = [...queue].reverse().find(
    (item) => item.event.name === "desktop_installation_ready",
  );
  const reservedIds = new Set<string>();
  if (installation) reservedIds.add(installation.event.eventId);
  const milestoneKeys = new Set<string>();
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const item = queue[index];
    if (!item || reservedIds.size >= MAX_RESERVED_MILESTONES) break;
    if (
      item.event.name === "desktop_installation_ready" ||
      HIGH_VOLUME_OUTCOMES.has(item.event.name)
    ) {
      continue;
    }
    const key = JSON.stringify([
      item.event.name,
      item.event.actorKey ?? "",
      item.event.workspaceKey ?? "",
      item.event.workspaceKind ?? "",
      item.event.properties,
    ]);
    if (milestoneKeys.has(key)) continue;
    milestoneKeys.add(key);
    reservedIds.add(item.event.eventId);
  }
  const recentSlots = PRODUCT_ANALYTICS_MAX_QUEUE - reservedIds.size;
  const recentIds = new Set(queue
    .filter((item) => !reservedIds.has(item.event.eventId))
    .slice(-recentSlots)
    .map((item) => item.event.eventId));
  return queue.filter((item) => (
    reservedIds.has(item.event.eventId) || recentIds.has(item.event.eventId)
  ));
}

export class ProductAnalyticsLocalStore {
  private consent: ProductAnalyticsConsent;
  private generation: number | null;
  private queue: QueuedProductAnalyticsEvent[];
  private snapshot: ProductAnalyticsLocalSnapshot;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly storage: ProductAnalyticsStorage | null,
    private readonly now: () => number = Date.now,
  ) {
    this.consent = "pending";
    this.generation = null;
    // Preserve a previous official build's bounded queue until the asynchronous
    // native consent source is known. Pending state still prevents every read,
    // capture, and send path from consuming it.
    this.queue = sanitizeQueue(readJson(storage, QUEUE_KEY), this.now());
    // Enforce the local seven-day retention limit on read as well as write.
    // Otherwise an expired queue could remain on disk forever when the user
    // launches offline and produces no subsequent event.
    this.persistQueue(this.queue);
    this.snapshot = {
      consent: this.consent,
      queueSize: this.queue.length,
    };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  reload() {
    if (
      this.consent !== "granted" ||
      this.generation === null ||
      this.revocationPending()
    ) {
      this.consent = this.revocationPending() ? "denied" : this.consent;
      this.queue = [];
      this.clearPrivateState();
      this.publish();
      return;
    }
    const storedInstallation = readJson(this.storage, INSTALLATION_KEY);
    const installation = normalizeInstallation(storedInstallation);
    if (
      storedInstallation !== null &&
      (!installation || installation.generation !== this.generation)
    ) {
      this.queue = [];
      this.clearPrivateState();
      this.publish();
      return;
    }
    this.queue = installation
      ? sanitizeInstallationQueue(
          readJson(this.storage, QUEUE_KEY),
          this.now(),
          installation,
        )
      : [];
    this.persistQueue(this.queue);
    this.publish();
  }

  applyConsent(consent: ProductAnalyticsConsent, generation: number) {
    if (
      !Number.isInteger(generation) ||
      generation < 0 ||
      generation > MAX_CONSENT_GENERATION
    ) {
      this.consent = "pending";
      this.generation = null;
      this.queue = [];
      this.clearPrivateState();
      this.publish();
      return false;
    }
    this.generation = generation;
    if (consent === "granted" && this.revocationPending()) {
      this.consent = "denied";
      this.queue = [];
      this.clearPrivateState();
      this.publish();
      return false;
    }
    this.consent = consent;
    if (consent !== "granted") {
      this.queue = [];
      this.clearPrivateState();
    } else {
      const storedInstallation = readJson(this.storage, INSTALLATION_KEY);
      const installation = normalizeInstallation(storedInstallation);
      if (
        storedInstallation !== null &&
        (!installation || installation.generation !== generation)
      ) {
        this.queue = [];
        this.clearPrivateState();
      } else {
        this.queue = installation
          ? sanitizeInstallationQueue(
              readJson(this.storage, QUEUE_KEY),
              this.now(),
              installation,
            )
          : [];
        this.persistQueue(this.queue);
      }
    }
    this.publish();
    return true;
  }

  revocationPending() {
    try {
      return this.storage?.getItem(REVOCATION_PENDING_KEY) === "1";
    } catch {
      return true;
    }
  }

  beginRevocation() {
    let tombstoneStored = false;
    try {
      if (this.storage) {
        this.storage.setItem(REVOCATION_PENDING_KEY, "1");
        tombstoneStored = this.storage.getItem(REVOCATION_PENDING_KEY) === "1";
      }
    } catch {
      tombstoneStored = false;
    }
    this.consent = "denied";
    this.queue = [];
    const cleared = this.clearPrivateState();
    this.publish();
    return tombstoneStored && cleared;
  }

  completeRevocation() {
    if (!this.clearPrivateState()) return false;
    try {
      if (!this.storage) return false;
      if (
        this.storage.getItem(QUEUE_KEY) !== null ||
        this.storage.getItem(INSTALLATION_KEY) !== null
      ) {
        return false;
      }
      this.storage.removeItem(REVOCATION_PENDING_KEY);
      return this.storage.getItem(REVOCATION_PENDING_KEY) === null;
    } catch {
      return false;
    }
  }

  installation() {
    if (
      this.consent !== "granted" ||
      this.generation === null ||
      this.revocationPending()
    ) {
      return null;
    }
    const value = readJson(this.storage, INSTALLATION_KEY);
    const installation = normalizeInstallation(value);
    return installation?.generation === this.generation ? installation : null;
  }

  ensureInstallation(randomUuid: () => string): InstallationRecord | null {
    const current = this.installation();
    if (current) return current;
    if (this.consent !== "granted" || this.generation === null) return null;
    const id = randomUuid().toLowerCase();
    if (!isProductAnalyticsUuid(id)) return null;
    const installation = {
      id,
      generation: this.generation,
      readyRecorded: false,
    };
    try {
      this.storage?.setItem(INSTALLATION_KEY, JSON.stringify(installation));
      if (!this.storage) return null;
    } catch {
      return null;
    }
    return installation;
  }

  markInstallationReadyRecorded(installationId: string) {
    if (this.consent !== "granted") return false;
    const current = this.installation();
    if (!current || current.id !== installationId) return false;
    if (current.readyRecorded) return true;
    try {
      if (!this.storage) return false;
      this.storage.setItem(INSTALLATION_KEY, JSON.stringify({
        ...current,
        readyRecorded: true,
      }));
      return this.installation()?.readyRecorded === true;
    } catch {
      return false;
    }
  }

  enqueue(item: QueuedProductAnalyticsEvent) {
    const installation = this.installation();
    if (
      this.consent !== "granted" ||
      !installation ||
      item.installationId !== installation.id ||
      item.consentGeneration !== installation.generation ||
      !isQueuedProductAnalyticsEvent(item)
    ) {
      return false;
    }
    let isolated: unknown;
    try {
      isolated = JSON.parse(JSON.stringify(item)) as unknown;
    } catch {
      return false;
    }
    if (!isQueuedProductAnalyticsEvent(isolated)) return false;
    const current = sanitizeQueue(this.queue, this.now());
    if (current.some((queued) => (
      queued.event.eventId === isolated.event.eventId
    ))) {
      if (current.length !== this.queue.length) {
        this.persistQueue(current);
        this.publish();
      }
      return true;
    }
    const next = capQueue([...current, isolated]);
    if (!this.persistQueue(next)) return false;
    this.publish();
    return true;
  }

  peekBatch() {
    const queue = sanitizeQueue(this.queue, this.now());
    if (queue.length !== this.queue.length) {
      this.persistQueue(queue);
      this.publish();
    }
    const first = queue[0];
    if (!first) return [];
    const batch: QueuedProductAnalyticsEvent[] = [];
    for (const item of queue) {
      if (batch.length >= PRODUCT_ANALYTICS_MAX_BATCH) break;
      if (!sameEnvelope(first, item)) break;
      batch.push(item);
    }
    return batch;
  }

  removeEvents(eventIds: readonly string[]) {
    if (eventIds.length === 0) return true;
    const accepted = new Set(eventIds);
    const next = this.queue.filter((item) => !accepted.has(item.event.eventId));
    if (next.length === this.queue.length) return true;
    if (!this.persistQueue(next)) {
      // The relay already accepted these IDs. Remove them from this process so
      // a failed WebView persistence write cannot create a hot resend loop.
      // A later process may replay the stale disk copy, which remains safe
      // because analytics D1 uses the stable event ID as its primary key.
      this.queue = next;
      this.publish();
      return false;
    }
    this.publish();
    return true;
  }

  discardQueue() {
    if (this.queue.length === 0) return true;
    const persisted = this.persistQueue([]);
    if (!persisted) this.queue = [];
    this.publish();
    return persisted;
  }

  private persistQueue(next: QueuedProductAnalyticsEvent[]) {
    try {
      if (next.length === 0) this.storage?.removeItem(QUEUE_KEY);
      else this.storage?.setItem(QUEUE_KEY, JSON.stringify(next));
      if (!this.storage && next.length > 0) return false;
    } catch {
      return false;
    }
    this.queue = next;
    return true;
  }

  private clearPrivateState() {
    let queueCleared = this.storage !== null;
    let installationCleared = this.storage !== null;
    try {
      this.storage?.removeItem(QUEUE_KEY);
    } catch {
      queueCleared = false;
    }
    try {
      this.storage?.removeItem(INSTALLATION_KEY);
    } catch {
      installationCleared = false;
    }
    return queueCleared && installationCleared;
  }

  private publish() {
    const next = { consent: this.consent, queueSize: this.queue.length };
    if (
      next.consent === this.snapshot?.consent &&
      next.queueSize === this.snapshot?.queueSize
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function productAnalyticsInstallationReadyInput(
  installation: InstallationRecord,
): ProductAnalyticsEventInput {
  return {
    name: "desktop_installation_ready",
    dedupeId: installation.id,
    properties: {},
  };
}
