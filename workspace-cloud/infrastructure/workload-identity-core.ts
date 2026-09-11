// The identity service publishes public keys and signs one fixed production
// workload. Callers cannot select a subject, account, environment, or audience.
export type IdentityConfiguration = {
  OIDC_ISSUER: string;
  OIDC_AUDIENCE: string;
  OIDC_ACCOUNT_ID: string;
  OIDC_WORKLOAD_ID: string;
  OIDC_SUBJECT: string;
  OIDC_SIGNING_KEY: string;
  OIDC_PUBLIC_KEYS: string;
};

type SigningJwk = JsonWebKey & { kid: string };

function publicKeys(configuration: IdentityConfiguration): SigningJwk[] {
  const value = JSON.parse(configuration.OIDC_PUBLIC_KEYS);
  if (!Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 3) {
    throw new Error("Invalid workload identity public keys");
  }
  return value.keys.map((key: SigningJwk) => {
    if (key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig"
      || !/^[a-zA-Z0-9_-]{16,80}$/.test(key.kid)
      || typeof key.n !== "string" || !/^[A-Za-z0-9_-]{342,1024}$/.test(key.n)
      || key.e !== "AQAB" || key.d || key.p || key.q) {
      throw new Error("Invalid workload identity public key");
    }
    return { kty: "RSA", alg: "RS256", use: "sig", kid: key.kid, n: key.n, e: key.e };
  });
}

export function identityMetadataResponse(request: Request, configuration: IdentityConfiguration) {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const value = path === "/.well-known/openid-configuration"
    ? {
        issuer: configuration.OIDC_ISSUER,
        jwks_uri: `${configuration.OIDC_ISSUER}/.well-known/jwks.json`,
        response_types_supported: ["id_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      }
    : path === "/.well-known/jwks.json"
      ? { keys: publicKeys(configuration) }
      : null;
  if (!value) return new Response(null, { status: 404 });
  return new Response(request.method === "HEAD" ? null : JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export async function issueWorkloadIdentity(configuration: IdentityConfiguration) {
  return issueIdentity(configuration, "dopedb:workspace:production");
}

// The analytics service binding has its own fixed subject, which cannot assume
// the workspace's KMS or customer-resource grants.
export async function issueAnalyticsIdentity(configuration: IdentityConfiguration) {
  return issueIdentity(configuration, "dopedb:analytics:production");
}

async function issueIdentity(configuration: IdentityConfiguration, subject: string) {
  if (configuration.OIDC_ISSUER !== "https://identity.dopedb.dev"
    || configuration.OIDC_AUDIENCE !== "https://iam.googleapis.com"
    || !/^[a-f0-9]{32}$/.test(configuration.OIDC_ACCOUNT_ID)
    || !/^[a-f0-9-]{36}$/.test(configuration.OIDC_WORKLOAD_ID)
    || configuration.OIDC_SUBJECT !== "dopedb:workspace:production") {
    throw new Error("Invalid production workload identity");
  }
  const signingKey = JSON.parse(configuration.OIDC_SIGNING_KEY) as SigningJwk;
  const key = publicKeys(configuration).find((candidate) => candidate.kid === signingKey.kid);
  if (!key || key.n !== signingKey.n || key.e !== signingKey.e
    || signingKey.kty !== "RSA" || signingKey.alg !== "RS256" || !signingKey.d) {
    throw new Error("Workload identity signing key does not match its published key");
  }
  const now = Math.floor(Date.now() / 1_000);
  const payload = `${encode({ alg: "RS256", kid: key.kid, typ: "JWT" })}.${encode({
    iss: configuration.OIDC_ISSUER,
    aud: configuration.OIDC_AUDIENCE,
    sub: subject,
    account_id: configuration.OIDC_ACCOUNT_ID,
    workload_id: configuration.OIDC_WORKLOAD_ID,
    environment: "production",
    iat: now,
    nbf: now,
    exp: now + 900,
    jti: crypto.randomUUID(),
  })}`;
  const imported = await crypto.subtle.importKey("jwk", signingKey, {
    name: "RSASSA-PKCS1-v1_5", hash: "SHA-256",
  }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", imported,
    new TextEncoder().encode(payload));
  return `${payload}.${Buffer.from(signature).toString("base64url")}`;
}
