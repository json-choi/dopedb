// Provider envelopes carry a public key fingerprint so a rotation can fence old
// deployment writes without storing the encryption key in PostgreSQL.
import { createHash } from "node:crypto";

import { openEnvelope, sealEnvelope } from "./secret-envelope-core";

export function providerCredentialKeyId(key: Buffer): string {
  if (key.length !== 32) throw new Error("Credential key must be exactly 32 bytes");
  return createHash("sha256")
    .update("dopedb:provider-credential-key:v2:")
    .update(key)
    .digest("hex");
}

export function sealProviderEnvelope(key: Buffer, plaintext: string, context: string): string {
  const id = providerCredentialKeyId(key);
  return `v2.${id}.${sealEnvelope(key, plaintext, `${context}:key:${id}`)}`;
}

export function openProviderEnvelope(key: Buffer, envelope: string, context: string): string {
  // Existing records remain readable during the preparation deployment. A new
  // key still cannot decrypt them; rotation must explicitly re-encrypt each row.
  if (envelope.startsWith("v1.")) return openEnvelope(key, envelope, context);
  const id = providerCredentialKeyId(key);
  const prefix = `v2.${id}.`;
  if (!envelope.startsWith(prefix)) throw new Error("Credential key does not match envelope");
  return openEnvelope(key, envelope.slice(prefix.length), `${context}:key:${id}`);
}
