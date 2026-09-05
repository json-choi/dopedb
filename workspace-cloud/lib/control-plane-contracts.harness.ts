// Cross-language fixture coverage for independently deployed Workspace Cloud and
// Desktop. The fixture contains fake secrets; assertions never print or snapshot it.

import { readFileSync } from "node:fs";

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
  acceptsProductAnalyticsContract,
  parseProductAnalyticsEnvelope,
  productAnalyticsEnvelopeBudgetPlan,
  productAnalyticsIngressBudgetPlan,
  relayProductAnalytics,
  type ProductAnalyticsEnvelope,
  type ProductEventName,
} from "./product-analytics";
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
  publicConnection,
} from "./workspace-connections";
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
  analysisArticleAcceptances: readonly Readonly<{
    name: string;
    mutations: SemanticRejection["mutations"];
  }>[];
  semanticRejections: readonly SemanticRejection[];
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

const productAnalyticsGolden = JSON.parse(readFileSync(
  new URL("../../tests/fixtures/product-analytics-v1.json", import.meta.url),
  "utf8",
)) as ProductAnalyticsEnvelope;

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

const analyticsNow = Date.parse("2026-08-14T00:00:00Z");
const analyticsActorKey = "a".repeat(64);
const analyticsWorkspaceKey = "b".repeat(64);
const analyticsEventProperties = Object.fromEntries(
  productAnalyticsGolden.events.map((event) => [event.name, event.properties]),
) as Record<ProductEventName, Record<string, unknown>>;
const analyticsPropertyKeys = {
  desktop_installation_ready: [],
  workspace_authentication_completed: ["outcome"],
  workspace_scope_ready: [],
  knowledge_environment_created: ["creationKind"],
  connection_verification_completed: ["outcome", "engine", "credentialMode", "ssh"],
  environment_connection_bound: ["accessMode", "engine"],
  query_execution_completed: [
    "outcome",
    "statementClass",
    "rowCountBucket",
    "durationBucket",
    "approvalRequired",
  ],
  knowledge_source_sync_completed: ["outcome", "sourceKind", "syncReason"],
  agent_session_initialization_completed: ["outcome", "provider"],
  agent_turn_completed: ["outcome", "provider", "durationBucket"],
  analysis_article_run_completed: ["outcome", "trigger", "durationBucket"],
  workspace_membership_ready: ["role"],
  shared_connection_access_ready: ["accessMode", "engine"],
} as const satisfies Record<ProductEventName, readonly string[]>;

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

function analyticsEnvelope(
  name: ProductEventName,
  identity: Record<string, unknown>,
  properties = analyticsEventProperties[name],
) {
  return {
    schemaVersion: 1,
    installationId: "018f1f7e-7b44-7cc1-8d4e-4f31b7315fe8",
    sessionId: "018f1f7e-7b44-7cc1-8d4e-4f31b7315fe9",
    appVersion: "0.3.45",
    platform: "macos",
    locale: "ko",
    events: [{
      eventId: "c".repeat(64),
      name,
      occurredAt: "2026-08-14T00:00:00Z",
      ...identity,
      properties,
    }],
  };
}

describe("Desktop control-plane contracts", () => {
  it("decodes the same strict sync, lease, and Analysis Article goldens as Rust", async () => {
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
    expect(schemaStatements).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${policyOwner}" IN SCHEMA "public" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
    );
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
    expect(() => parseSharedConnection(bigQueryTemplate, {
      credentialMode: "managed",
    })).toThrow("member-local Google Cloud CLI");
    expect(publicConnection({
      id: "connection-bigquery",
      ...bigQueryTemplate,
      databaseName: bigQueryTemplate.database,
      environment: bigQueryTemplate.env,
      contentRevision: 1,
      updatedAt: new Date("2026-08-26T00:00:00Z"),
      credentialMode: "member_local",
    }, "analyst", "read").credentialsRequired).toBe(false);

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

    expect(Object.keys(productAnalyticsGolden).sort()).toEqual([
      "appVersion",
      "events",
      "installationId",
      "locale",
      "platform",
      "schemaVersion",
      "sessionId",
    ]);
    expect(parseProductAnalyticsEnvelope(productAnalyticsGolden, analyticsNow))
      .toEqual(productAnalyticsGolden);
    for (const appVersion of ["0.3.98", "1.0.0-alpha.1+darwin-arm64"]) {
      expect(parseProductAnalyticsEnvelope({
        ...productAnalyticsGolden,
        appVersion,
      }, analyticsNow), appVersion).not.toBeNull();
    }
    for (const appVersion of [
      "01.2.3",
      "1.0.0-01",
      `1.0.0-${"--.".repeat(40)}`,
    ]) {
      expect(parseProductAnalyticsEnvelope({
        ...productAnalyticsGolden,
        appVersion,
      }, analyticsNow), appVersion).toBeNull();
    }
    expect(productAnalyticsGolden.events.map((event) => event.name)).toEqual(
      Object.keys(analyticsPropertyKeys),
    );
    for (const event of productAnalyticsGolden.events) {
      expect(Object.keys(event.properties).sort(), event.name).toEqual(
        [...analyticsPropertyKeys[event.name]].sort(),
      );
      const identityKeys = event.name === "desktop_installation_ready"
        ? []
        : event.name === "workspace_authentication_completed"
          ? ["actorKey"]
          : event.workspaceKind === "personal"
            ? ["workspaceKey", "workspaceKind"]
            : ["actorKey", "workspaceKey", "workspaceKind"];
      expect(Object.keys(event).sort(), event.name).toEqual([
        "eventId",
        "name",
        "occurredAt",
        "properties",
        ...identityKeys,
      ].sort());
    }
    expect(productAnalyticsGolden.events[2]?.workspaceKind).toBe("personal");
    expect(productAnalyticsGolden.events.at(-2)?.workspaceKind).toBe("team");

    expect(parseProductAnalyticsEnvelope(
      analyticsEnvelope("desktop_installation_ready", {}),
      analyticsNow,
    )).not.toBeNull();
    expect(parseProductAnalyticsEnvelope({
      ...analyticsEnvelope("desktop_installation_ready", {}),
      events: [{
        ...analyticsEnvelope("desktop_installation_ready", {}).events[0],
        eventId: "018f1f7e-7b44-7cc1-8d4e-4f31b7315fe7",
      }],
    }, analyticsNow)).toBeNull();
    expect(parseProductAnalyticsEnvelope(
      analyticsEnvelope("desktop_installation_ready", { actorKey: analyticsActorKey }),
      analyticsNow,
    )).toBeNull();
    expect(parseProductAnalyticsEnvelope(
      analyticsEnvelope("workspace_authentication_completed", { actorKey: analyticsActorKey }),
      analyticsNow,
    )).not.toBeNull();
    expect(parseProductAnalyticsEnvelope(
      analyticsEnvelope("workspace_authentication_completed", {
        actorKey: analyticsActorKey,
        workspaceKey: analyticsWorkspaceKey,
        workspaceKind: "team",
      }),
      analyticsNow,
    )).toBeNull();
    expect(parseProductAnalyticsEnvelope(
      analyticsEnvelope("workspace_authentication_completed", {}),
      analyticsNow,
    )).toBeNull();
    expect(parseProductAnalyticsEnvelope(
      analyticsEnvelope("workspace_authentication_completed", {}, { outcome: "failed" }),
      analyticsNow,
    )).not.toBeNull();
    expect(parseProductAnalyticsEnvelope(
      analyticsEnvelope(
        "workspace_authentication_completed",
        { actorKey: analyticsActorKey },
        { outcome: "failed" },
      ),
      analyticsNow,
    )).toBeNull();

    for (const name of Object.keys(analyticsEventProperties) as ProductEventName[]) {
      if (name === "desktop_installation_ready" || name === "workspace_authentication_completed") {
        continue;
      }
      expect(parseProductAnalyticsEnvelope(analyticsEnvelope(name, {}), analyticsNow), name)
        .toBeNull();
      expect(parseProductAnalyticsEnvelope(analyticsEnvelope(name, {
        workspaceKey: analyticsWorkspaceKey,
        workspaceKind: "team",
      }), analyticsNow), name).toBeNull();
      expect(parseProductAnalyticsEnvelope(analyticsEnvelope(name, {
        actorKey: analyticsActorKey,
        workspaceKey: analyticsWorkspaceKey,
        workspaceKind: "team",
      }), analyticsNow), name).not.toBeNull();
    }
    expect(parseProductAnalyticsEnvelope(analyticsEnvelope("workspace_scope_ready", {
      workspaceKey: analyticsWorkspaceKey,
      workspaceKind: "personal",
    }), analyticsNow)).not.toBeNull();
    expect(parseProductAnalyticsEnvelope(analyticsEnvelope("workspace_scope_ready", {
      actorKey: analyticsActorKey,
      workspaceKey: analyticsWorkspaceKey,
      workspaceKind: "personal",
    }), analyticsNow)).toBeNull();
    expect(parseProductAnalyticsEnvelope(analyticsEnvelope("workspace_membership_ready", {
      workspaceKey: analyticsWorkspaceKey,
      workspaceKind: "personal",
    }), analyticsNow)).toBeNull();
    expect(acceptsProductAnalyticsContract(new Headers({
      "x-dopedb-product-analytics-contract": "1",
    }))).toBe(true);
    for (const value of [undefined, "01", "2", "1, 1"]) {
      const headers = new Headers();
      if (value !== undefined) headers.set("x-dopedb-product-analytics-contract", value);
      expect(acceptsProductAnalyticsContract(headers), value).toBe(false);
    }

    const firstInstallation = "018f1f7e-7b44-7cc1-8d4e-4f31b7315fe8";
    const secondInstallation = "018f1f7e-7b44-7cc1-8d4e-4f31b7315fea";
    const sourceHeaders = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    const firstIngressPlan = productAnalyticsIngressBudgetPlan(sourceHeaders);
    const rotatedIngressPlan = productAnalyticsIngressBudgetPlan(sourceHeaders);
    const otherSourceIngressPlan = productAnalyticsIngressBudgetPlan(
      new Headers({ "x-forwarded-for": "198.51.100.9" }),
    );
    const firstEnvelopePlan = productAnalyticsEnvelopeBudgetPlan(firstInstallation, 1);
    const rotatedEnvelopePlan = productAnalyticsEnvelopeBudgetPlan(secondInstallation, 1);
    expect(firstIngressPlan.map(({ namespace, limit, windowMs }) => ({
      namespace,
      limit,
      windowMs,
    }))).toEqual([
      { namespace: "product-analytics-global-requests", limit: 400, windowMs: 60_000 },
      { namespace: "product-analytics-ip", limit: 60, windowMs: 60_000 },
    ]);
    expect(firstEnvelopePlan.map(({ namespace, limit, windowMs }) => ({
      namespace,
      limit,
      windowMs,
    }))).toEqual([
      { namespace: "product-analytics-global-events", limit: 16, windowMs: 60_000 },
      { namespace: "product-analytics-installation", limit: 60, windowMs: 60_000 },
    ]);
    expect([...firstIngressPlan, ...firstEnvelopePlan].every(
      ({ discriminator }) => /^[0-9a-f]{64}$/.test(discriminator),
    )).toBe(true);
    expect(firstIngressPlan[0].discriminator).toBe(rotatedIngressPlan[0].discriminator);
    expect(firstIngressPlan[1].discriminator).toBe(rotatedIngressPlan[1].discriminator);
    expect(firstIngressPlan[1].discriminator)
      .not.toBe(otherSourceIngressPlan[1].discriminator);
    expect(firstEnvelopePlan[0].discriminator).toBe(rotatedEnvelopePlan[0].discriminator);
    expect(firstEnvelopePlan[1].discriminator)
      .not.toBe(rotatedEnvelopePlan[1].discriminator);
    expect(productAnalyticsEnvelopeBudgetPlan(firstInstallation, 16)[0].cost)
      .toBe(16);
    expect(JSON.stringify(firstIngressPlan)).not.toContain("203.0.113.7");
    expect(JSON.stringify(firstEnvelopePlan)).not.toContain(firstInstallation);

    const relayEnvelope = parseProductAnalyticsEnvelope(
      analyticsEnvelope("desktop_installation_ready", {}),
      analyticsNow,
    );
    expect(relayEnvelope).not.toBeNull();
    const previousToken = process.env.PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN;
    const previousUrl = process.env.PRODUCT_ANALYTICS_CLOUDFLARE_URL;
    const previousRelayEnabled = process.env.PRODUCT_ANALYTICS_RELAY_ENABLED;
    process.env.PRODUCT_ANALYTICS_RELAY_ENABLED = "1";
    process.env.PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN = "a".repeat(64);
    process.env.PRODUCT_ANALYTICS_CLOUDFLARE_URL =
      "https://dopedb-product-analytics.test.workers.dev/v1/events";
    let relayTarget = "";
    let relayBody: unknown;
    let relayHeaders = new Headers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      relayTarget = String(input);
      relayHeaders = new Headers(init?.headers);
      if (typeof init?.body !== "string") throw new Error("Expected a JSON relay body");
      relayBody = JSON.parse(init.body) as unknown;
      return new Response(null, { status: 202 });
    });
    try {
      expect(await relayProductAnalytics(relayEnvelope!)).toBe("accepted");
      expect(relayTarget).toBe(
        "https://dopedb-product-analytics.test.workers.dev/v1/events",
      );
      expect(relayHeaders.get("authorization")).toBe(`Bearer ${"a".repeat(64)}`);
      expect(relayHeaders.get("x-dopedb-product-analytics-contract")).toBe("1");
      expect(relayBody).toEqual(relayEnvelope);
      expect(JSON.stringify(relayBody)).not.toContain("consentGeneration");

      const analyticsModule = await import("./product-analytics");
      const ingressBudget = vi.spyOn(
        analyticsModule,
        "consumeProductAnalyticsIngressBudget",
      ).mockResolvedValue(true);
      const envelopeBudget = vi.spyOn(
        analyticsModule,
        "consumeProductAnalyticsEnvelopeBudget",
      ).mockResolvedValue(true);
      try {
        fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
        const currentEnvelope = structuredClone(productAnalyticsGolden);
        const occurredAt = new Date().toISOString();
        for (const event of currentEnvelope.events) event.occurredAt = occurredAt;
        const { POST } = await import(
          "../app/api/v1/product-analytics/events/route"
        );
        process.env.PRODUCT_ANALYTICS_RELAY_ENABLED = "0";
        const disabled = await POST(new Request(
          "https://workspace.dopedb.dev/api/v1/product-analytics/events",
          { method: "POST", body: "{}" },
        ));
        expect(disabled.status).toBe(503);
        expect(ingressBudget).not.toHaveBeenCalled();
        process.env.PRODUCT_ANALYTICS_RELAY_ENABLED = "1";
        const response = await POST(new Request(
          "https://workspace.dopedb.dev/api/v1/product-analytics/events",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-dopedb-product-analytics-contract": "1",
            },
            body: JSON.stringify(currentEnvelope),
          },
        ));
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({
          accepted: false,
          error: "Product analytics relay rejected the batch",
          retryable: false,
        });
      } finally {
        ingressBudget.mockRestore();
        envelopeBudget.mockRestore();
      }
    } finally {
      fetchMock.mockRestore();
      if (previousToken === undefined) delete process.env.PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN;
      else process.env.PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN = previousToken;
      if (previousUrl === undefined) delete process.env.PRODUCT_ANALYTICS_CLOUDFLARE_URL;
      else process.env.PRODUCT_ANALYTICS_CLOUDFLARE_URL = previousUrl;
      if (previousRelayEnabled === undefined) delete process.env.PRODUCT_ANALYTICS_RELAY_ENABLED;
      else process.env.PRODUCT_ANALYTICS_RELAY_ENABLED = previousRelayEnabled;
    }
  });
});
