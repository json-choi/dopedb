// Behavioral coverage of the Google response → setup readiness boundary.
// All identities and tokens are synthetic; no cloud resources are contacted.
import { expect, vi } from "vitest";
import { ensureDatabaseUser, recoverDatabaseBootstrapUser } from "./gcp-cloud-bootstrap-database";
import { gcpConnectionDatabaseRoles } from "./gcp-cloud-connection-policy";
import { grantWorkloadIdentity, setupFingerprint } from "./gcp-cloud-bootstrap-iam";
import * as workloadIdentity from "./workload-oidc";
import { bootstrapGcpCloudSql } from "./gcp-cloud-bootstrap-application";
import { parseDatabaseBootstrapRecovery } from "./gcp-cloud-bootstrap-recovery";
import { googleRequest } from "./gcp-cloud-bootstrap-core";
import { requestGcpBootstrap } from "../../features/providerAccess/gcpBootstrapTransport";
import { gcpJsonRequest, GcpManagedAccessRequestError } from "./gcp-cloud-managed-http";
import { GcpIamPropagationPendingError, waitForFederation } from "./gcp-cloud-bootstrap-application";
import { gcpWifPrincipal, parseGcpCloudSqlCredential } from "./gcp-cloud-sql-core";

const credential = parseGcpCloudSqlCredential({
  projectId: "dopedb-fixture",
  projectNumber: "123456789012",
  workloadIdentityPoolId: "dopedb-workspace",
  workloadIdentityProviderId: "dopedb-workspace",
  instanceId: "workspace-db",
  readServiceAccountEmail: "dopedb-read@dopedb-fixture.iam.gserviceaccount.com",
  writeServiceAccountEmail: "dopedb-write@dopedb-fixture.iam.gserviceaccount.com",
  schemaServiceAccountEmail: "dopedb-schema@dopedb-fixture.iam.gserviceaccount.com",
  workloadIdentitySubject: "dopedb:workspace:production",
  databaseNames: ["workspace"],
  dedicatedServiceAccountsConfirmed: true,
  instanceScopedIamConfirmed: true,
});


const oidcToken = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}`;

export async function assertGcpBootstrapReadinessContract() {
  expect(gcpWifPrincipal(credential)).toBe(
    "principal://iam.googleapis.com/projects/123456789012/locations/global/"
    + "workloadIdentityPools/dopedb-workspace/subject/dopedb:workspace:production",
  );
  for (const subject of ["dopedb:workspace:preview", "dopedb:other:production", ""]) {
    expect(() => parseGcpCloudSqlCredential({
      ...credential, workloadIdentitySubject: subject,
    })).toThrow("Invalid GCP trust configuration");
  }
  vi.useFakeTimers();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let schemaAttempts = 0;
  let denialsRemaining = 2;
  let policyDrift = false;
  let denialReason = "IAM_PERMISSION_DENIED";
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://sts.googleapis.com/v1/token") {
      return Response.json({ access_token: "fixture-federated-token" });
    }
    if (url.startsWith("https://iamcredentials.googleapis.com/") && url.endsWith(":generateAccessToken")) {
      if (decodeURIComponent(url).includes(credential.schemaServiceAccountEmail!)) {
        schemaAttempts += 1;
        if (denialsRemaining-- > 0) {
          return Response.json({ error: {
            code: 403, status: "PERMISSION_DENIED",
            details: [{ reason: denialReason }],
          } }, { status: 403 });
        }
      }
      const request = JSON.parse(String(init?.body));
      return Response.json({ accessToken: "fixture-service-account-token",
        expireTime: new Date(Date.now() + parseInt(request.lifetime, 10) * 1_000).toISOString(),
      });
    }
    if (url.startsWith("https://iam.googleapis.com/") && url.endsWith(":getIamPolicy")) {
      return Response.json({ bindings: policyDrift ? [] : [
        { role: "roles/iam.serviceAccountViewer", members: [`serviceAccount:${credential.readServiceAccountEmail}`] },
        { role: "roles/iam.workloadIdentityUser", members: [gcpWifPrincipal(credential)] },
      ] });
    }
    if (url.startsWith("https://sqladmin.googleapis.com/") && url.endsWith("/instances/workspace-db")) {
      return Response.json({ name: credential.instanceId, databaseVersion: "POSTGRES_17", state: "RUNNABLE" });
    }
    throw new Error(`Unexpected fixture request: ${new URL(url).origin}`);
  });
  vi.stubGlobal("fetch", transport);
  try {
    const result = waitForFederation(credential, oidcToken).then(
      () => ({ ready: true }), error => ({ ready: false, error }),
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ ready: true });
    expect(schemaAttempts).toBe(3);
    expect(transport.mock.calls.some(([url]) => String(url).endsWith(":getIamPolicy"))).toBe(true);

    // A real IAM denial remains a single 424 outside explicitly approved setup.
    denialsRemaining = Infinity;
    schemaAttempts = 0;
    const rejected = await gcpJsonRequest("serviceAccount",
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${credential.schemaServiceAccountEmail}:generateAccessToken`,
      { method: "POST", body: JSON.stringify({ lifetime: "600s" }) },
    ).catch(error => error);
    expect(rejected).toBeInstanceOf(GcpManagedAccessRequestError);
    expect(rejected).toMatchObject({ status: 424, upstreamStatus: 403,
      stage: "serviceAccount", googleReason: "IAM_PERMISSION_DENIED" });
    expect(schemaAttempts).toBe(1);

    // Exhausting one request reports pending, never readiness or a ticket.
    const started = Date.now();
    const pending = waitForFederation(credential, oidcToken).catch(error => error);
    await vi.runAllTimersAsync();
    const pendingError = await pending;
    expect(pendingError).toBeInstanceOf(GcpIamPropagationPendingError);
    expect(pendingError).toMatchObject({ status: 503, code: "gcp_iam_propagation_pending", retryAfterMs: 5_000 });
    expect(Date.now() - started).toBeLessThanOrEqual(45_000);

    denialReason = "SECURITY_POLICY_VIOLATED";
    schemaAttempts = 0;
    const policyDenied = waitForFederation(credential, oidcToken).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await policyDenied).toMatchObject({ status: 424, googleReason: "SECURITY_POLICY_VIOLATED" });
    expect(schemaAttempts).toBe(1);

    // Token success alone is insufficient. Trust drift stops on the first check.
    denialsRemaining = 0;
    schemaAttempts = 0;
    policyDrift = true;
    const drift = waitForFederation(credential, oidcToken).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await drift).toMatchObject({ status: 409,
      message: "Cloud SQL schema service-account trust policy has drifted" });
    expect(schemaAttempts).toBe(1);

    await assertBootstrapContinuation(pendingError);
    await assertExistingAccessIsNeverRewritten();
    await assertConnectionPreservesExistingPrincipals();

    // Setup API diagnostics retain categorical causes, never the role name,
    // token, SQL, or Google response body that carried them.
    log.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: {
      status: "INVALID_ARGUMENT", message: 'role "fixture-admin@dopedb.dev" already exists',
    } }, { status: 400 })));
    const collision = await googleRequest({ accessToken: "fixture-private-token", email: "fixture-admin@dopedb.dev", expiresAt: new Date(Date.now() + 60_000).toISOString() },
      "https://sqladmin.googleapis.com/sql/v1beta4/projects/dopedb-fixture/instances/workspace-db/users",
      { method: "POST", body: JSON.stringify({ type: "CLOUD_IAM_USER" }) },
    ).catch(error => error);
    expect(collision.message).toContain("database role already exists outside Cloud SQL user management");
    expect(log).toHaveBeenCalledWith("gcp_managed_access_upstream_rejection", {
      stage: "setup.sqlUser.create", upstreamStatus: 400, googleStatus: "INVALID_ARGUMENT", googleReason: null,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("fixture-admin");
    expect(JSON.stringify(log.mock.calls)).not.toContain("fixture-private-token");

  } finally {
    vi.unstubAllGlobals();
    log.mockRestore();
    vi.useRealTimers();
  }
}

async function assertExistingAccessIsNeverRewritten() {
  const setup = { accessToken: "fixture-token", email: "admin@dopedb.dev",
    expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const email = "dopedb-r-fixture@dopedb-fixture.iam.gserviceaccount.com";
  const roles = gcpConnectionDatabaseRoles("POSTGRES_17", false);
  let existing: Record<string, unknown> | null = {
    name: email.replace(".gserviceaccount.com", ""), type: "CLOUD_IAM_SERVICE_ACCOUNT",
    databaseRoles: ["application_role", "cloudsqlsuperuser"],
  };
  const before = JSON.stringify(existing);
  const mutations: string[] = [];
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith(":getIamPolicy")) {
      return Response.json({ bindings: [
        { role: "roles/iam.workloadIdentityUser", members: ["prior-subject", "current-subject"] },
      ] });
    }
    if (url.pathname.endsWith("/users") && !init?.method) {
      return Response.json({ items: existing ? [existing] : [] });
    }
    if (url.pathname.endsWith("/users") && init?.method === "POST") {
      mutations.push("create");
      existing = JSON.parse(String(init.body));
      return Response.json({ name: "fixture-operation", status: "DONE" });
    }
    throw new Error("Unexpected mutation in preservation fixture");
  });
  vi.stubGlobal("fetch", transport);
  await expect(ensureDatabaseUser(setup, "dopedb-fixture", "workspace-db",
    email, "postgres", roles)).rejects.toMatchObject({ status: 409 });
  expect(JSON.stringify(existing)).toBe(before);
  expect(mutations).toEqual([]);

  // Old trust stays untouched; it is not made acceptable by weakening validation.
  await expect(grantWorkloadIdentity(setup, "dopedb-fixture", email, "current-subject"))
    .rejects.toMatchObject({ status: 409 });
  expect(mutations).toEqual([]);

  // Fresh accounts receive data-only roles at creation, never via users.update.
  existing = null;
  await ensureDatabaseUser(setup, "dopedb-fixture", "workspace-db", email, "postgres", roles);
  expect(mutations).toEqual(["create"]);
  expect(existing).toMatchObject({ databaseRoles: ["pg_read_all_data"] });
  await ensureDatabaseUser(setup, "dopedb-fixture", "workspace-db", email, "postgres", roles);
  expect(mutations).toEqual(["create"]);
  for (const version of ["POSTGRES_13", "MYSQL_8_0", "unknown"]) {
    expect(() => gcpConnectionDatabaseRoles(version, false)).toThrow("member-local");
  }

  // A journal is evidence for manual review, not authority over an existing login.
  const recovery = parseDatabaseBootstrapRecovery({
    version: 1, projectId: "dopedb-fixture", instanceId: "workspace-db",
    setupEmail: setup.email, userName: setup.email, userHost: "", created: false,
    engine: "postgres", originalRoles: ["application_role"], temporaryRoles: ["cloudsqlsuperuser"],
  });
  expect(recovery).not.toBeNull();
  transport.mockClear();
  await expect(recoverDatabaseBootstrapUser(setup, recovery!)).rejects.toMatchObject({ status: 409 });
  expect(transport).not.toHaveBeenCalled();
  expect(setupFingerprint({
    workspaceId: "fixture-workspace", projectId: "dopedb-fixture", instanceId: "workspace-db",
  } as Parameters<typeof setupFingerprint>[0])).not.toBe(
    // Former fingerprint had no policy generation; never adopt those principals.
    (await import("node:crypto")).createHash("sha256")
      .update("fixture-workspace:dopedb-fixture:workspace-db").digest("hex").slice(0, 14),
  );
}

async function assertConnectionPreservesExistingPrincipals() {
  const identity = { issuer: "https://identity.dopedb.dev", audience: "https://iam.googleapis.com",
    subject: "dopedb:workspace:production", accountId: "a".repeat(32),
    workloadId: "11111111-1111-4111-8111-111111111111", environment: "production" as const };
  const oidc = vi.spyOn(workloadIdentity, "verifyWorkloadOidcToken").mockResolvedValue(identity);
  const config = { workspaceId: "11111111-1111-4111-8111-111111111111",
    projectId: "dopedb-fixture", projectNumber: "123456789012", instanceId: "workspace-db",
    environmentClassification: null, writeAccess: true, approveProduction: false,
    approveIamAuthenticationChange: false };
  const setup = { accessToken: "fixture-token", email: "admin@dopedb.dev",
    expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const instance = { name: config.instanceId, databaseVersion: "POSTGRES_17", state: "RUNNABLE",
    settings: { settingsVersion: "1", userLabels: { environment: "development" },
      databaseFlags: [{ name: "cloudsql.iam_authentication", value: "on" }] } };
  const users: Record<string, unknown>[] = [
    { name: "app_runtime", type: "BUILT_IN", databaseRoles: ["app_data"] },
    { name: setup.email, type: "CLOUD_IAM_USER", databaseRoles: ["app_admin"] },
  ];
  const baseline = JSON.stringify(users);
  const policies = new Map<string, { bindings: unknown[]; auditConfigs?: unknown[] }>();
  const projectPolicy = `/v1/projects/${config.projectId}`;
  const existingBinding = { role: "roles/viewer", members: ["serviceAccount:app@dopedb-fixture.iam.gserviceaccount.com"] };
  const auditConfigs = [{ service: "allServices", auditLogConfigs: [{ logType: "ADMIN_READ" }] }];
  policies.set(projectPolicy, { bindings: [existingBinding], auditConfigs });
  const accounts = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);
    const method = init?.method ?? "GET";
    const body = init?.body && String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : {};
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "federated" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({
      accessToken: "runtime", expireTime: new Date(Date.now() + parseInt(body.lifetime) * 1000).toISOString(),
    });
    if (path.endsWith(":getIamPolicy")) return Response.json(policies.get(path.slice(0, -13)) ?? { etag: "new-policy", bindings: [] });
    if (path.endsWith(":setIamPolicy")) {
      writes.push("iam-policy");
      policies.set(path.slice(0, -13), body.policy);
      return Response.json(body.policy);
    }
    if (path.endsWith("/services:batchEnable")) return Response.json({ name: "operations/fixture", done: true });
    if (url.hostname === "cloudresourcemanager.googleapis.com") return Response.json({
      state: "ACTIVE", projectId: config.projectId, name: `projects/${config.projectNumber}`,
    });
    if (path.includes("/workloadIdentityPools/")) {
      const name = path.slice(4);
      if (path.includes("/providers/")) return Response.json({
        name, state: "ACTIVE", attributeMapping: { "google.subject": "assertion.sub" },
        attributeCondition: `assertion.account_id == '${identity.accountId}' && assertion.workload_id == '${identity.workloadId}' && assertion.environment == 'production' && assertion.sub == '${identity.subject}'`,
        oidc: { issuerUri: identity.issuer, allowedAudiences: [identity.audience] },
      });
      return Response.json({ name, state: "ACTIVE" });
    }
    if (path.endsWith("/serviceAccounts") && method === "POST") {
      const email = `${body.accountId}@${config.projectId}.iam.gserviceaccount.com`;
      const account = { ...body.serviceAccount, email };
      accounts.set(email, account); writes.push("create-service-account");
      return Response.json(account);
    }
    if (path.includes("/serviceAccounts/")) {
      const account = accounts.get(path.split("/serviceAccounts/")[1]);
      return account ? Response.json(account) : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
    }
    if (path.endsWith("/users") && method === "POST") {
      users.push(body); writes.push("create-db-user");
      return Response.json({ name: "fixture-operation", status: "DONE" });
    }
    if (path.endsWith("/users") && method === "GET") return Response.json({ items: users });
    if (path.endsWith("/databases")) return Response.json({ items: [{ name: "workspace" }] });
    if (path.endsWith("/instances")) return Response.json({ items: [instance] });
    if (path.endsWith("/instances/workspace-db")) return Response.json(instance);
    throw new Error(`Unexpected setup request: ${method} ${path}`);
  }));
  try {
    const result = await bootstrapGcpCloudSql({ credential: setup, oidcToken, configuration: config });
    expect(result.configuration.schemaServiceAccountEmail).toBeNull();
    expect(JSON.stringify(users.slice(0, 2))).toBe(baseline);
    expect(users.slice(2).map(user => user.databaseRoles)).toEqual([
      ["pg_read_all_data"], ["pg_read_all_data", "pg_write_all_data"],
    ]);
    expect(writes.filter(write => write === "create-db-user")).toHaveLength(2);
    expect(policies.get(projectPolicy)?.bindings).toContainEqual(existingBinding);
    expect(policies.get(projectPolicy)?.auditConfigs).toEqual(auditConfigs);
    const before = JSON.stringify(users);
    writes.length = 0;
    await bootstrapGcpCloudSql({ credential: setup, oidcToken, configuration: config });
    expect(JSON.stringify(users)).toBe(before);
    expect(writes).toEqual([]);
  } finally { oidc.mockRestore(); }
}

async function assertBootstrapContinuation(pendingError: GcpIamPropagationPendingError) {
  const pendingResponse = () => Response.json({ code: pendingError.code,
    error: pendingError.message, retryAfterMs: pendingError.retryAfterMs }, { status: pendingError.status });
  const fixtureBody = JSON.stringify({ projectId: "dopedb-fixture", instanceId: "workspace-db",
    approveProduction: false, approveIamRoleGrant: false, repairIntegrationId: "fixture-integration" });
  const options = () => ({
    url: "/api/v1/workspaces/fixture-workspace/provider-integrations/gcp-setup/fixture-setup",
    body: fixtureBody,
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    signal: new AbortController().signal,
    onIamPending: vi.fn(),
  });
  // Real setup validation continues across request boundaries; only the eventual
  // verified response reaches the caller. Seven minutes does not exhaust it.
  const start = Date.now();
  const transport = vi.fn(async () => Date.now() - start < 7 * 60_000
    ? pendingResponse() : Response.json({ bootstrapTicket: "fixture-verified-ticket" }));
  vi.stubGlobal("fetch", transport);
  const input = options();
  const result = requestGcpBootstrap(input);
  await vi.runAllTimersAsync();
  expect(await (await result)?.json()).toEqual({ bootstrapTicket: "fixture-verified-ticket" });
  expect(input.onIamPending).toHaveBeenCalled();
  for (const call of transport.mock.calls as unknown as [string, RequestInit][]) {
    expect(call[0]).toBe(input.url);
    expect(call[1]).toMatchObject({ method: "POST", body: fixtureBody });
  }

  // Workspace authorization, active leases, expired sessions and unrelated 503s
  // never acquire the setup-only retry semantics.
  for (const status of [401, 403, 409, 410, 424, 503]) {
    transport.mockReset().mockImplementation(async () => Response.json({ error: "fixture denial" }, { status }));
    expect((await requestGcpBootstrap(options()))?.status).toBe(status);
    expect(transport).toHaveBeenCalledTimes(1);
  }
  transport.mockReset().mockRejectedValue(new Error("fixture network failure"));
  expect(await requestGcpBootstrap(options())).toBeNull();
  expect(transport).toHaveBeenCalledTimes(1);

  // A context change cancels waiting without starting another mutation.
  transport.mockReset().mockImplementation(async () => pendingResponse());
  const controller = new AbortController();
  const aborted = requestGcpBootstrap({ ...options(), signal: controller.signal,
    onIamPending: () => controller.abort(),
  }).catch(error => error);
  await vi.runAllTimersAsync();
  expect(await aborted).toMatchObject({ name: "AbortError" });
  expect(transport).toHaveBeenCalledTimes(1);

  // Persistent denial has a finite budget and retains an actionable failure.
  transport.mockClear();
  const boundedStart = Date.now();
  const bounded = requestGcpBootstrap(options());
  await vi.runAllTimersAsync();
  expect((await bounded)?.status).toBe(503);
  expect(Date.now() - boundedStart).toBeLessThanOrEqual(10 * 60_000);
  expect(transport.mock.calls.length).toBeLessThanOrEqual(120);

  transport.mockClear();
  const expired = options();
  expired.expiresAt = new Date(Date.now() + 60_000).toISOString();
  expect((await requestGcpBootstrap(expired))?.status).toBe(410);
  expect(transport).not.toHaveBeenCalled();
}
