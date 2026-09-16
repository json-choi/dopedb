// First-party Desktop authorization contract and session-bound approval proofs.
// Only literal IPv4 loopback callbacks and S256 PKCE are accepted.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const desktopAuthorizationKeys = [
  "client_id", "response_type", "redirect_uri", "state", "code_challenge", "code_challenge_method",
] as const;
export type DesktopAuthorization = Record<typeof desktopAuthorizationKeys[number], string>;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validDesktopRedirect(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/callback$/.exec(value);
  return !!match && Number(match[1]) >= 1024 && Number(match[1]) <= 65535;
}

export function parseDesktopAuthorization(value: unknown): DesktopAuthorization | null {
  if (!record(value) || Object.keys(value).length !== desktopAuthorizationKeys.length
    || desktopAuthorizationKeys.some((key) => typeof value[key] !== "string")
    || value.client_id !== "dopedb-desktop" || value.response_type !== "code"
    || value.code_challenge_method !== "S256" || !validDesktopRedirect(value.redirect_uri)
    || !secretPattern.test(value.code_challenge as string)
    || !/^[A-Za-z0-9_-]{43,128}$/.test(value.state as string)) return null;
  return value as DesktopAuthorization;
}

export function desktopAuthorizationQuery(request: DesktopAuthorization): string {
  return new URLSearchParams(desktopAuthorizationKeys.map((key) => [key, request[key]])).toString();
}

export function desktopDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function desktopPkceChallenge(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function newDesktopSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function createDesktopApprovalNonce(request: DesktopAuthorization, sessionId: string, secret: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({
    request: desktopDigest(desktopAuthorizationQuery(request)), sessionId,
    expires: now + 600_000, nonce: newDesktopSecret(),
  })).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`desktop-approval-v1:${body}`).digest("base64url")}`;
}

export function verifyDesktopApprovalNonce(nonce: unknown, request: DesktopAuthorization, sessionId: string, secret: string, now = Date.now()): nonce is string {
  if (typeof nonce !== "string" || nonce.length > 1024) return false;
  const parts = nonce.split(".");
  if (parts.length !== 2 || !secretPattern.test(parts[1])) return false;
  const expected = createHmac("sha256", secret).update(`desktop-approval-v1:${parts[0]}`).digest("base64url");
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[1]))) return false;
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return record(value) && value.sessionId === sessionId
      && value.request === desktopDigest(desktopAuthorizationQuery(request))
      && typeof value.expires === "number" && Number.isSafeInteger(value.expires)
      && value.expires > now && value.expires <= now + 600_000;
  } catch { return false; }
}

export type DesktopTokenRequest = {
  grant_type: "authorization_code"; client_id: "dopedb-desktop";
  code: string; redirect_uri: string; code_verifier: string;
};

export function parseDesktopTokenRequest(value: unknown): DesktopTokenRequest | null {
  if (!record(value) || Object.keys(value).length !== 5
    || value.grant_type !== "authorization_code" || value.client_id !== "dopedb-desktop"
    || typeof value.code !== "string" || !secretPattern.test(value.code)
    || !validDesktopRedirect(value.redirect_uri)
    || typeof value.code_verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(value.code_verifier)) return null;
  return value as DesktopTokenRequest;
}

export function desktopCallbackUrl(request: DesktopAuthorization, outcome: { code: string } | { error: "access_denied" }): string {
  const callback = new URL(request.redirect_uri);
  callback.searchParams.set("state", request.state);
  for (const [key, value] of Object.entries(outcome)) callback.searchParams.set(key, value);
  return callback.toString();
}
