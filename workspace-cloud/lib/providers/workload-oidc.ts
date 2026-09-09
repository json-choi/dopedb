// Bootstrap accepts the fixed production workload only after RS256/JWKS
// verification against the configured identity Worker. Client headers never
// supply this credential and issuer discovery cannot redirect to another origin.
import "server-only";

import { createPublicKey, verify } from "node:crypto";
import { boundedJsonResponse } from "../bounded-json-response";
import { ProviderRequestError } from "./provider-types";

type JsonObject = Record<string, unknown>;

const MAX_WORKLOAD_TOKEN_LIFETIME_SECONDS = 900;
const MAX_DISCOVERY_RESPONSE_BYTES = 32 * 1_024;
const MAX_JWKS_RESPONSE_BYTES = 256 * 1_024;

export type VerifiedWorkloadOidc = {
  issuer: string;
  audience: string;
  subject: string;
  accountId: string;
  workloadId: string;
  environment: "production";
};

function decodeJson(segment: string): JsonObject {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length > 16_384) {
    throw new Error("invalid JWT segment");
  }
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) {
    throw new Error("invalid JWT encoding");
  }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid JWT object");
  }
  return value as JsonObject;
}

function requiredClaim(
  claims: JsonObject,
  key: string,
  pattern: RegExp,
  max = 256,
) {
  const value = claims[key];
  if (typeof value !== "string" || value.length > max || !pattern.test(value)) {
    throw new Error(`invalid ${key}`);
  }
  return value;
}

async function publicKey(issuer: string, kid: string) {
  const discoveryUrl = new URL(".well-known/openid-configuration", `${issuer}/`);
  const discoveryResponse = await fetch(discoveryUrl, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const discoveryValue = await boundedJsonResponse(
    discoveryResponse,
    MAX_DISCOVERY_RESPONSE_BYTES,
  ).catch(() => null);
  const discovery = discoveryValue
    && typeof discoveryValue === "object"
    && !Array.isArray(discoveryValue)
    ? discoveryValue as JsonObject
    : null;
  if (
    !discoveryResponse.ok
    || !discovery
    || discovery.issuer !== issuer
    || typeof discovery.jwks_uri !== "string"
    || discovery.jwks_uri.length > 2_048
  ) {
    throw new Error("invalid workload OIDC discovery");
  }
  const jwksUrl = new URL(discovery.jwks_uri);
  if (
    jwksUrl.protocol !== "https:"
    || jwksUrl.origin !== issuer
    || jwksUrl.pathname !== "/.well-known/jwks.json"
    || jwksUrl.username || jwksUrl.password || jwksUrl.search || jwksUrl.hash
  ) {
    throw new Error("invalid workload JWKS origin");
  }
  const jwksResponse = await fetch(jwksUrl, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const jwksValue = await boundedJsonResponse(jwksResponse, MAX_JWKS_RESPONSE_BYTES)
    .catch(() => null);
  const jwks = jwksValue && typeof jwksValue === "object" && !Array.isArray(jwksValue)
    ? jwksValue as JsonObject
    : null;
  const keys = jwks && Array.isArray(jwks.keys) && jwks.keys.length <= 32
    ? jwks.keys
    : [];
  const key = keys.find((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as JsonObject;
    return row.kid === kid
      && row.kty === "RSA"
      && row.alg === "RS256"
      && (row.use === undefined || row.use === "sig");
  });
  if (
    !jwksResponse.ok
    || !key
    || typeof (key as JsonObject).n !== "string"
    || !/^[A-Za-z0-9_-]{128,2048}$/.test((key as JsonObject).n as string)
    || typeof (key as JsonObject).e !== "string"
    || !/^[A-Za-z0-9_-]{1,8}$/.test((key as JsonObject).e as string)
  ) {
    throw new Error("workload signing key was not found");
  }
  return createPublicKey({ key: key as JsonWebKey, format: "jwk" });
}

export async function verifyWorkloadOidcToken(
  token: string,
): Promise<VerifiedWorkloadOidc> {
  try {
    if (
      token.length < 100
      || token.length > 32 * 1_024
      || /\s/.test(token)
    ) {
      throw new Error("invalid token");
    }
    const segments = token.split(".");
    if (segments.length !== 3) throw new Error("invalid JWT");
    const [encodedHeader, encodedClaims, encodedSignature] = segments;
    const header = decodeJson(encodedHeader);
    const claims = decodeJson(encodedClaims);
    const kid = requiredClaim(header, "kid", /^[A-Za-z0-9._-]{1,200}$/);
    if (
      header.alg !== "RS256"
      || (
        header.typ !== undefined
        && header.typ !== "JWT"
        && header.typ !== "jwt"
      )
    ) {
      throw new Error("invalid JWT algorithm");
    }
    const issuer = requiredClaim(claims, "iss", /^https:\/\/identity\.dopedb\.dev$/);
    const audience = requiredClaim(claims, "aud", /^https:\/\/iam\.googleapis\.com$/);
    const subject = requiredClaim(claims, "sub", /^dopedb:workspace:production$/);
    const accountId = requiredClaim(claims, "account_id", /^[a-f0-9]{32}$/);
    const workloadId = requiredClaim(claims, "workload_id", /^[a-f0-9-]{36}$/);
    if (claims.environment !== "production"
      || issuer !== process.env.OIDC_ISSUER
      || audience !== process.env.OIDC_AUDIENCE
      || subject !== process.env.OIDC_SUBJECT
      || accountId !== process.env.OIDC_ACCOUNT_ID
      || workloadId !== process.env.OIDC_WORKLOAD_ID) {
      throw new Error("unexpected production workload identity");
    }
    const now = Math.floor(Date.now() / 1_000);
    const issuedAt = claims.iat;
    const notBefore = claims.nbf;
    const expiresAt = claims.exp;
    if (
      typeof issuedAt !== "number"
      || typeof notBefore !== "number"
      || typeof expiresAt !== "number"
      || !Number.isSafeInteger(issuedAt)
      || !Number.isSafeInteger(notBefore)
      || !Number.isSafeInteger(expiresAt)
      || issuedAt > now + 60
      || notBefore > now + 60
      || expiresAt <= now + 30
      || expiresAt <= issuedAt
      || expiresAt - issuedAt > MAX_WORKLOAD_TOKEN_LIFETIME_SECONDS
    ) {
      throw new Error("invalid workload token lifetime");
    }
    const key = await publicKey(issuer, kid);
    const signature = Buffer.from(encodedSignature, "base64url");
    if (
      signature.toString("base64url") !== encodedSignature
      || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)
      || signature.length < 128
      || !verify(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        key,
        signature,
      )
    ) {
      throw new Error("invalid workload token signature");
    }
    return {
      issuer,
      audience,
      subject,
      accountId,
      workloadId,
      environment: "production",
    };
  } catch {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "The production workload deployment identity could not be verified",
      503,
    );
  }
}
