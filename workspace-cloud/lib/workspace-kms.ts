// Cloud KMS envelope boundary for workspace data keys. Authentication uses only
// the service-bound production workload OIDC token and GCP Workload Identity Federation;
// service-account keys and reusable Google credentials have no representation.
import "server-only";

import { boundedJsonResponse } from "./bounded-json-response";
import { env } from "./env";
import { workloadOidcToken } from "./workload-identity";
import {
  crc32c,
  parseKmsDecryptResponse,
  parseKmsEncryptResponse,
  parseWorkspaceKmsConfiguration,
  workspaceDataKeyAad,
  WorkspaceKmsError,
  type WorkspaceKmsConfiguration,
} from "./workspace-kms-core";

const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS_ORIGIN = "https://iamcredentials.googleapis.com";
const KMS_ORIGIN = "https://cloudkms.googleapis.com";
const CLOUD_KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_KMS_RESPONSE_BYTES = 128 * 1_024;

type JsonObject = Record<string, unknown>;

function object(value: unknown, kind: WorkspaceKmsError["kind"]): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceKmsError(kind, 502);
  }
  return value as JsonObject;
}

function requiredToken(value: unknown, kind: WorkspaceKmsError["kind"]) {
  if (typeof value !== "string" || value.length < 20 || value.length > 32 * 1_024 || /\s/.test(value)) {
    throw new WorkspaceKmsError(kind, 502);
  }
  return value;
}

function normalizeStatus(status: number) {
  if (status === 401 || status === 403 || status === 409 || status === 429) return status;
  return status >= 500 ? 502 : 400;
}

async function jsonRequest(
  kind: WorkspaceKmsError["kind"],
  url: string,
  init: RequestInit,
) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => {
    throw new WorkspaceKmsError("unavailable", 503);
  });
  const body = await boundedJsonResponse(response, MAX_KMS_RESPONSE_BYTES)
    .catch(() => null);
  if (!response.ok) throw new WorkspaceKmsError(kind, normalizeStatus(response.status));
  return object(body, kind);
}

export function workspaceKmsConfiguration(): WorkspaceKmsConfiguration {
  return parseWorkspaceKmsConfiguration({
    keyName: env.workspaceKmsKeyName(),
    workloadIdentityAudience: env.workspaceKmsWifAudience(),
    serviceAccountEmail: env.workspaceKmsServiceAccountEmail(),
  });
}

export async function workspaceKmsOidcToken() {
  const value = await workloadOidcToken();
  if (
    !value
    || value.length < 100
    || value.length > 32 * 1_024
    || value.split(".").length !== 3
    || /\s/.test(value)
  ) {
    throw new WorkspaceKmsError("oidc", 503);
  }
  return value;
}

export async function workspaceKmsAccessToken(
  configuration: WorkspaceKmsConfiguration,
  oidcToken: string,
) {
  const federation = await jsonRequest("federation", STS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audience: configuration.workloadIdentityAudience,
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      subjectToken: oidcToken,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });
  const federatedToken = requiredToken(federation.access_token, "federation");
  const impersonation = await jsonRequest(
    "impersonation",
    `${IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/${
      encodeURIComponent(configuration.serviceAccountEmail)
    }:generateAccessToken`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${federatedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: [CLOUD_KMS_SCOPE], lifetime: "900s" }),
    },
  );
  return requiredToken(impersonation.accessToken, "impersonation");
}

export async function wrapWorkspaceDataKey(input: {
  configuration: WorkspaceKmsConfiguration;
  accessToken: string;
  workspaceId: string;
  dataKeyId: string;
  version: number;
  plaintextKey: Buffer;
}) {
  if (input.plaintextKey.length !== 32) throw new WorkspaceKmsError("integrity", 409);
  const aad = workspaceDataKeyAad(input.workspaceId, input.dataKeyId, input.version);
  try {
    const response = await jsonRequest(
      "encrypt",
      `${KMS_ORIGIN}/v1/${input.configuration.keyName}:encrypt`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          plaintext: input.plaintextKey.toString("base64"),
          additionalAuthenticatedData: aad.toString("base64"),
          plaintextCrc32c: String(crc32c(input.plaintextKey)),
          additionalAuthenticatedDataCrc32c: String(crc32c(aad)),
        }),
      },
    );
    return parseKmsEncryptResponse(response, input.configuration.keyName);
  } finally {
    aad.fill(0);
  }
}

export async function unwrapWorkspaceDataKey(input: {
  configuration: WorkspaceKmsConfiguration;
  accessToken: string;
  workspaceId: string;
  dataKeyId: string;
  version: number;
  wrappedKey: string;
}) {
  const aad = workspaceDataKeyAad(input.workspaceId, input.dataKeyId, input.version);
  const wrappedBytes = Buffer.from(input.wrappedKey, "base64");
  try {
    if (
      wrappedBytes.length < 1
      || wrappedBytes.length > 8_192
      || wrappedBytes.toString("base64") !== input.wrappedKey
    ) throw new WorkspaceKmsError("integrity", 409);
    const response = await jsonRequest(
      "decrypt",
      `${KMS_ORIGIN}/v1/${input.configuration.keyName}:decrypt`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ciphertext: input.wrappedKey,
          additionalAuthenticatedData: aad.toString("base64"),
          ciphertextCrc32c: String(crc32c(wrappedBytes)),
          additionalAuthenticatedDataCrc32c: String(crc32c(aad)),
        }),
      },
    );
    return parseKmsDecryptResponse(response);
  } finally {
    aad.fill(0);
    wrappedBytes.fill(0);
  }
}
