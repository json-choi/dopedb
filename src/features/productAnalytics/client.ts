// Consent-gated product analytics runtime. Native code owns availability and
// delivery; this WebView layer owns a closed event vocabulary, immediate
// identity hashing, a seven-day local retry queue, and observable consent state.
import { getVersion } from "@tauri-apps/api/app";
import { useSyncExternalStore } from "react";

import type {
  ProductAnalyticsEvent,
  ProductAnalyticsEventInput,
  ProductAnalyticsLocale,
  ProductAnalyticsPlatform,
  ProductAnalyticsSnapshot,
  QueuedProductAnalyticsEvent,
} from "./domain";
import {
  isProductAnalyticsAppVersion,
  isProductAnalyticsEventInput,
  isProductAnalyticsUuid,
} from "./domain";
import {
  ProductAnalyticsLocalStore,
  productAnalyticsInstallationReadyInput,
  productAnalyticsRetryDelay,
  productAnalyticsRetryIsBlocked,
} from "./storage";
import {
  productAnalyticsStatus,
  setProductAnalyticsConsent,
  submitProductAnalyticsBatch,
} from "./tauriAdapter";

type Listener = () => void;

function browserStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function currentPlatform(): ProductAnalyticsPlatform {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("macintosh") || userAgent.includes("mac os x")) {
    return "macos";
  }
  if (userAgent.includes("windows")) return "windows";
  if (userAgent.includes("linux")) return "linux";
  return "unknown";
}

function currentLocale(): ProductAnalyticsLocale {
  const language = document.documentElement.lang || navigator.language;
  return language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function isOnline() {
  return typeof navigator.onLine !== "boolean" || navigator.onLine;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function identityHashInput(
  kind: "actor-installation" | "actor-workspace" | "workspace",
  id: string,
) {
  return `dopedb-product-analytics:${kind}:v1:${id.toLowerCase()}`;
}

async function hashedContext(
  input: ProductAnalyticsEventInput,
  installationId: string,
) {
  if (input.name === "desktop_installation_ready") return {};
  if (input.name === "workspace_authentication_completed") {
    if (input.properties.outcome !== "success" || !input.context) return {};
    return {
      actorKey: await sha256Hex(
        identityHashInput(
          "actor-installation",
          `${installationId}:${input.context.actorId}`,
        ),
      ),
    };
  }
  if (input.context.workspaceKind === "personal") {
    // Personal workspace IDs are reserved and identical across installations.
    // Deriving this scope from the installation prevents unrelated individuals
    // from collapsing into one analytics identity.
    return {
      workspaceKey: await sha256Hex(
        `dopedb-product-analytics:workspace:v1:personal:${installationId}`,
      ),
      workspaceKind: "personal" as const,
    };
  }
  return {
    actorKey: await sha256Hex(
      identityHashInput(
        "actor-workspace",
        `${input.context.workspaceId}:${input.context.actorId}`,
      ),
    ),
    workspaceKey: await sha256Hex(
      identityHashInput("workspace", input.context.workspaceId),
    ),
    workspaceKind: "team" as const,
  };
}

function newSessionId() {
  try {
    const value = crypto.randomUUID().toLowerCase();
    return isProductAnalyticsUuid(value) ? value : null;
  } catch {
    return null;
  }
}

const localStore = new ProductAnalyticsLocalStore(browserStorage());
const listeners = new Set<Listener>();
const completedSessionCaptures = new Set<string>();
type PendingSessionCapture = Readonly<{ promise: Promise<boolean> }>;

const pendingSessionCaptures = new Map<string, PendingSessionCapture>();
let availability: ProductAnalyticsSnapshot["availability"] = "checking";
let appVersion: string | null = null;
let sessionId = newSessionId();
let consentGeneration: number | null = null;
let consentEpoch = 0;
let sending = false;
let retryAttempt = 0;
let retryTimer: number | null = null;
let retryNotBefore = 0;
let initialized = false;
let initializePromise: Promise<void> | null = null;
let snapshot: ProductAnalyticsSnapshot = {
  availability,
  consent: localStore.getSnapshot().consent,
  queueSize: localStore.getSnapshot().queueSize,
  sending,
};

function publish() {
  const local = localStore.getSnapshot();
  const next: ProductAnalyticsSnapshot = {
    availability,
    consent: local.consent,
    queueSize: local.queueSize,
    sending,
  };
  if (
    next.availability === snapshot.availability &&
    next.consent === snapshot.consent &&
    next.queueSize === snapshot.queueSize &&
    next.sending === snapshot.sending
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

localStore.subscribe(publish);

function applyConsentState(
  consent: ProductAnalyticsSnapshot["consent"],
  generation: number,
) {
  const changed = consentGeneration !== generation ||
    localStore.getSnapshot().consent !== consent;
  const applied = localStore.applyConsent(consent, generation);
  consentGeneration = generation;
  if (changed) consentEpoch += 1;
  return applied;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function clearRetry() {
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
  retryNotBefore = 0;
}

function armRetryTimer() {
  if (
    retryTimer !== null ||
    snapshot.consent !== "granted" ||
    availability !== "available" ||
    snapshot.queueSize === 0
  ) {
    return;
  }
  const delay = Math.max(0, retryNotBefore - Date.now());
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (productAnalyticsRetryIsBlocked(Date.now(), retryNotBefore)) {
      armRetryTimer();
    }
    else void flushProductAnalytics();
  }, delay);
}

function scheduleRetry(retryAfterMs?: number) {
  if (
    snapshot.consent !== "granted" ||
    availability !== "available" ||
    snapshot.queueSize === 0
  ) {
    return;
  }
  const delay = productAnalyticsRetryDelay(
    retryAfterMs,
    retryAttempt,
    Math.random(),
  );
  // Local exponential backoff uses symmetric jitter. A server Retry-After is
  // a minimum, so its jitter is positive-only and can never wake early.
  retryAttempt += 1;
  const nextNotBefore = Date.now() + delay;
  if (nextNotBefore > retryNotBefore) {
    retryNotBefore = nextNotBefore;
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }
  armRetryTimer();
}

function attachLifecycleListeners() {
  window.addEventListener("online", () => void flushProductAnalytics());
  window.addEventListener("storage", () => {
    localStore.reload();
    if (snapshot.consent !== "granted") clearRetry();
    else void flushProductAnalytics();
  });
  document.addEventListener("visibilitychange", () => {
    void flushProductAnalytics();
  });
}

export function initializeProductAnalytics() {
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    if (!initialized) {
      initialized = true;
      attachLifecycleListeners();
    }
    try {
      const status = await productAnalyticsStatus();
      availability = status.enabled ? "available" : "unavailable";
      if (localStore.revocationPending()) {
        // A previous renderer may have lost the IPC response after the user
        // revoked consent. Never trust a stale native `granted` value while
        // the durable local tombstone exists; retry the idempotent denial.
        applyConsentState("denied", status.generation);
        publish();
        let recovered = false;
        try {
          const denied = await setProductAnalyticsConsent("denied");
          availability = denied.enabled ? "available" : "unavailable";
          applyConsentState("denied", denied.generation);
          if (denied.consent === "denied") {
            recovered = localStore.completeRevocation();
          }
        } catch {
          // Fail closed. The tombstone is intentionally retained for retry.
        }
        publish();
        if (!recovered) return;
      } else {
        applyConsentState(status.consent, status.generation);
      }
      if (status.enabled !== true) {
        publish();
        return;
      }
      const version = await getVersion();
      if (!isProductAnalyticsAppVersion(version) || sessionId === null) {
        availability = "unavailable";
        publish();
        return;
      }
      appVersion = version;
      availability = "available";
      publish();
      if (snapshot.consent === "granted") {
        const installationReady = await captureDesktopInstallationReady();
        if (installationReady) void flushProductAnalytics();
      }
    } catch {
      availability = "unavailable";
      publish();
    }
  })();
  return initializePromise;
}

export function useProductAnalyticsSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

async function captureDesktopInstallationReady() {
  if (
    snapshot.consent !== "granted" ||
    availability !== "available"
  ) {
    return false;
  }
  let installation;
  try {
    installation = localStore.ensureInstallation(() => crypto.randomUUID());
  } catch {
    return false;
  }
  if (!installation) return false;
  if (installation.readyRecorded) return true;
  const captured = await captureProductEventInternal(
    productAnalyticsInstallationReadyInput(installation),
    false,
    false,
  );
  // The marker means relay acceptance, not merely local enqueue. Until the
  // relay acknowledges this deterministic event ID, every reload may safely
  // restore the same pending funnel anchor.
  return captured;
}

export async function grantProductAnalyticsConsent() {
  if (availability !== "available") return false;
  try {
    if (localStore.revocationPending()) {
      const denied = await setProductAnalyticsConsent("denied");
      applyConsentState("denied", denied.generation);
      if (
        denied.consent !== "denied" ||
        !localStore.completeRevocation()
      ) {
        publish();
        return false;
      }
    }
    const status = await setProductAnalyticsConsent("granted");
    if (status.consent !== "granted") return false;
    if (!applyConsentState(status.consent, status.generation)) {
      publish();
      return false;
    }
    sessionId ??= newSessionId();
    availability = status.enabled ? "available" : "unavailable";
    publish();
    if (status.enabled) {
      const installationReady = await captureDesktopInstallationReady();
      if (installationReady) void flushProductAnalytics();
    }
    return status.enabled;
  } catch {
    return false;
  }
}

export async function denyProductAnalyticsConsent() {
  clearRetry();
  completedSessionCaptures.clear();
  pendingSessionCaptures.clear();
  // A later opt-in starts a fresh analytics session as well as a fresh
  // installation. Never let the prior process-session key bridge consent eras.
  sessionId = newSessionId();
  consentEpoch += 1;
  // Revocation is fail-closed locally before IPC so an unavailable native host
  // cannot leave queued data or this process's installation identity behind.
  localStore.beginRevocation();
  try {
    const status = await setProductAnalyticsConsent("denied");
    availability = status.enabled ? "available" : "unavailable";
    applyConsentState("denied", status.generation);
    if (status.consent !== "denied") {
      publish();
      return false;
    }
    const tombstoneCleared = localStore.completeRevocation();
    publish();
    return tombstoneCleared;
  } catch {
    // Keep collection denied for this process and retain the durable tombstone
    // so the next launch cannot silently resume a stale native grant.
    return false;
  }
}

async function captureProductEventInternal(
  input: ProductAnalyticsEventInput,
  oncePerSession: boolean,
  flushAfterCapture = true,
) {
  if (
    snapshot.consent !== "granted" ||
    availability !== "available" ||
    appVersion === null ||
    sessionId === null ||
    consentGeneration === null ||
    !isProductAnalyticsEventInput(input)
  ) {
    return false;
  }
  const captureEpoch = consentEpoch;
  const captureSessionId = sessionId;
  let installation;
  try {
    installation = localStore.ensureInstallation(() => crypto.randomUUID());
  } catch {
    return false;
  }
  if (!installation) return false;
  let occurredAt: string;
  let context: Awaited<ReturnType<typeof hashedContext>>;
  let sessionCaptureKey: string | null = null;
  try {
    occurredAt = new Date().toISOString();
    context = await hashedContext(input, installation.id);
    if (oncePerSession) {
      sessionCaptureKey = await sha256Hex(
        `dopedb-product-analytics:session-event:v1:${captureSessionId}:${input.name}:${context.actorKey ?? ""}:${context.workspaceKey ?? ""}:${JSON.stringify(input.properties)}`,
      );
    }
  } catch {
    return false;
  }
  if (sessionCaptureKey !== null) {
    if (completedSessionCaptures.has(sessionCaptureKey)) return true;
    const pending = pendingSessionCaptures.get(sessionCaptureKey);
    if (pending) return pending.promise;
  }

  const attempt = (async () => {
    let eventId: string;
    try {
      if (input.dedupeId) {
        eventId = await sha256Hex(
          `dopedb-product-analytics:event:v1:${installation.id}:${input.name}:${input.dedupeId.toLowerCase()}`,
        );
      } else if (sessionCaptureKey !== null) {
        eventId = sessionCaptureKey;
      } else {
        const nonce = crypto.randomUUID().toLowerCase();
        if (!isProductAnalyticsUuid(nonce)) return false;
        eventId = await sha256Hex(
          `dopedb-product-analytics:event:v1:${installation.id}:${captureSessionId}:${occurredAt}:${input.name}:${nonce}`,
        );
      }
    } catch {
      return false;
    }
    if (
      snapshot.consent !== "granted" ||
      availability !== "available" ||
      appVersion === null ||
      sessionId !== captureSessionId ||
      consentEpoch !== captureEpoch ||
      consentGeneration !== installation.generation ||
      localStore.installation()?.id !== installation.id
    ) {
      return false;
    }
    const event = {
      eventId,
      name: input.name,
      occurredAt,
      properties: input.properties,
      ...context,
    } as ProductAnalyticsEvent;
    const queued: QueuedProductAnalyticsEvent = {
      installationId: installation.id,
      consentGeneration: installation.generation,
      sessionId: captureSessionId,
      appVersion,
      platform: currentPlatform(),
      locale: currentLocale(),
      event,
    };
    if (!localStore.enqueue(queued)) return false;
    if (flushAfterCapture && isOnline()) void flushProductAnalytics();
    return true;
  })();

  if (sessionCaptureKey === null) return attempt;
  const pending = { promise: attempt } satisfies PendingSessionCapture;
  pendingSessionCaptures.set(sessionCaptureKey, pending);
  try {
    const captured = await pending.promise;
    if (captured) completedSessionCaptures.add(sessionCaptureKey);
    return captured;
  } finally {
    if (pendingSessionCaptures.get(sessionCaptureKey) === pending) {
      pendingSessionCaptures.delete(sessionCaptureKey);
    }
  }
}

export function captureProductEvent(input: ProductAnalyticsEventInput) {
  return captureProductEventInternal(input, false);
}

export function captureProductEventOncePerSession(
  input: ProductAnalyticsEventInput,
) {
  return captureProductEventInternal(input, true);
}

export async function flushProductAnalytics() {
  if (productAnalyticsRetryIsBlocked(Date.now(), retryNotBefore)) {
    armRetryTimer();
    return;
  }
  if (
    sending ||
    snapshot.consent !== "granted" ||
    availability !== "available" ||
    !isOnline()
  ) {
    return;
  }
  sending = true;
  const flushEpoch = consentEpoch;
  let restartAfterStaleFence = false;
  publish();
  try {
    let installation = localStore.installation();
    if (!installation) {
      localStore.discardQueue();
      return;
    }
    if (!installation.readyRecorded) {
      const installationReady = await captureDesktopInstallationReady();
      if (consentEpoch !== flushEpoch) {
        restartAfterStaleFence = true;
        return;
      }
      installation = localStore.installation();
      if (!installationReady || !installation) {
        scheduleRetry();
        return;
      }
    }
    while (
      snapshot.consent === "granted" &&
      consentEpoch === flushEpoch
    ) {
      const items = localStore.peekBatch();
      const first = items[0];
      if (!first) {
        clearRetry();
        break;
      }
      const receipt = await submitProductAnalyticsBatch({
        schemaVersion: 1,
        installationId: installation.id,
        consentGeneration: installation.generation,
        sessionId: first.sessionId,
        appVersion: first.appVersion,
        platform: first.platform,
        locale: first.locale,
        events: items.map((item) => item.event),
      });
      if (
        consentEpoch !== flushEpoch ||
        localStore.installation()?.id !== installation.id
      ) {
        restartAfterStaleFence = true;
        return;
      }
      if (receipt.accepted !== true) {
        if (receipt.retryable) {
          scheduleRetry(receipt.retryAfterMs);
          break;
        }
        // A permanent contract/vendor rejection must not block every newer
        // outcome for seven days. Drop only this already-invalid closed batch;
        // contract tests and the operator dashboard own the resulting alert.
        const removed = localStore.removeEvents(
          items.map((item) => item.event.eventId),
        );
        if (!removed) {
          scheduleRetry();
          break;
        }
        retryAttempt = 0;
        retryNotBefore = 0;
        continue;
      }
      if (items.some((item) => (
        item.event.name === "desktop_installation_ready"
      ))) {
        localStore.markInstallationReadyRecorded(installation.id);
      }
      const removed = localStore.removeEvents(
        items.map((item) => item.event.eventId),
      );
      if (!removed) {
        scheduleRetry();
        break;
      }
      retryAttempt = 0;
      retryNotBefore = 0;
    }
  } catch {
    scheduleRetry();
  } finally {
    sending = false;
    publish();
    if (
      restartAfterStaleFence &&
      snapshot.consent === "granted" &&
      availability === "available" &&
      snapshot.queueSize > 0 &&
      isOnline()
    ) {
      queueMicrotask(() => void flushProductAnalytics());
    }
  }
}
