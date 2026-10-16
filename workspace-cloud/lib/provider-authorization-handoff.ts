// Browser handoff for provider authorizations started from DopeDB Desktop. Desktop
// opens only this origin's start page. The page proves that the browser account is
// the account that created the one-use state before leaving for the provider, so a
// missing or different browser session never consumes and loses the provider code.
import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { gcpCloudAuthorizationUrl } from "./providers/gcp-cloud-oauth";
import { planetScaleAuthorizationUrl } from "./providers/planetscale";
import { providerOauthState } from "./schema";
import {
  localizedWorkspacePath,
  type WorkspaceLocale,
} from "./workspace-locale";

export type ProviderAuthorizationProvider = "planetScale" | "gcpCloudSql";
export type ProviderAuthorizationOutcome = "connected" | "authorised" | "failed";
export type ProviderAuthorizationStartDecision =
  | "invalid"
  | "sign_in"
  | "account_mismatch"
  | "redirect";

const STATE_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export function isProviderAuthorizationProvider(
  value: unknown,
): value is ProviderAuthorizationProvider {
  return value === "planetScale" || value === "gcpCloudSql";
}

export function providerAuthorizationStateHash(state: string) {
  return createHash("sha256").update(state).digest("base64url");
}

/** The only browser URL a native client opens for a provider authorization. */
export function providerAuthorizationStartUrl(state: string) {
  const url = new URL("/auth/provider/start", env.appOrigin());
  url.searchParams.set("state", state);
  return url.toString();
}

export function providerAuthorizationStartPath(state: string, locale: WorkspaceLocale) {
  return localizedWorkspacePath(
    `/auth/provider/start?state=${encodeURIComponent(state)}`,
    locale,
  );
}

/** Callbacks finish on a token-free page; Desktop re-reads authority on return. */
export function providerAuthorizationCompleteUrl(
  provider: ProviderAuthorizationProvider,
  outcome: ProviderAuthorizationOutcome,
  locale: WorkspaceLocale,
) {
  const url = new URL(
    localizedWorkspacePath("/auth/provider/complete", locale),
    env.appOrigin(),
  );
  url.searchParams.set("provider", provider);
  url.searchParams.set("status", outcome);
  return url;
}

/**
 * Pure routing decision for the start page. The provider callback repeats the
 * account check while consuming the state; this page only prevents a code from
 * being issued to a browser that cannot redeem it.
 */
export function providerAuthorizationStartDecision(input: {
  state: { userId: string; provider: string } | null;
  sessionUserId: string | null;
}): ProviderAuthorizationStartDecision {
  if (!input.state || !isProviderAuthorizationProvider(input.state.provider)) {
    return "invalid";
  }
  if (!input.sessionUserId) return "sign_in";
  if (input.sessionUserId !== input.state.userId) return "account_mismatch";
  return "redirect";
}

export async function readProviderAuthorizationState(state: string) {
  if (!STATE_PATTERN.test(state)) return null;
  const row = await db.query.providerOauthState.findFirst({
    where: and(
      eq(providerOauthState.stateHash, providerAuthorizationStateHash(state)),
      gt(providerOauthState.expiresAt, new Date()),
    ),
    columns: { userId: true, provider: true },
  });
  return row ?? null;
}

export function providerAuthorizationUrl(
  provider: ProviderAuthorizationProvider,
  state: string,
) {
  return provider === "planetScale"
    ? planetScaleAuthorizationUrl(state)
    : gcpCloudAuthorizationUrl(state);
}
