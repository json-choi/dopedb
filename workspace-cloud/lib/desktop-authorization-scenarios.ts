// Security scenarios composed by the existing D1 contract case, without new test cases.
import { randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  createDesktopApprovalNonce, desktopPkceChallenge, newDesktopSecret,
  parseDesktopAuthorization, parseDesktopTokenRequest, validDesktopRedirect,
  verifyDesktopApprovalNonce, type DesktopAuthorization,
} from "./desktop-authorization";
import { consumeDesktopAuthorizationCode, issueDesktopAuthorizationCode } from "./desktop-authorization-store";

export async function verifyDesktopAuthorization(db: D1Database, userId: string) {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  expect(desktopPkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const request: DesktopAuthorization = {
    client_id: "dopedb-desktop", response_type: "code", redirect_uri: "http://127.0.0.1:49152/callback",
    state: newDesktopSecret(), code_challenge: desktopPkceChallenge(verifier), code_challenge_method: "S256",
  };
  expect(parseDesktopAuthorization(request)).toEqual(request);
  for (const uri of ["http://127.1:49152/callback", "http://2130706433:49152/callback",
    "http://localhost:49152/callback", "http://127.0.0.1:80/callback", "http://127.0.0.1:65536/callback",
    "http://127.0.0.1:049152/callback", "http://127.0.0.1:49152/callback?next=evil",
    "http://127.0.0.1:49152/callback#secret", "http://user@127.0.0.1:49152/callback",
    "http://127.0.0.1:49152/other", "https://127.0.0.1:49152/callback"]) expect(validDesktopRedirect(uri)).toBe(false);
  expect(parseDesktopAuthorization({ ...request, state: [request.state, request.state] })).toBeNull();
  expect(parseDesktopAuthorization({ ...request, code_challenge_method: "plain" })).toBeNull();
  expect(parseDesktopAuthorization({ ...request, extra: "ignored" })).toBeNull();
  const sessionId = randomUUID();
  const now = new Date();
  const secret = newDesktopSecret();
  const nonce = createDesktopApprovalNonce(request, sessionId, secret, now.getTime());
  expect(verifyDesktopApprovalNonce(nonce, request, sessionId, secret, now.getTime())).toBe(true);
  expect(verifyDesktopApprovalNonce(nonce, request, randomUUID(), secret, now.getTime())).toBe(false);
  expect(verifyDesktopApprovalNonce(nonce, { ...request, state: newDesktopSecret() }, sessionId, secret, now.getTime())).toBe(false);
  expect(verifyDesktopApprovalNonce(nonce, request, sessionId, secret, now.getTime() + 600_000)).toBe(false);
  expect(verifyDesktopApprovalNonce(`${nonce}a`, request, sessionId, secret, now.getTime())).toBe(false);
  await db.prepare("INSERT INTO session (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)")
    .bind(sessionId, newDesktopSecret(), userId, new Date(now.getTime() + 3600_000).toISOString()).run();
  const input = { request, approvalNonce: nonce, sessionId, userId };
  const code = await issueDesktopAuthorizationCode(input, db, now);
  expect(code).toBeTruthy();
  expect(await issueDesktopAuthorizationCode(input, db, now)).toBeNull();
  const token = { grant_type: "authorization_code" as const, client_id: "dopedb-desktop" as const,
    code: code!, redirect_uri: request.redirect_uri, code_verifier: verifier };
  expect(parseDesktopTokenRequest(token)).toEqual(token);
  expect(parseDesktopTokenRequest({ ...token, code_verifier: "short" })).toBeNull();
  expect(parseDesktopTokenRequest({ ...token, extra: "ignored" })).toBeNull();
  expect(await consumeDesktopAuthorizationCode({ ...token, code_verifier: newDesktopSecret() }, db, now)).toBeNull();
  expect(await consumeDesktopAuthorizationCode({ ...token, redirect_uri: "http://127.0.0.1:49153/callback" }, db, now)).toBeNull();
  const exchanged = await Promise.all([consumeDesktopAuthorizationCode(token, db, now), consumeDesktopAuthorizationCode(token, db, now)]);
  expect(exchanged.filter(Boolean)).toEqual([{ userId, sessionId }]);
  expect(await issueDesktopAuthorizationCode(input, db, now)).toBeNull();
  const issue = () => issueDesktopAuthorizationCode({ ...input, approvalNonce: newDesktopSecret() }, db, now);
  const deniedInput = { ...input, approvalNonce: newDesktopSecret(), denied: true };
  const deniedCode = await issueDesktopAuthorizationCode(deniedInput, db, now);
  expect(await consumeDesktopAuthorizationCode({ ...token, code: deniedCode! }, db, now)).toBeNull();
  expect(await issueDesktopAuthorizationCode({ ...deniedInput, denied: false }, db, now)).toBeNull();
  const expired = await issue();
  expect(await consumeDesktopAuthorizationCode({ ...token, code: expired! }, db, new Date(now.getTime() + 120_000))).toBeNull();
  const revoked = await issue();
  await db.prepare("DELETE FROM session WHERE id = ?").bind(sessionId).run();
  expect(await consumeDesktopAuthorizationCode({ ...token, code: revoked! }, db, now)).toBeNull();
  expect(await issue()).toBeNull();
}

export async function verifyDesktopAuthorizationRoutes(userId: string) {
  const { auth } = await import("./auth");
  const { authoritativeSession } = await import("./authoritative-session");
  const { POST: authorize } = await import("../app/api/auth/desktop/authorize/route");
  const { POST: exchange } = await import("../app/api/auth/desktop/token/route");
  const context = await auth.$context;
  const browser = await context.internalAdapter.createSession(userId);
  const signed = `${browser.token}.${await makeSignature(browser.token, context.secret)}`;
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
  const verifier = newDesktopSecret();
  const request: DesktopAuthorization = {
    client_id: "dopedb-desktop", response_type: "code", redirect_uri: "http://127.0.0.1:49152/callback",
    state: newDesktopSecret(), code_challenge: desktopPkceChallenge(verifier), code_challenge_method: "S256",
  };
  const nonce = createDesktopApprovalNonce(request, browser.id, context.secret);
  const approvalRequest = (headers: Record<string, string>, proof = nonce) => new Request("https://workspace.dopedb.dev/api/auth/desktop/authorize", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ request, nonce: proof, decision: "approve" }),
  });
  const headers = { origin: "https://workspace.dopedb.dev", cookie };
  expect((await authorize(approvalRequest({ ...headers, origin: "https://other.dopedb.invalid" }))).status).toBe(403);
  expect((await authorize(approvalRequest({ ...headers, authorization: `Bearer ${browser.token}` }))).status).toBe(403);
  expect((await authorize(approvalRequest({ origin: headers.origin }))).status).toBe(401);
  expect((await authorize(approvalRequest(headers, `${nonce}x`))).status).toBe(400);
  const accepted = await authorize(approvalRequest(headers));
  expect(accepted.status).toBe(200);
  const callback = new URL((await accepted.json()).redirect_uri);
  expect(callback.searchParams.get("state")).toBe(request.state);
  const tokenRequest = (extraHeaders = {}) => new Request("https://workspace.dopedb.dev/api/auth/desktop/token", {
    method: "POST", headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: request.client_id,
      redirect_uri: request.redirect_uri, code: callback.searchParams.get("code"), code_verifier: verifier }),
  });
  expect((await exchange(tokenRequest({ cookie }))).status).toBe(400);
  const exchanged = await exchange(tokenRequest());
  expect(exchanged.status).toBe(200);
  const native = await exchanged.json();
  expect(native.access_token).not.toBe(browser.token);
  expect(native.token_type).toBe("Bearer");
  expect(native.expires_in).toBeGreaterThan(0);
  expect(exchanged.headers.get("cache-control")).toBe("private, no-store");
  expect((await exchange(tokenRequest())).status).toBe(400);
  const nativeRequest = new Request("https://workspace.dopedb.dev/api/v1/session", {
    headers: { authorization: `Bearer ${native.access_token}` },
  });
  expect((await authoritativeSession(nativeRequest))?.user.id).toBe(userId);
  await context.internalAdapter.deleteSession(native.access_token);
  expect(await authoritativeSession(nativeRequest)).toBeNull();
  await context.internalAdapter.deleteSession(browser.token);
}
