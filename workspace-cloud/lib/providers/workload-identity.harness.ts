// Real signatures protect the service-binding/public-HTTP boundary and the
// exact production identity accepted for Google federation. Keys are ephemeral.
import { generateKeyPairSync } from "node:crypto";
import { expect, vi } from "vitest";
import {
  identityMetadataResponse,
  issueWorkloadIdentity,
} from "../../infrastructure/workload-identity-core";
import { verifyWorkloadOidcToken } from "./workload-oidc";
import { workloadOidcToken } from "../workload-identity";

export async function assertWorkloadIdentityContract() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const metadata = { kid: "dopedb-fixture-key-01", alg: "RS256", use: "sig" };
  const configuration = {
    OIDC_ISSUER: "https://identity.dopedb.dev",
    OIDC_AUDIENCE: "https://iam.googleapis.com",
    OIDC_ACCOUNT_ID: "a".repeat(32),
    OIDC_WORKLOAD_ID: "afad8e54-82bc-4a32-8e39-eaef70a7db7e",
    OIDC_SUBJECT: "dopedb:workspace:production",
    OIDC_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), ...metadata }),
    OIDC_PUBLIC_KEYS: JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), ...metadata }] }),
  };
  for (const [key, value] of Object.entries(configuration)) vi.stubEnv(key, value);
  try {
    vi.stubGlobal("fetch", vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      expect(new URL(request.url).origin).toBe(configuration.OIDC_ISSUER);
      expect(request.redirect).toBe("manual");
      return identityMetadataResponse(request, configuration);
    }));
    const token = await issueWorkloadIdentity(configuration);
    expect(await verifyWorkloadOidcToken(token)).toMatchObject({
      issuer: configuration.OIDC_ISSUER,
      accountId: configuration.OIDC_ACCOUNT_ID,
      workloadId: configuration.OIDC_WORKLOAD_ID,
      subject: configuration.OIDC_SUBJECT,
    });
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(claims.exp - claims.iat).toBe(900);
    const altered = `${token.split(".").slice(0, 2).join(".")}.${"A".repeat(342)}`;
    await expect(verifyWorkloadOidcToken(altered)).rejects.toThrow();
    vi.stubEnv("OIDC_WORKLOAD_ID", "bfad8e54-82bc-4a32-8e39-eaef70a7db7e");
    await expect(verifyWorkloadOidcToken(token)).rejects.toThrow();
    vi.stubEnv("OIDC_WORKLOAD_ID", configuration.OIDC_WORKLOAD_ID);
    vi.spyOn(Date, "now").mockReturnValue((claims.exp + 1) * 1_000);
    await expect(verifyWorkloadOidcToken(token)).rejects.toThrow();
    vi.restoreAllMocks();
    const publicKeys = await identityMetadataResponse(
      new Request(`${configuration.OIDC_ISSUER}/.well-known/jwks.json`), configuration,
    ).json();
    expect(Object.keys(publicKeys.keys[0]).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
    for (const path of ["/token", "/issueToken", "/"]) {
      expect(identityMetadataResponse(new Request(`${configuration.OIDC_ISSUER}${path}`),
        configuration).status).toBe(404);
    }
    expect(identityMetadataResponse(new Request(`${configuration.OIDC_ISSUER}/token`, {
      method: "POST",
    }), configuration).status).toBe(405);
    await expect(issueWorkloadIdentity({ ...configuration, OIDC_SUBJECT: "dopedb:workspace:preview" }))
      .rejects.toThrow();
    vi.stubEnv("WORKSPACE_RUNTIME", "local");
    expect(await workloadOidcToken()).toBeNull();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
}
