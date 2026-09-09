// Behavioral coverage of the Google response → setup readiness boundary.
// All identities and tokens are synthetic; no cloud resources are contacted.
import { expect, vi } from "vitest";
import { configurePostgresPrivileges } from "./gcp-cloud-bootstrap-sql";
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
    await assertSchemaPreflightPreservesApplications();

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

// A conflict in a later database must prevent policy installation in earlier ones.
async function assertSchemaPreflightPreservesApplications() {
  const requests: { database: string; sqlStatement: string }[] = [];
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toMatch(/\/executeSql$/);
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    if (request.database === "application") {
      return Response.json({ results: [{ status: { code: 3 } }] });
    }
    if (request.sqlStatement.startsWith("DO $dopedb_preflight$")) {
      return Response.json({ results: [{ status: { code: 0 } }] });
    }
    return Response.json({ results: [{ columns: [{ name: "owner_role" }], rows: [] }] });
  });
  vi.stubGlobal("fetch", transport);
  const setup = { accessToken: "fixture-token", email: "admin@dopedb.dev",
    expiresAt: new Date(Date.now() + 60_000).toISOString() };
  await expect(configurePostgresPrivileges({ control: setup, executor: setup,
    projectId: "dopedb-fixture", instanceId: "workspace-db", databaseVersion: "POSTGRES_17",
    databases: ["isolated", "application"], readUser: { name: "fixture_read" },
    writeUser: { name: "fixture_write" }, schemaUser: { name: "fixture_schema" },
    bootstrapUser: { user: { name: "fixture_setup" }, created: true,
      engine: "postgres", originalRoles: [] }, fingerprint: "fixture",
  })).rejects.toMatchObject({ status: 409,
    message: expect.stringContaining("reviewed ownership and application-access policy") });
  expect(requests.map(request => request.database)).toEqual(["isolated", "isolated", "application"]);
  expect(requests.every(request => request.sqlStatement.startsWith("SELECT")
    || request.sqlStatement.startsWith("DO $dopedb_preflight$"))).toBe(true);
  expect(transport).toHaveBeenCalledTimes(3);
}
