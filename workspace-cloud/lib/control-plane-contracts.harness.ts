// Cross-language fixture coverage for independently deployed Workspace Cloud and
// Desktop. The fixture contains fake secrets; assertions never print or snapshot it.

import { readFileSync } from "node:fs";
import { assertGcpBootstrapReadinessContract } from "./providers/gcp-cloud-bootstrap.harness";
import { assertWorkloadIdentityContract } from "./providers/workload-identity.harness";
import { assertSiteAnalyticsContract } from "./site-analytics.harness";
import { assertDirectAccessContracts } from "./direct-access-contracts.harness";

import { describe, expect, it, vi } from "vitest";

import {
  CONTROL_PLANE_CONTRACTS_SCHEMA_VERSION,
  managedLeaseResponse,
  MANAGED_LEASE_CONTRACT_VERSION,
  parseManagedLeaseRequest,
  parseWorkspaceSyncPage,
} from "./control-plane-contracts";
import { candidateConflictResolution } from "./connection-conflict-decision";
import {
  githubInstallationUserAuthorizationUrl,
  parseGithubInstallationUserAuthorizationState,
  verifyGithubInstallationUserAccess,
} from "./knowledge/github-app";
import {
  analysisArticleVersionPayload,
  parseAnalysisArticleVersionPayload,
  parseSharedAnalysisArticleCreate,
  publicAnalysisArticle,
} from "./workspace-analysis-articles";
import {
  workspaceSchedulerBoundedWakeAt,
  workspaceSchedulerReceipt,
} from "./workspace-background-scheduler";
import {
  parseSharedConnection,
  providerResourceSupportsSchema,
  providerSchemaSetupRequired,
  publicConnection,
} from "./workspace-connections";
import { issueGcpCloudSqlLease } from "./providers/gcp-cloud-sql";
import {
  issueVaultLease,
  parseVaultCredential,
  revokeVaultLease,
  VaultLeaseCleanupRequiredError,
  vaultIntegrationIdentity,
  vaultManagedResource,
  vaultPolicyFingerprint,
  verifyVaultCredential,
} from "./providers/vault";
import {
  createNeonScramVerifier,
  neonPolicyRoleIdentity,
  neonRoleRevokeStatements,
  neonRoleStatements,
  type NeonResource,
} from "./providers/neon-core";
import {
  iamServiceAccountPropagationPending,
  upstreamMessage,
} from "./providers/gcp-cloud-bootstrap-core";
import {
  connectionLeaseRevocationScope,
  EXPECTED_REVISION_HEADER,
  parseExpectedRevision,
  type ConnectionVersionPayload,
} from "./workspace-versioning";
import {
  providerAuthorizationStartDecision,
  providerAuthorizationStartUrl,
} from "./provider-authorization-handoff";

type Fixture = Readonly<{
  schemaVersion: number;
  workspaceSync: Readonly<{
    bootstrap: unknown;
    incremental: unknown;
    reset: unknown;
  }>;
  managedLease: Readonly<{
    contractHeader: string;
    request: unknown;
    response: unknown;
  }>;
  analysisArticleCreate: unknown;
  sharedConnectionTemplates: Readonly<{
    accepted: readonly Readonly<{ name: string; template: unknown }>[];
    rejected: readonly Readonly<{ name: string; template: unknown }>[];
  }>;
  analysisArticleAcceptances: readonly Readonly<{
    name: string;
    mutations: SemanticRejection["mutations"];
  }>[];
  semanticRejections: readonly SemanticRejection[];
  directAccess: Record<string, unknown>;
  directAccessRejections: readonly Readonly<{ name: string; contract: string; mutations: SemanticRejection["mutations"] }>[];
}>;

type SemanticRejection = Readonly<{
  name: string;
  contract:
    | "workspaceSyncBootstrap"
    | "workspaceSyncIncremental"
    | "managedLeaseRequest"
    | "managedLeaseResponse"
    | "analysisArticleCreate";
  mutations: readonly Readonly<{
    path: readonly (string | number)[];
    value: unknown;
  }>[];
}>;

const fixture = JSON.parse(readFileSync(
  new URL(
    "../../dopedb-protocol/tests/fixtures/control-plane-contracts-v1.json",
    import.meta.url,
  ),
  "utf8",
)) as Fixture;

function applySemanticMutations(base: unknown, rejection: SemanticRejection) {
  const candidate: unknown = structuredClone(base);
  for (const mutation of rejection.mutations) {
    const last = mutation.path.at(-1);
    if (last === undefined) throw new Error("Semantic rejection path must not be empty");
    let cursor = candidate;
    for (const segment of mutation.path.slice(0, -1)) {
      if (typeof segment === "number" && Array.isArray(cursor)) {
        cursor = cursor[segment];
      } else if (typeof segment === "string" && cursor && typeof cursor === "object") {
        cursor = (cursor as Record<string, unknown>)[segment];
      } else {
        throw new Error("Semantic rejection path is invalid");
      }
    }
    if (typeof last === "number" && Array.isArray(cursor)) {
      cursor[last] = structuredClone(mutation.value);
    } else if (typeof last === "string" && cursor && typeof cursor === "object") {
      (cursor as Record<string, unknown>)[last] = structuredClone(mutation.value);
    } else {
      throw new Error("Semantic rejection target is invalid");
    }
  }
  return candidate;
}

describe("Connection conflict decisions", () => {
  it("closes an already-matching server revision without creating a false candidate result", () => {
    expect(candidateConflictResolution({
      currentMatchesServer: true,
      currentMatchesCandidate: true,
    })).toBe("server");
    expect(candidateConflictResolution({
      currentMatchesServer: true,
      currentMatchesCandidate: false,
    })).toBe("candidate");
    expect(candidateConflictResolution({
      currentMatchesServer: false,
      currentMatchesCandidate: true,
    })).toBe("candidate");
    expect(candidateConflictResolution({
      currentMatchesServer: false,
      currentMatchesCandidate: false,
    })).toBe("candidate");
  });
});

describe("Provider authorization start boundary", () => {
  it("sends only the account that started the authorization on to the provider", () => {
    const userId = "user-desktop-owner";
    for (const state of [
      null,
      { userId, provider: "neon" },
      { userId, provider: "vault" },
      { userId, provider: "PlanetScale" },
      { userId, provider: "" },
    ]) {
      expect(providerAuthorizationStartDecision({ state, sessionUserId: userId }))
        .toBe("invalid");
    }
    for (const provider of ["planetScale", "gcpCloudSql"] as const) {
      const state = { userId, provider };
      for (const sessionUserId of [null, ""]) {
        expect(providerAuthorizationStartDecision({ state, sessionUserId })).toBe("sign_in");
      }
      expect(providerAuthorizationStartDecision({ state, sessionUserId: "user-other" }))
        .toBe("account_mismatch");
      expect(providerAuthorizationStartDecision({ state, sessionUserId: userId }))
        .toBe("redirect");
    }

    // Desktop opens only this origin's start page; the one-use state is its only
    // query parameter, even when the value carries URL syntax.
    vi.stubEnv("BETTER_AUTH_URL", "https://app.dopedb.dev");
    try {
      for (const state of ["s".repeat(43), `${"s".repeat(32)}&next=https://example.test/#x`]) {
        const startUrl = new URL(providerAuthorizationStartUrl(state));
        expect(startUrl.origin).toBe("https://app.dopedb.dev");
        expect(startUrl.pathname).toBe("/auth/provider/start");
        expect([...startUrl.searchParams.keys()]).toEqual(["state"]);
        expect(startUrl.searchParams.get("state")).toBe(state);
        expect(startUrl.hash).toBe("");
        expect(`${startUrl.username}${startUrl.password}`).toBe("");
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Optimistic revision transport", () => {
  it("uses only the dedicated expected-revision header", () => {
    const request = new Request("https://app.dopedb.dev/example", {
      headers: { [EXPECTED_REVISION_HEADER]: "7" },
    });
    expect(parseExpectedRevision(request)).toBe(7);
    expect(parseExpectedRevision(new Request("https://app.dopedb.dev/example")))
      .toBeNull();
  });

  it("rejects malformed expected revisions", () => {
    expect(() => parseExpectedRevision(new Request("https://app.dopedb.dev/example", {
      headers: { [EXPECTED_REVISION_HEADER]: '"7"' },
    }))).toThrow(EXPECTED_REVISION_HEADER);
  });
});

describe("Vault dynamic database credential boundary", () => {
  const configuredCredential = () => parseVaultCredential({
    kind: "appRole",
    schemaVersion: 1,
    address: "https://vault.example.test:8200",
    namespace: null,
    authMount: "approle",
    roleId: "role-id-1234",
    secretId: "secret-id-1234",
    databaseMount: "database",
    databaseConnection: "dopedb-postgres",
    readRole: "dopedb-read",
    writeRole: null,
    target: {
      host: "postgres.internal.example.test",
      port: 5432,
      database: "app",
      engine: "postgres",
      sslmode: "verify-full",
      production: false,
    },
  });

  function withVaultOrigin<T>(run: () => T) {
    const previous = process.env.VAULT_BROKER_ORIGINS;
    process.env.VAULT_BROKER_ORIGINS = "https://vault.example.test:8200";
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env.VAULT_BROKER_ORIGINS;
      else process.env.VAULT_BROKER_ORIGINS = previous;
    }
  }

  it("accepts only an exact allowlisted HTTPS target and rejects unknown fields", () => {
    withVaultOrigin(() => {
      expect(configuredCredential().target.sslmode).toBe("verify-full");
      const rotatedSecret = parseVaultCredential({
        ...configuredCredential(),
        roleId: "rotated-role-id",
        secretId: "rotated-secret-id",
      });
      expect(vaultIntegrationIdentity(rotatedSecret).externalAccountId).toBe(
        vaultIntegrationIdentity(configuredCredential()).externalAccountId,
      );
      expect(vaultPolicyFingerprint(rotatedSecret)).toBe(
        vaultPolicyFingerprint(configuredCredential()),
      );
      const changedRole = parseVaultCredential({
        ...configuredCredential(),
        readRole: "dopedb-read-v2",
      });
      expect(vaultIntegrationIdentity(changedRole).externalAccountId).toBe(
        vaultIntegrationIdentity(configuredCredential()).externalAccountId,
      );
      expect(vaultPolicyFingerprint(changedRole)).not.toBe(
        vaultPolicyFingerprint(configuredCredential()),
      );
      const changedClassification = parseVaultCredential({
        ...configuredCredential(),
        target: {
          ...configuredCredential().target,
          production: true,
        },
      });
      expect(vaultPolicyFingerprint(changedClassification)).not.toBe(
        vaultPolicyFingerprint(configuredCredential()),
      );
      expect(() => parseVaultCredential({
        ...configuredCredential(),
        address: "https://other.example.test",
      })).toThrow("Invalid Vault AppRole configuration");
      expect(() => parseVaultCredential({
        ...configuredCredential(),
        unexpected: true,
      })).toThrow("Invalid Vault AppRole configuration");
      expect(() => parseVaultCredential({
        ...configuredCredential(),
        target: {
          ...configuredCredential().target,
          sslmode: "verify-ca",
        },
      })).toThrow("Invalid Vault AppRole configuration");
      expect(() => parseVaultCredential({
        ...configuredCredential(),
        target: {
          ...configuredCredential().target,
          host: "/var/run/postgresql",
        },
      })).toThrow("Invalid Vault AppRole configuration");
    });
  });

  it("issues and synchronously revokes a bounded credential without exposing the AppRole", async () => {
    const previous = process.env.VAULT_BROKER_ORIGINS;
    process.env.VAULT_BROKER_ORIGINS = "https://vault.example.test:8200";
    const credential = configuredCredential();
    const requests: Array<{ url: string; method: string; headers: Headers }> = [];
    let credentialSequence = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const headers = new Headers(init?.headers);
        requests.push({ url, method, headers });
        if (url.endsWith("/v1/auth/approle/login")) {
          return Response.json({
            request_id: "vault-login-request",
            auth: {
              client_token: "vault-session-token",
              lease_duration: 300,
              token_type: "service",
              token_policies: ["default", "dopedb-database-broker"],
            },
          });
        }
        if (url.endsWith("/v1/database/config/dopedb-postgres")) {
          return Response.json({
            request_id: "vault-connection-request",
            data: {
              plugin_name: "postgresql-database-plugin",
              allowed_roles: ["dopedb-read"],
              connection_details: {
                connection_url: "postgresql://{{username}}:{{password}}@postgres.internal.example.test:5432/app?sslmode=verify-full",
              },
            },
          });
        }
        if (url.endsWith("/v1/database/config/dopedb-mysql")) {
          return Response.json({
            request_id: "vault-mysql-connection-request",
            data: {
              plugin_name: "mysql-database-plugin",
              allowed_roles: ["dopedb-read-mysql"],
              connection_details: {
                connection_url: "{{username}}:{{password}}@tcp(mysql.internal.example.test:3306)/app?tls=true",
              },
            },
          });
        }
        if (url.endsWith("/v1/database/roles/dopedb-read")) {
          return Response.json({
            request_id: "vault-role-request",
            data: {
              default_ttl: 300,
              max_ttl: 900,
              db_name: "dopedb-postgres",
              credential_type: "password",
            },
          });
        }
        if (url.endsWith("/v1/database/creds/dopedb-read")) {
          credentialSequence += 1;
          return Response.json({
            request_id: `vault-credential-request-${credentialSequence}`,
            lease_id: `database/creds/dopedb-read/lease-${credentialSequence}`,
            lease_duration: 300,
            data: {
              username: `dopedb_member_${credentialSequence}`,
              password: `database-secret-${credentialSequence}`,
            },
          });
        }
        if (url.endsWith("/v1/database/roles/dopedb-read-mysql")) {
          return Response.json({
            request_id: "vault-mysql-role-request",
            data: {
              default_ttl: 300,
              max_ttl: 900,
              db_name: "dopedb-mysql",
              credential_type: "password",
            },
          });
        }
        if (url.endsWith("/v1/database/creds/dopedb-read-mysql")) {
          return Response.json({
            request_id: "vault-mysql-credential-request",
            lease_id: "database/creds/dopedb-read-mysql/lease",
            lease_duration: 300,
            data: {
              username: "dopedb_mysql_member",
              password: "mysql-database-secret",
            },
          });
        }
        if (
          url.endsWith("/v1/sys/leases/revoke")
          || url.endsWith("/v1/auth/token/revoke-self")
        ) {
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 404 });
      },
    );
    try {
      await verifyVaultCredential(credential);
      const lease = await issueVaultLease({
        credential,
        resource: vaultManagedResource(credential),
        accessMode: "read",
      });
      expect(lease).toMatchObject({
        externalCredentialKind: "role",
        username: "dopedb_member_2",
        password: "database-secret-2",
        sslmode: "verify-full",
      });
      // Revoking the issuing AppRole token here would also revoke the database
      // credential before Desktop can use it. Only the setup-verification token
      // has been revoked at this point.
      expect(requests.filter((request) => (
        request.url.endsWith("/v1/auth/token/revoke-self")
      ))).toHaveLength(1);
      await revokeVaultLease(credential, lease.externalCredentialId);
      expect(requests.every((request) => (
        request.url.startsWith("https://vault.example.test:8200/v1/")
      ))).toBe(true);
      expect(requests.filter((request) => (
        request.url.endsWith("/v1/database/config/dopedb-postgres")
      ))).toHaveLength(2);
      expect(requests.filter((request) => (
        request.url.endsWith("/v1/sys/leases/revoke")
      ))).toHaveLength(2);
      expect(requests.filter((request) => (
        request.url.endsWith("/v1/auth/token/revoke-self")
      ))).toHaveLength(2);
      expect(requests.find((request) => (
        request.url.endsWith("/v1/database/creds/dopedb-read")
      ))?.headers.get("x-vault-token")).toBe("vault-session-token");
      expect(JSON.stringify(requests)).not.toContain("secret-id-1234");
      const mismatchedTarget = parseVaultCredential({
        ...credential,
        target: {
          ...credential.target,
          host: "other-postgres.internal.example.test",
        },
      });
      await expect(verifyVaultCredential(mismatchedTarget)).rejects.toThrow(
        "exact TLS-verified target",
      );
      const mysqlCredential = parseVaultCredential({
        ...credential,
        databaseConnection: "dopedb-mysql",
        readRole: "dopedb-read-mysql",
        target: {
          ...credential.target,
          host: "mysql.internal.example.test",
          port: 3306,
          engine: "mysql",
        },
      });
      await expect(verifyVaultCredential(mysqlCredential)).resolves.toMatchObject({
        providerAuditId: "vault-login-request",
      });
    } finally {
      fetchMock.mockRestore();
      if (previous === undefined) delete process.env.VAULT_BROKER_ORIGINS;
      else process.env.VAULT_BROKER_ORIGINS = previous;
    }
  });

  it("queues provider cleanup when an unsafe lease cannot be synchronously revoked", async () => {
    const previous = process.env.VAULT_BROKER_ORIGINS;
    process.env.VAULT_BROKER_ORIGINS = "https://vault.example.test:8200";
    const credential = configuredCredential();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/auth/approle/login")) {
          return Response.json({
            request_id: "vault-login-request",
            auth: {
              client_token: "vault-session-token",
              lease_duration: 300,
              token_type: "service",
              token_policies: ["default", "dopedb-database-broker"],
            },
          });
        }
        if (url.endsWith("/v1/database/config/dopedb-postgres")) {
          return Response.json({
            request_id: "vault-connection-request",
            data: {
              plugin_name: "postgresql-database-plugin",
              allowed_roles: ["dopedb-read"],
              connection_details: {
                connection_url: "postgresql://{{username}}:{{password}}@postgres.internal.example.test:5432/app?sslmode=verify-full",
              },
            },
          });
        }
        if (url.endsWith("/v1/database/roles/dopedb-read")) {
          return Response.json({
            request_id: "vault-role-request",
            data: {
              default_ttl: 300,
              max_ttl: 900,
              db_name: "dopedb-postgres",
              credential_type: "password",
            },
          });
        }
        if (url.endsWith("/v1/database/creds/dopedb-read")) {
          return Response.json({
            request_id: "vault-unsafe-request",
            lease_id: "database/creds/dopedb-read/unsafe-lease",
            lease_duration: 901,
            data: { username: "unsafe_member", password: "unsafe-secret" },
          });
        }
        if (url.endsWith("/v1/sys/leases/revoke")) {
          return new Response(null, { status: 503 });
        }
        if (url.endsWith("/v1/auth/token/revoke-self")) {
          return new Response(null, { status: 503 });
        }
        return new Response(null, { status: 404 });
      },
    );
    try {
      await expect(issueVaultLease({
        credential,
        resource: vaultManagedResource(credential),
        accessMode: "read",
      })).rejects.toMatchObject({
        name: "VaultLeaseCleanupRequiredError",
        externalCredentialId: "database/creds/dopedb-read/unsafe-lease",
      } satisfies Partial<VaultLeaseCleanupRequiredError>);
    } finally {
      fetchMock.mockRestore();
      if (previous === undefined) delete process.env.VAULT_BROKER_ORIGINS;
      else process.env.VAULT_BROKER_ORIGINS = previous;
    }
  });
});

describe("GitHub installation authorization state", () => {
  it("binds the setup nonce and installation id to an exact PKCE callback", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.dopedb.dev");
    vi.stubEnv("GITHUB_KNOWLEDGE_CLIENT_ID", "Iv1.dopedbtestclient01");
    vi.stubEnv(
      "GITHUB_KNOWLEDGE_CLIENT_SECRET",
      "0123456789abcdef0123456789abcdef01234567",
    );
    try {
      const setupState = "a".repeat(43);
      const authorizationUrl = new URL(
        githubInstallationUserAuthorizationUrl(setupState, 123n),
      );
      expect(authorizationUrl.origin).toBe("https://github.com");
      expect(authorizationUrl.pathname).toBe("/login/oauth/authorize");
      expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
        "https://app.dopedb.dev/api/v1/knowledge/github/callback",
      );
      expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
      const signedState = authorizationUrl.searchParams.get("state") ?? "";
      const parsedState = parseGithubInstallationUserAuthorizationState(signedState);
      expect(parsedState).toMatchObject({ setupState, installationId: 123n });
      expect(() => parseGithubInstallationUserAuthorizationState(
        signedState.replace(".123.", ".124."),
      )).toThrow("Invalid GitHub installation authorization state");
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({
          access_token: `ghu_${"t".repeat(36)}`,
          token_type: "bearer",
        }), { headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          total_count: 1,
          installations: [{ id: 123 }],
        }), { headers: { "content-type": "application/json" } }));
      await expect(verifyGithubInstallationUserAccess(
        "b".repeat(40),
        parsedState,
      )).resolves.toBe(true);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
        "https://github.com/login/oauth/access_token",
      );
      expect(new URLSearchParams(
        String(fetchSpy.mock.calls[0]?.[1]?.body),
      ).get("code_verifier")).toBe(parsedState.pkceEntropy);
      expect(String(fetchSpy.mock.calls[1]?.[0])).toContain(
        "/user/installations?per_page=100&page=1",
      );
      fetchSpy.mockRestore();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });
});

describe("Desktop control-plane contracts", () => {
  it("decodes the same strict sync, lease, and Analysis Article goldens as Rust", async () => {
    await assertGcpBootstrapReadinessContract();
    await assertWorkloadIdentityContract();
    await assertSiteAnalyticsContract();
    expect(fixture.schemaVersion).toBe(CONTROL_PLANE_CONTRACTS_SCHEMA_VERSION);
    const schedulerNow = new Date("2026-08-15T18:12:30Z");
    expect(workspaceSchedulerBoundedWakeAt(null, schedulerNow)).toBeNull();
    expect(workspaceSchedulerReceipt(null)).toEqual({
      contractVersion: 2,
      nextRunAt: null,
    });
    expect(workspaceSchedulerBoundedWakeAt("2026-08-15T18:30:00Z", schedulerNow)?.toISOString())
      .toBe("2026-08-15T18:30:00.000Z");
    expect(workspaceSchedulerBoundedWakeAt("2026-08-15T22:00:00Z", schedulerNow)?.toISOString())
      .toBe("2026-08-15T22:00:00.000Z");
    for (const page of [
      fixture.workspaceSync.bootstrap,
      fixture.workspaceSync.incremental,
      fixture.workspaceSync.reset,
    ]) {
      expect(parseWorkspaceSyncPage(page)).toEqual(page);
    }
    expect(fixture.managedLease.contractHeader).toBe(MANAGED_LEASE_CONTRACT_VERSION);
    expect(parseManagedLeaseRequest(fixture.managedLease.request))
      .toEqual(fixture.managedLease.request);
    expect(parseManagedLeaseRequest({ accessMode: "schema" }))
      .toEqual({ accessMode: "schema" });
    for (const scope of [null, "", "cloudsql.read cloudsql.write", "cloudsql.schema.extra"]) {
      expect(providerSchemaSetupRequired("gcpCloudSql", scope)).toBe(true);
      expect(providerResourceSupportsSchema({
        provider: "gcpCloudSql", engine: "postgres", grantedScope: scope,
        capabilityManifest: { importReadOnly: true, managedLease: true, write: true },
      })).toBe(false);
    }
    const configuredSchema = {
      provider: "gcpCloudSql", engine: "postgres",
      grantedScope: "cloudsql.read cloudsql.write cloudsql.schema",
      capabilityManifest: { importReadOnly: true, managedLease: true, write: true },
    };
    expect(providerResourceSupportsSchema(configuredSchema)).toBe(true);
    expect(providerResourceSupportsSchema({ ...configuredSchema, engine: "mysql" })).toBe(false);
    expect(providerResourceSupportsSchema({ ...configuredSchema, capabilityManifest: { write: true } })).toBe(false);
    const schemaFetch = vi.spyOn(globalThis, "fetch");
    try {
      await expect(issueGcpCloudSqlLease({
        credential: {
          projectId: "dopedb-fixture", projectNumber: "123456789012",
          workloadIdentityPoolId: "dopedb-pool", workloadIdentityProviderId: "dopedb-provider",
          instanceId: "fixture-db", databaseNames: ["app"],
          readServiceAccountEmail: "read@dopedb-fixture.iam.gserviceaccount.com",
          writeServiceAccountEmail: "write@dopedb-fixture.iam.gserviceaccount.com",
          schemaServiceAccountEmail: null, workloadIdentitySubject: "dopedb:workspace:production",
          dedicatedServiceAccountsConfirmed: true, instanceScopedIamConfirmed: true,
        },
        oidcToken: "fixture", externalCredentialId: "fixture-schema-lease",
        resource: { project: "dopedb-fixture", instance: "fixture-db", database: "app", engine: "postgres", networkMode: "PUBLIC", production: false },
        accessMode: "schema",
      })).rejects.toMatchObject({
        status: 403,
        message: "Managed schema access requires a separately verified schema credential. Reconnecting only restores data access",
      });
      expect(schemaFetch).not.toHaveBeenCalled();
    } finally {
      schemaFetch.mockRestore();
    }
    expect(providerSchemaSetupRequired("gcpCloudSql", "cloudsql.read cloudsql.write cloudsql.schema"))
      .toBe(false);
    expect(providerSchemaSetupRequired("neon", null)).toBe(false);
    const lease = managedLeaseResponse(fixture.managedLease.response);
    expect(lease.lease.provider).toBe("gcpCloudSql");
    expect(lease.lease.connector?.kind).toBe("gcpCloudSqlAuthProxy");
    const gcpSchemaLease = managedLeaseResponse({
      lease: {
        ...(fixture.managedLease.response as { lease: object }).lease,
        accessMode: "schema",
      },
    });
    expect(gcpSchemaLease.lease.accessMode).toBe("schema");
    expect(managedLeaseResponse({ lease: { ...gcpSchemaLease.lease, schemaOwner: "migration_owner" } })
      .lease.schemaOwner).toBe("migration_owner");
    for (const schemaOwner of [null, "postgres", "pg_read_all_data", "cloudsqlsuperuser", "owner;RESET ROLE", "x".repeat(64)]) {
      expect(() => managedLeaseResponse({ lease: { ...gcpSchemaLease.lease, schemaOwner } })).toThrow();
    }
    expect(() => managedLeaseResponse({ lease: { ...lease.lease, schemaOwner: "migration_owner" } })).toThrow();
    const scoped = { ...configuredSchema, grantedScope: "cloudsql.read cloudsql.schema:app", database: "app" };
    expect(providerResourceSupportsSchema(scoped)).toBe(true);
    expect(providerResourceSupportsSchema({ ...scoped, database: "other" })).toBe(false);
    expect(providerResourceSupportsSchema({ ...scoped, database: undefined })).toBe(false);
    expect(() => managedLeaseResponse({
      lease: {
        ...(fixture.managedLease.response as { lease: object }).lease,
        provider: "planetScale",
        connector: undefined,
        accessMode: "schema",
      },
    })).toThrow("Invalid managed lease response contract");
    const schemaResource: NeonResource = {
      project: "project-1",
      branch: "branch-1",
      databaseId: "42",
      database: "app",
      engine: "postgres",
      schemas: ["public"],
    };
    const policyOwner = neonPolicyRoleIdentity(schemaResource).name;
    const schemaRole = "dopedb_12345678_11111111111111111111111111111111";
    const schemaStatements = neonRoleStatements({
      role: schemaRole,
      owner: "app_owner",
      policyOwner,
      passwordVerifier: createNeonScramVerifier("a".repeat(43)),
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
      accessMode: "schema",
      database: schemaResource.database,
      schemas: schemaResource.schemas,
    });
    expect(schemaStatements).toContain(
      `GRANT "${policyOwner}" TO ${schemaRole} WITH INHERIT FALSE, SET TRUE, ADMIN FALSE`,
    );
    expect(schemaStatements).toContain(
      `GRANT ${schemaRole} TO "app_owner" WITH INHERIT TRUE, SET TRUE`,
    );
    expect(schemaStatements.join(";")).not.toMatch(/ALTER DEFAULT PRIVILEGES|FROM PUBLIC|OWNER TO/);
    for (const accessMode of ["read", "write"] as const) {
      const statements = neonRoleStatements({
        role: schemaRole, owner: "app_owner", policyOwner,
        passwordVerifier: createNeonScramVerifier("a".repeat(43)),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        accessMode, database: schemaResource.database, schemas: schemaResource.schemas,
      });
      expect(statements.join(";")).not.toMatch(/ALTER DEFAULT PRIVILEGES|FROM PUBLIC|OWNER TO/);
    }
    expect(schemaStatements).toContain(
      `ALTER ROLE ${schemaRole} SET role = '${policyOwner}'`,
    );
    expect(schemaStatements.some((statement) => statement.includes("GRANT CREATE")))
      .toBe(false);
    const schemaCleanup = neonRoleRevokeStatements({
      role: schemaRole,
      owner: "app_owner",
      policyOwner,
      defaultPrivilegeOwners: ["app_owner", policyOwner],
      schemaLease: true,
      database: schemaResource.database,
      schemas: schemaResource.schemas,
    });
    expect(schemaCleanup).toContain(
      `REASSIGN OWNED BY ${schemaRole} TO "${policyOwner}"`,
    );
    expect(schemaCleanup[schemaCleanup.length - 1]).toBe(`DROP ROLE ${schemaRole}`);
    expect(schemaCleanup.join(";")).not.toMatch(/ALTER DEFAULT PRIVILEGES|FROM PUBLIC/);
    const neonApi = await import("./providers/neon-api");
    const { retireInheritedNeonLeaseRoles } = await import("./providers/neon-managed-access");
    const ownerLookup = vi.spyOn(neonApi, "ownerConnection").mockResolvedValue({
      connectionUri: "postgresql://fixture.invalid/app",
    } as Awaited<ReturnType<typeof neonApi.ownerConnection>>);
    const queries = vi.fn().mockResolvedValue([{ rolname: schemaRole }]);
    const transaction = vi.fn();
    const client = vi.spyOn(neonApi, "sqlClient").mockReturnValue({
      query: queries, transaction,
    } as unknown as ReturnType<typeof neonApi.sqlClient>);
    try {
      const branchInput = {
        credential: { kind: "apiKey", schemaVersion: 2, apiKey: "fixture", projectId: null, organizationId: null },
        projectId: "project-1", branchId: "branch-1",
        databases: [{ id: "42", name: "app", value: "app" }],
      } satisfies Parameters<typeof retireInheritedNeonLeaseRoles>[0];
      await expect(retireInheritedNeonLeaseRoles(branchInput))
        .rejects.toBeInstanceOf(neonApi.NeonInheritedCredentialFenceConflictError);
      expect(transaction).not.toHaveBeenCalled();
      expect(queries).toHaveBeenCalledTimes(1);
      expect(queries.mock.calls[0][0]).toMatch(/^SELECT /);
      queries.mockResolvedValue([]);
      expect((await retireInheritedNeonLeaseRoles(branchInput)).retiredInheritedRoleCount).toBe(0);
      expect(transaction).not.toHaveBeenCalled();
    } finally { ownerLookup.mockRestore(); client.mockRestore(); }
    const brokeredGeneric = structuredClone(
      fixture.managedLease.response,
    ) as { lease: Record<string, unknown> };
    brokeredGeneric.lease.provider = "generic";
    delete brokeredGeneric.lease.connector;
    expect(managedLeaseResponse(brokeredGeneric).lease.provider).toBe("generic");
    expect(parseSharedAnalysisArticleCreate(fixture.analysisArticleCreate))
      .toEqual(fixture.analysisArticleCreate);
    const articleCreate = parseSharedAnalysisArticleCreate(fixture.analysisArticleCreate);
    const articleVersion = analysisArticleVersionPayload({
      ...articleCreate, ownerMemberId: "article-owner",
    });
    expect(parseAnalysisArticleVersionPayload(articleVersion)).toEqual(articleVersion);
    const storedArticle = {
      ...articleCreate,
      ownerMemberId: "article-owner",
      updatedByMemberId: "article-owner",
      revision: 1,
      latestSuccessfulRunId: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    expect(publicAnalysisArticle(storedArticle)).toEqual({
      ...storedArticle,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(() => parseSharedAnalysisArticleCreate(storedArticle)).toThrow();
    expect(() => parseAnalysisArticleVersionPayload({ ...articleVersion, extra: true })).toThrow();

    const connectionVersion = {
      name: "Primary",
      engine: "postgres",
      provider: "gcpCloudSql",
      driverId: null,
      host: "127.0.0.1",
      port: 5432,
      database: "app",
      sslmode: "disable",
      readonlyDefault: true,
      allowWrites: false,
      env: "prod",
      schemaGroup: null,
      deleted: false,
    } as const satisfies ConnectionVersionPayload;
    expect(connectionLeaseRevocationScope(
      connectionVersion,
      { ...connectionVersion, allowWrites: true },
    )).toBe("none");
    expect(connectionLeaseRevocationScope(
      { ...connectionVersion, allowWrites: true },
      connectionVersion,
    )).toBe("write");
    expect(connectionLeaseRevocationScope(
      connectionVersion,
      { ...connectionVersion, host: "10.0.0.2" },
    )).toBe("all");

    const bigQueryTemplate = parseSharedConnection({
      name: "Warehouse",
      engine: "bigquery",
      provider: "generic",
      driverId: "google-bq-cli",
      host: "sample-analytics-2026",
      port: 443,
      database: "analytics_2026",
      sslmode: "require",
      readonlyDefault: true,
      allowWrites: false,
      env: "prod",
      schemaGroup: null,
    });
    expect(bigQueryTemplate.engine).toBe("bigquery");
    // Shared goldens also decode in the Desktop protocol crate, so both parsers agree.
    for (const { name, template } of fixture.sharedConnectionTemplates.accepted) {
      expect(() => parseSharedConnection(template), name).not.toThrow();
    }
    for (const { name, template } of fixture.sharedConnectionTemplates.rejected) {
      expect(() => parseSharedConnection(template), name).toThrow();
    }
    const mongoGolden = parseSharedConnection(fixture.sharedConnectionTemplates.accepted[0].template);
    expect(mongoGolden.mongoOptions).toEqual({ srv: true, authSource: "admin", replicaSet: "atlas-shard-0" });
    expect(Object.keys(mongoGolden.mongoOptions!)).toEqual(["srv", "authSource", "replicaSet"]);
    const d1Golden = parseSharedConnection(fixture.sharedConnectionTemplates.accepted[3].template);
    expect(() => parseSharedConnection(d1Golden, { credentialMode: "managed" })).toThrow();
    const sharedRow = (template: typeof mongoGolden) => ({
      id: "connection-template", ...template, databaseName: template.database,
      environment: template.env, contentRevision: 1, updatedAt: new Date("2026-10-20T00:00:00Z"),
      credentialMode: "member_local",
    });
    expect(publicConnection(sharedRow(d1Golden), "analyst", "read").credentialsRequired).toBe(false);
    const publicMongo = publicConnection(sharedRow(mongoGolden), "analyst", "read");
    expect(publicMongo.credentialsRequired).toBe(true);
    expect(publicMongo).toMatchObject({ mongoOptions: mongoGolden.mongoOptions });
    expect(publicConnection(sharedRow({ ...mongoGolden, mongoOptions: undefined }), "analyst", "read"))
      .not.toHaveProperty("mongoOptions");
    expect(() => parseSharedConnection(bigQueryTemplate, {
      credentialMode: "managed",
    })).toThrow("member-local Google Cloud CLI");
    const publicTemplate = {
      id: "connection-bigquery",
      ...bigQueryTemplate,
      databaseName: bigQueryTemplate.database,
      environment: bigQueryTemplate.env,
      contentRevision: 1,
      updatedAt: new Date("2026-08-26T00:00:00Z"),
      credentialMode: "member_local",
    };
    expect(publicConnection(publicTemplate, "analyst", "read").credentialsRequired).toBe(false);
    expect(publicConnection(publicTemplate, "owner", "manage", true, true).schemaAccessAvailable).toBe(false);
    const managedTemplate = { ...publicTemplate, engine: "postgres", provider: "gcpCloudSql", credentialMode: "managed" };
    expect(publicConnection(managedTemplate, "owner", "manage", true).schemaAccessAvailable).toBe(false);
    expect(publicConnection(managedTemplate, "owner", "manage", false, true).schemaAccessAvailable).toBe(false);
    expect(publicConnection(managedTemplate, "owner", "manage", true, true).schemaAccessAvailable).toBe(true);
    // A member's own credential writes only through the additive `memberWrite`: the grant and role
    // decide it, the template wire flag stays false, and the read-only engines never write.
    const postgresTemplate = { ...publicTemplate, engine: "postgres", provider: "generic" };
    expect(publicConnection(postgresTemplate, "editor", "write")).toMatchObject({ allowWrites: false, memberWrite: true });
    expect(publicConnection(postgresTemplate, "editor", "read").memberWrite).toBe(false);
    expect(publicConnection(managedTemplate, "owner", "manage", true).memberWrite).toBe(false);
    expect([bigQueryTemplate.engine, "mongodb", "sqlite"].map((engine) =>
      publicConnection({ ...postgresTemplate, engine, provider: engine === "sqlite" ? "cloudflareD1" : "generic" }, "owner", "manage").memberWrite))
      .toEqual([false, false, false]);

    expect(upstreamMessage(
      403,
      "https://serviceusage.googleapis.com/v1/projects/123/services:batchEnable",
      {},
    )).toContain("Service Usage Admin");
    expect(upstreamMessage(
      403,
      "https://serviceusage.googleapis.com.attacker.invalid/v1/projects/123",
      {},
    )).toBe("Google Cloud에서 이 설정 작업을 거부했습니다.");
    const missingServiceAccount = {
      error: {
        message: "Service account agent1@project1.iam.gserviceaccount.com does not exist.",
      },
    };
    expect(iamServiceAccountPropagationPending(
      400,
      "https://cloudresourcemanager.googleapis.com/v1/projects/project1:setIamPolicy",
      missingServiceAccount,
    )).toBe(true);
    expect(iamServiceAccountPropagationPending(
      400,
      "https://cloudresourcemanager.googleapis.com.attacker.invalid/v1/projects/project1:setIamPolicy",
      missingServiceAccount,
    )).toBe(false);

    for (const acceptance of fixture.analysisArticleAcceptances) {
      const candidate = applySemanticMutations(
        fixture.analysisArticleCreate,
        { ...acceptance, contract: "analysisArticleCreate" },
      );
      let accepted = true;
      try {
        parseSharedAnalysisArticleCreate(candidate);
      } catch {
        accepted = false;
      }
      expect(accepted, acceptance.name).toBe(true);
    }

    for (const rejection of fixture.semanticRejections) {
      const base = rejection.contract === "workspaceSyncBootstrap"
        ? fixture.workspaceSync.bootstrap
        : rejection.contract === "workspaceSyncIncremental"
          ? fixture.workspaceSync.incremental
          : rejection.contract === "managedLeaseRequest"
        ? fixture.managedLease.request
        : rejection.contract === "managedLeaseResponse"
          ? fixture.managedLease.response
          : fixture.analysisArticleCreate;
      const candidate = applySemanticMutations(base, rejection);
      let rejected = false;
      try {
        if (rejection.contract === "workspaceSyncBootstrap"
          || rejection.contract === "workspaceSyncIncremental") parseWorkspaceSyncPage(candidate);
        else if (rejection.contract === "managedLeaseRequest") parseManagedLeaseRequest(candidate);
        else if (rejection.contract === "managedLeaseResponse") managedLeaseResponse(candidate);
        else parseSharedAnalysisArticleCreate(candidate);
      } catch {
        rejected = true;
      }
      expect(rejected, rejection.name).toBe(true);
    }

    assertDirectAccessContracts(fixture, applySemanticMutations as never);

    expect(() => parseWorkspaceSyncPage({
      ...(fixture.workspaceSync.bootstrap as object),
      unexpected: true,
    })).toThrow("Invalid workspace sync contract");
    expect(() => managedLeaseResponse({
      ...(fixture.managedLease.response as { lease: object }),
      lease: {
        ...(fixture.managedLease.response as { lease: object }).lease,
        unexpected: true,
      },
    })).toThrow("Invalid managed lease response contract");
    expect(() => parseSharedAnalysisArticleCreate({
      ...(fixture.analysisArticleCreate as object),
      unexpected: true,
    })).toThrow();

    type MutableAnalysisFixture = {
      definition: {
        version: number;
        html: string;
        query: Record<string, unknown> & { columns: unknown[] };
      };
    };
    const malformedArticle = (mutate: (article: MutableAnalysisFixture) => void) => {
      const article = structuredClone(fixture.analysisArticleCreate) as MutableAnalysisFixture;
      mutate(article);
      return article;
    };
    expect(() => parseSharedAnalysisArticleCreate(malformedArticle((article) => {
      article.definition.query.parameterIds = [];
    }))).toThrow();
    expect(() => parseSharedAnalysisArticleCreate(malformedArticle((article) => {
      article.definition.query.columns = [];
    }))).toThrow("Invalid Analysis Article columns");
    expect(() => parseSharedAnalysisArticleCreate(malformedArticle((article) => {
      article.definition.version = 2;
    }))).toThrow("Invalid Analysis Article definition");
    const sanitized = parseSharedAnalysisArticleCreate(malformedArticle((article) => {
      article.definition.html = '<p>Safe</p><script>alert(1)</script><a href="javascript:alert(2)">link</a>';
    }));
    expect(sanitized.definition.html).not.toContain("<script");
    expect(sanitized.definition.html).not.toContain("javascript:");
    const articleHtml = (html: string) => parseSharedAnalysisArticleCreate(malformedArticle((article) => {
      article.definition.html = html;
    })).definition.html;
    const visual = articleHtml('<section class="article-metrics unknown"><div class="article-metric"><span class="article-value">80</span></div></section><figure><svg viewBox="0 0 600 150" role="img" aria-label="80 starters"><title>Conversion</title><rect x="170" y="8" width="400" height="32" fill="currentColor" class="article-accent"/><text x="0" y="28" font-size="18" fill="currentColor">Started · 80</text></svg><figcaption>Measured starters</figcaption></figure>');
    expect(visual).toContain('viewBox="0 0 600 150"');
    expect(visual).toContain('class="article-metrics"');
    expect(visual).toContain('class="article-accent"');
    expect(visual).toContain('<text x="0" y="28"');
    expect(articleHtml(visual)).toBe(visual);
    for (const unsafe of [
      '<svg onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="https://example.invalid/leak"></iframe></foreignObject></svg>',
      '<svg><use href="https://example.invalid/leak#shape"/><image href="data:image/svg+xml,payload"/><animate attributeName="href" values="javascript:alert(1)"/></svg>',
      '<svg><rect fill="url(https://example.invalid/leak)" stroke="url(#x)" style="filter:url(https://example.invalid/leak)" onclick="alert(1)"/></svg>',
      '<svg><a xlink:href="javascript:alert(1)"><text>Link</text></a><rect fill="&#117;rl(https://example.invalid/leak)"/></svg>',
      '<math><annotation-xml encoding="text/html"><svg><foreignObject><style><img src=x onerror=alert(1)></style></foreignObject></svg></annotation-xml></math>',
    ]) {
      const clean = articleHtml(unsafe);
      expect(clean).not.toMatch(/script|foreignobject|iframe|<use|<image|<animate|onload|onclick|onerror|style=|url\(|javascript:|example\.invalid|xlink:/i);
      expect(articleHtml(clean)).toBe(clean);
    }
    const invalidGeometry = articleHtml('<svg viewBox="0 0 0 10"><rect width="1e999" x="NaN" d="url(x)" class="fixed"/></svg>');
    expect(invalidGeometry).not.toMatch(/viewBox|width=|x=|d=|class=/);
  });
});
