// Server-only wrapper around the envelope primitive. The key is separated from
// database ciphertext in the deployment environment and never returned by APIs.
import "server-only";

import { env } from "./env";
import {
  decodeEnvelopeKey,
} from "./secret-envelope-core";
import {
  openProviderEnvelope as openEnvelope,
  sealProviderEnvelope as sealEnvelope,
} from "./provider-credential-envelope";

function key(): Buffer {
  return decodeEnvelopeKey(env.credentialKey());
}

function context(integrationId: string) {
  return `dopedb:provider-integration:${integrationId}`;
}

function setupContext(setupSessionId: string) {
  return `dopedb:provider-setup:${setupSessionId}`;
}

function bootstrapContext(setupSessionId: string) {
  return `dopedb:provider-bootstrap:${setupSessionId}`;
}

function neonBootstrapContext(integrationId: string) {
  return `dopedb:neon-bootstrap-plan:${integrationId}`;
}

export function sealProviderCredential(integrationId: string, value: unknown): string {
  return sealEnvelope(key(), JSON.stringify(value), context(integrationId));
}

export function openProviderCredential<T>(integrationId: string, envelope: string): T {
  const plaintext = openEnvelope(key(), envelope, context(integrationId));
  try {
    return JSON.parse(plaintext) as T;
  } finally {
    // JavaScript strings cannot be reliably zeroized. Keep the plaintext lifetime
    // inside this narrow function and never retain or log it outside typed callers.
  }
}

export function sealProviderSetupCredential(setupSessionId: string, value: unknown): string {
  return sealEnvelope(key(), JSON.stringify(value), setupContext(setupSessionId));
}

export function openProviderSetupCredential<T>(
  setupSessionId: string,
  envelope: string,
): T {
  const plaintext = openEnvelope(key(), envelope, setupContext(setupSessionId));
  return JSON.parse(plaintext) as T;
}

export function sealProviderBootstrapTicket(
  setupSessionId: string,
  value: unknown,
): string {
  return sealEnvelope(key(), JSON.stringify(value), bootstrapContext(setupSessionId));
}

export function openProviderBootstrapTicket<T>(
  setupSessionId: string,
  envelope: string,
): T {
  const plaintext = openEnvelope(key(), envelope, bootstrapContext(setupSessionId));
  return JSON.parse(plaintext) as T;
}

export function sealNeonBootstrapPlan(
  integrationId: string,
  value: unknown,
): string {
  return sealEnvelope(
    key(),
    JSON.stringify(value),
    neonBootstrapContext(integrationId),
  );
}

export function openNeonBootstrapPlan<T>(
  integrationId: string,
  envelope: string,
): T {
  const plaintext = openEnvelope(
    key(),
    envelope,
    neonBootstrapContext(integrationId),
  );
  return JSON.parse(plaintext) as T;
}
