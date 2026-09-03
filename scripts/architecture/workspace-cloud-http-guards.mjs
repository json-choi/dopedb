import path from "node:path";

import {
  allModuleSpecifiers,
  cyclicDependencyComponents,
  findDependencyPath,
  staticRuntimeModuleSpecifiers,
} from "./dependency-graph.mjs";

const rawRequestBodyPattern =
  /\brequest\s*\.\s*(?:json|text|arrayBuffer|blob|formData)\s*\(/;
const rawResponseJsonPattern = /\bresponse\s*\.\s*json\s*\(/;

const providerIntegrationBarrelPattern =
  /^(?:@\/lib\/provider-integrations|(?:\.\.\/|\.\/)+provider-integrations)$/;

const routeImportBaseline = Object.freeze({
  db: 45,
  drizzle: 44,
  schema: 43,
});

// The reviewed runtime baseline is zero dependency cycles and zero lib-internal
// imports through the provider integration public barrel. Keep these explicit:
// legacy route persistence is ratcheted below, while new cycles are never
// accepted as another legacy exception.
const workspaceCloudDependencyCycleBaseline = new Set();

const migratedNeonOperationsRoute =
  "workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/[integrationId]/neon-branches/operations/route.ts";
const neonOperationsApplication =
  "workspace-cloud/lib/providers/neon-branch-operation-application.ts";
const neonOperationsApplicationDirectory =
  "workspace-cloud/lib/providers/neon-branch-operations";
const productAnalyticsRoute =
  "workspace-cloud/app/api/v1/product-analytics/events/route.ts";
const productAnalyticsService = "workspace-cloud/lib/product-analytics.ts";
const knowledgeSourceBrowseRoute =
  "workspace-cloud/app/api/v1/workspaces/[workspaceId]/knowledge/sources/[sourceId]/browse/route.ts";
const knowledgeSourceBrowseApplication =
  "workspace-cloud/lib/knowledge/source-browser-application.ts";
const workspaceSchedulerService = "workspace-cloud/lib/workspace-background-scheduler.ts";
const workspaceSchedulerWorker = "workspace-scheduler-cloudflare/src/index.ts";

function workspaceCloudRuntimeModuleSpecifiers(source) {
  return staticRuntimeModuleSpecifiers(source, { includeDynamic: true });
}

function neonOperationTransportImport(source) {
  const specifiers = allModuleSpecifiers(source, { includeDynamic: true });
  if (!specifiers.includes("next/server")) return null;
  const importedTypes = ["NextRequest", "NextResponse"]
    .filter((name) => new RegExp(`\\b${name}\\b`).test(source));
  return importedTypes.length > 0
    ? `${importedTypes.join("/")} from next/server`
    : "next/server";
}

function collectWorkspaceCloudGuardSelfDiagnostics() {
  const diagnostics = [];
  const sources = new Map([
    ["probe-a.ts", 'const load = () => import("./probe-b")'],
    ["probe-b.ts", 'export { value } from "./probe-a"'],
  ]);
  const graph = new Map([...sources].map(([filePath, source]) => [
    filePath,
    workspaceCloudRuntimeModuleSpecifiers(source)
      .map((specifier) => `${specifier.slice(2)}.ts`),
  ]));
  if (cyclicDependencyComponents(graph).length !== 1) {
    diagnostics.push("workspace-cloud dependency guard self-test missed a dynamic import cycle");
  }
  const negativeSpecifiers = workspaceCloudRuntimeModuleSpecifiers(`
import type { TypeOnly } from "./type-only"
const text = 'import("./string-only")'
// export * from "./comment-only"
`);
  if (negativeSpecifiers.length !== 0) {
    diagnostics.push("workspace-cloud dependency guard self-test accepted a non-runtime import");
  }
  if (
    neonOperationTransportImport(
      'import type { NextRequest, NextResponse } from "next/server"',
    ) !== "NextRequest/NextResponse from next/server"
    || neonOperationTransportImport("type NextRequest = { readonly id: string }") !== null
  ) {
    diagnostics.push("workspace-cloud Neon transport-origin guard self-test failed");
  }
  const transportSources = new Map([
    [
      "workspace-cloud/lib/providers/probe-application.ts",
      'import type { Probe } from "./probe-helper"',
    ],
    [
      "workspace-cloud/lib/providers/probe-helper.ts",
      'import type { NextRequest } from "next/server"; export type Probe = NextRequest',
    ],
    [
      "workspace-cloud/lib/providers/probe-negative.ts",
      "type NextRequest = { readonly id: string }",
    ],
  ]);
  const transportGraph = buildWorkspaceCloudDependencyGraph(
    transportSources,
    (source) => allModuleSpecifiers(source, { includeDynamic: true }),
  );
  const transportPath = nextServerDependencyPath(
    transportGraph.graph,
    transportGraph.specifiers,
    "workspace-cloud/lib/providers/probe-application.ts",
  );
  if (
    transportPath?.join(" -> ")
      !== "workspace-cloud/lib/providers/probe-application.ts -> workspace-cloud/lib/providers/probe-helper.ts"
    || nextServerDependencyPath(
      transportGraph.graph,
      transportGraph.specifiers,
      "workspace-cloud/lib/providers/probe-negative.ts",
    ) !== null
  ) {
    diagnostics.push("workspace-cloud Neon transitive transport-origin guard self-test failed");
  }
  return diagnostics;
}

function resolveWorkspaceCloudImport(fromFile, specifier, sourceFiles) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.posix.join("workspace-cloud", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  } else {
    return null;
  }
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function buildWorkspaceCloudDependencyGraph(sourceEntries, collectSpecifiers) {
  const sourceFiles = new Set(sourceEntries.keys());
  const graph = new Map();
  const specifiers = new Map();
  for (const filePath of [...sourceFiles].sort()) {
    const imports = collectSpecifiers(sourceEntries.get(filePath));
    specifiers.set(filePath, imports);
    graph.set(filePath, imports
      .map((specifier) => resolveWorkspaceCloudImport(filePath, specifier, sourceFiles))
      .filter(Boolean));
  }
  return { graph, specifiers };
}

function nextServerDependencyPath(graph, specifiers, start) {
  return findDependencyPath(
    graph,
    start,
    (dependency) => (specifiers.get(dependency) ?? []).includes("next/server"),
  );
}

/**
 * Workspace mutations accept small control-plane envelopes, never arbitrary
 * uploads. Keep their body reads behind boundedJsonBody so Content-Length cannot
 * be trusted and chunked requests cannot allocate without a hard ceiling.
 */
export function collectWorkspaceCloudHttpDiagnostics({ lineCount, read, relative, walk }) {
  const diagnostics = collectWorkspaceCloudGuardSelfDiagnostics();
  const apiRouteFiles = walk("workspace-cloud/app/api/v1")
    .map(relative)
    .filter((filePath) => filePath.endsWith("/route.ts"));
  const routeFiles = walk("workspace-cloud/app/api/v1/workspaces")
    .map(relative)
    .filter((filePath) => filePath.endsWith("/route.ts"));

  for (const filePath of apiRouteFiles) {
    const source = read(filePath);
    if (rawRequestBodyPattern.test(source)) {
      diagnostics.push(
        `${filePath}: API request bodies must use boundedJsonBody instead of a raw Request body reader`,
      );
    }
    if (rawResponseJsonPattern.test(source)) {
      diagnostics.push(
        `${filePath}: upstream response bodies must use a bounded reader instead of response.json()`,
      );
    }
  }

  const analyticsRouteSource = read(productAnalyticsRoute);
  const analyticsServiceSource = read(productAnalyticsService);
  for (const token of [
    "const MAX_BODY_BYTES = 32 * 1_024",
    "boundedJsonBody(request, MAX_BODY_BYTES)",
    "env.productAnalyticsRelayEnabled()",
    "acceptsProductAnalyticsContract(request.headers)",
    "parseProductAnalyticsEnvelope(parsed.value)",
    "consumeProductAnalyticsIngressBudget(request.headers)",
    "consumeProductAnalyticsEnvelopeBudget(\n      envelope.installationId,\n      envelope.events.length,\n    )",
    "{ accepted: true, retryable: false }",
    "retryAfterMs: RETRY_AFTER_MS",
    'headers: { "retry-after": String(RETRY_AFTER_SECONDS) }',
  ]) {
    if (!analyticsRouteSource.includes(token)) {
      diagnostics.push(`${productAnalyticsRoute}: product analytics boundary is missing ${token}`);
    }
  }
  if (
    analyticsRouteSource.indexOf("env.productAnalyticsRelayEnabled()") >
      analyticsRouteSource.indexOf("consumeProductAnalyticsIngressBudget(request.headers)")
  ) {
    diagnostics.push(
      `${productAnalyticsRoute}: dormant product analytics must fail before allocating rate-limit state`,
    );
  }
  if (
    analyticsRouteSource.indexOf("consumeProductAnalyticsIngressBudget(request.headers)") >
      analyticsRouteSource.indexOf("boundedJsonBody(request, MAX_BODY_BYTES)")
  ) {
    diagnostics.push(
      `${productAnalyticsRoute}: product analytics ingress budget must run before the body is read`,
    );
  }
  for (const token of [
    "PRODUCT_EVENT_PROPERTIES",
    'namespace: "product-analytics-ip"',
    'namespace: "product-analytics-installation"',
    'namespace: "product-analytics-global-requests"',
    'namespace: "product-analytics-global-events"',
    "productAnalyticsIngressBudgetPlan(headers)",
    "productAnalyticsEnvelopeBudgetPlan(installationId, eventCount)",
    "for (const budget of budgets)",
    "if (!await consumeRateLimit(budget)) return false",
    "env.productAnalyticsCloudflareToken()",
    "env.productAnalyticsCloudflareUrl()",
    "authorization: `Bearer ${token}`",
    "body: JSON.stringify(envelope)",
    "redirect: \"error\"",
    "AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS)",
  ]) {
    if (!analyticsServiceSource.includes(token)) {
      diagnostics.push(`${productAnalyticsService}: product analytics relay is missing ${token}`);
    }
  }
  if (analyticsServiceSource.includes("${clientKey}\\u0000${installationId}")) {
    diagnostics.push(
      `${productAnalyticsService}: IP and installation budgets must not share one rotatable key`,
    );
  }
  if (/\b(?:posthog-js|posthog-node|@posthog)\b/.test(read("workspace-cloud/package.json"))) {
    diagnostics.push("workspace-cloud/package.json: product analytics must not add a vendor SDK");
  }
  const environmentSource = read("workspace-cloud/lib/env.ts");
  if (
    !environmentSource.includes("PRODUCT_ANALYTICS_WORKER_HOST")
    || environmentSource.includes("eu.i.posthog.com")
    || environmentSource.includes("us.i.posthog.com")
  ) {
    diagnostics.push("workspace-cloud/lib/env.ts: product analytics must use only the dedicated Cloudflare Worker");
  }

  const sourceBrowseRouteSource = read(knowledgeSourceBrowseRoute);
  const sourceBrowseApplicationSource = read(knowledgeSourceBrowseApplication);
  for (const forbidden of ["drizzle-orm", "@/lib/db", "@/lib/schema"]) {
    if (sourceBrowseRouteSource.includes(forbidden)) {
      diagnostics.push(`${knowledgeSourceBrowseRoute}: source browse transport must not own ${forbidden}`);
    }
  }
  for (const token of [
    "authorizeWorkspace(",
    "authorizeWorkspaceConnection(",
    '"use"',
    "personalKnowledgeOrganizationId(",
    "isPersonalKnowledgeMetadata(",
    "knowledgeEnvironmentConnection.connectionRevision",
    "workspaceConnection.revision",
    "knowledgeSource.commitSha",
    "knowledgeGithubInstallation.status",
  ]) {
    if (!sourceBrowseApplicationSource.includes(token)) {
      diagnostics.push(`${knowledgeSourceBrowseApplication}: exact source authority is missing ${token}`);
    }
  }

  const schedulerServiceSource = read(workspaceSchedulerService);
  const schedulerWorkerSource = read(workspaceSchedulerWorker);
  const vercelConfiguration = read("workspace-cloud/vercel.json");
  if (/"crons"\s*:/.test(vercelConfiguration)) {
    diagnostics.push("workspace-cloud/vercel.json: PostgreSQL background work must not regain an independent Vercel cron");
  }
  for (const token of [
    'const CONTRACT_VERSION = "2"',
    "env.workspaceBackgroundSchedulerEnabled()",
    "env.workspaceBackgroundSchedulerUrl()",
    "env.workspaceBackgroundSchedulerToken()",
    '"x-dopedb-background-scheduler-contract": CONTRACT_VERSION',
    '"x-dopedb-background-token": token',
    "boundedJsonResponse(response, MAX_KICK_RESPONSE_BYTES)",
    'redirect: "error"',
    "AbortSignal.timeout(KICK_TIMEOUT_MS)",
    "nextCredentialBackgroundRunAt",
    "nextMaintenanceBackgroundRunAt",
    "nextRunAt: nextRunAt?.toISOString() ?? null",
  ]) {
    if (!schedulerServiceSource.includes(token)) {
      diagnostics.push(`${workspaceSchedulerService}: background scheduler boundary is missing ${token}`);
    }
  }
  if (schedulerServiceSource.includes("IDLE_RECONCILIATION_MS")) {
    diagnostics.push(`${workspaceSchedulerService}: idle Neon reconciliation must remain removed`);
  }
  for (const token of [
    'const CONTRACT_VERSION = "2"',
    'credential: "/api/internal/cron/credential-leases"',
    'maintenance: "/api/internal/cron/maintenance"',
    "MAX_KICK_BODY_BYTES = 1_024",
    "MAX_UPSTREAM_BODY_BYTES = 16 * 1_024",
    "new AbortController()",
    "setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)",
    "validCapability(env.WORKSPACE_CRON_SECRET)",
    "validCapability(env.KICK_TOKEN)",
    'redirect: "manual"',
    "redirectDiagnostic(upstream, expectedUrl)",
    "due_at_ms = min(workspace_background_task_v1.due_at_ms, excluded.due_at_ms)",
    "generation = workspace_background_task_v1.generation + 1",
    "failure_count = 0",
    "CIRCUIT_BREAKER_FAILURES",
    "CIRCUIT_BREAKER_RETRY_MS",
    "value.scheduler.nextRunAt === null",
    "WHERE task = ? AND generation = ? AND lease_token = ?",
    'hostname !== "app.dopedb.dev"',
    'upstream.headers.get("x-dopedb-background-scheduler-contract")',
  ]) {
    if (!schedulerWorkerSource.includes(token)) {
      diagnostics.push(`${workspaceSchedulerWorker}: scheduler Worker boundary is missing ${token}`);
    }
  }
  if (schedulerWorkerSource.includes('/api/internal/cron/knowledge')) {
    diagnostics.push(`${workspaceSchedulerWorker}: dormant Knowledge work must not have a recurring scheduler task`);
  }
  if (/\b(?:workspaceId|organizationId|sourceId|memberId)\b/.test(schedulerWorkerSource)) {
    diagnostics.push(`${workspaceSchedulerWorker}: scheduler D1 must not receive tenant or resource identities`);
  }
  if (
    !environmentSource.includes("WORKSPACE_SCHEDULER_WORKER_HOST")
    || !environmentSource.includes('url.pathname !== "/v1/kick"')
  ) {
    diagnostics.push("workspace-cloud/lib/env.ts: background scheduler must use only the dedicated Cloudflare Worker");
  }
  for (const route of [
    "workspace-cloud/app/api/internal/cron/credential-leases/route.ts",
    "workspace-cloud/app/api/internal/cron/maintenance/route.ts",
  ]) {
    const source = read(route);
    for (const token of [
      "cronRequestAuthorized(request)",
      "workspaceSchedulerRequest(request)",
      "workspaceSchedulerReceipt(nextRunAt)",
      "workspaceSchedulerResponseHeaders()",
    ]) {
      if (!source.includes(token)) {
        diagnostics.push(`${route}: scheduler receipt route is missing ${token}`);
      }
    }
  }
  for (const [producer, tokens] of [
    [
      "workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/lease/route.ts",
      ['task: "credential"', "Provider-enforced expiry is the authority boundary"],
    ],
    [
      "workspace-cloud/lib/provider-integrations/discovery-receipts.ts",
      ['task: "maintenance"', "notBefore: receipt.expiresAt"],
    ],
    [
      "workspace-cloud/lib/provider-integrations/lease-cleanup.ts",
      ['task: "credential"', "result.deferred > 0"],
    ],
    [
      "workspace-cloud/app/api/v1/workspaces/[workspaceId]/backups/[backupId]/route.ts",
      ['task: "maintenance"', "notBefore: purgeAfter"],
    ],
    [
      "workspace-cloud/app/api/v1/workspaces/[workspaceId]/lifecycle/route.ts",
      ['task: "maintenance"', "notBefore: new Date(status.purgeAfter)"],
    ],
  ]) {
    const source = read(producer);
    for (const token of tokens) {
      if (!source.includes(token)) {
        diagnostics.push(`${producer}: event-driven scheduler producer is missing ${token}`);
      }
    }
  }
  const managedLeaseRouteSource = read(
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/lease/route.ts",
  );
  if (
    managedLeaseRouteSource.includes("workspaceBackgroundSchedulerEnabled()")
    || managedLeaseRouteSource.includes("cleanup could not be scheduled")
  ) {
    diagnostics.push(
      "managed lease delivery must rely on provider expiry and bounded request-time cleanup, not scheduler availability",
    );
  }
  const managedLeaseIssuanceSource = read(
    "workspace-cloud/lib/provider-integrations/lease-issuance.ts",
  );
  for (const token of [
    "cleanupExpiredManagedLeases({",
    "integrationId: input.integration.id",
    'input.accessMode === "schema" ? 20 : 2',
  ]) {
    if (!managedLeaseIssuanceSource.includes(token)) {
      diagnostics.push(
        `workspace-cloud/lib/provider-integrations/lease-issuance.ts: request-time cleanup repair is missing ${token}`,
      );
    }
  }
  if (read("workspace-cloud/lib/rate-limit.ts").includes("cleanupExpiredRateLimits")) {
    diagnostics.push("workspace-cloud rate-limit retention must stay on the already-active request path");
  }

  const routeImportCounts = { db: 0, drizzle: 0, schema: 0 };
  for (const filePath of routeFiles) {
    const imports = workspaceCloudRuntimeModuleSpecifiers(read(filePath));
    if (imports.some((specifier) => /(?:^|\/)lib\/db$/.test(specifier))) {
      routeImportCounts.db += 1;
    }
    if (imports.includes("drizzle-orm")) routeImportCounts.drizzle += 1;
    if (imports.some((specifier) => /(?:^|\/)lib\/schema$/.test(specifier))) {
      routeImportCounts.schema += 1;
    }
  }
  for (const key of Object.keys(routeImportBaseline)) {
    if (routeImportCounts[key] > routeImportBaseline[key]) {
      diagnostics.push(
        `workspace-cloud routes: ${key} imports increased from the reviewed baseline ${routeImportBaseline[key]} to ${routeImportCounts[key]}`,
      );
    }
  }

  const migratedRouteSource = read(migratedNeonOperationsRoute);
  if (lineCount(migratedRouteSource) > 140) {
    diagnostics.push(`${migratedNeonOperationsRoute}: migrated transport must remain below 140 lines`);
  }
  for (const forbidden of [
    "drizzle-orm",
    "lib/db",
    "lib/schema",
    "provider-operation-store",
    "recordProviderOperationPlan",
    "claimProviderOperationExecution",
    "completeNeonBranchSwitch",
  ]) {
    if (migratedRouteSource.includes(forbidden)) {
      diagnostics.push(`${migratedNeonOperationsRoute}: transport regained application or persistence responsibility (${forbidden})`);
    }
  }
  for (const required of [
    "boundedJsonBody",
    "authorizeWorkspace",
    "authorizeWorkspaceConnection",
    "listNeonBranchOperations",
    "runNeonBranchOperation",
  ]) {
    if (!migratedRouteSource.includes(required)) {
      diagnostics.push(`${migratedNeonOperationsRoute}: required transport boundary is missing (${required})`);
    }
  }
  const neonOperationModules = [
    neonOperationsApplication,
    ...walk(neonOperationsApplicationDirectory)
      .map(relative)
      .filter((filePath) => filePath.endsWith(".ts")),
  ].sort();
  for (const filePath of neonOperationModules) {
    const source = read(filePath);
    const lineLimit = filePath === neonOperationsApplication ? 100 : 700;
    if (lineCount(source) > lineLimit) {
      diagnostics.push(
        `${filePath}: Neon operation module has ${lineCount(source)} lines; keep it below ${lineLimit}`,
      );
    }
    for (const [pattern, reason] of [
      [/\bboundedJsonBody\b/, "boundedJsonBody"],
      [/\bmutationAllowed\b/, "mutationAllowed"],
      [/\bauthorizeWorkspace\s*\(/, "authorizeWorkspace"],
      [/\bauthorizeWorkspaceConnection\s*\(/, "authorizeWorkspaceConnection"],
    ]) {
      if (pattern.test(source)) {
        diagnostics.push(`${filePath}: application service depends on HTTP transport (${reason})`);
      }
    }
    const transportImport = neonOperationTransportImport(source);
    if (transportImport) {
      diagnostics.push(
        `${filePath}: application service imports HTTP transport (${transportImport})`,
      );
    }
  }
  const applicationSource = read(neonOperationsApplication);
  for (const forbidden of [
    "drizzle-orm",
    "lib/db",
    "lib/schema",
    "provider-operation-store",
    "recordProviderOperationPlan",
    "claimProviderOperationExecution",
    "createNeonBranch",
    "deleteNeonBranch",
    "completeNeonBranchSwitch",
  ]) {
    if (applicationSource.includes(forbidden)) {
      diagnostics.push(
        `${neonOperationsApplication}: dispatcher regained use-case or persistence responsibility (${forbidden})`,
      );
    }
  }
  for (const required of [
    "runNeonBranchCreateOperation",
    "runNeonBranchDeleteOperation",
    "runNeonBranchSwitchOperation",
  ]) {
    if (!applicationSource.includes(required)) {
      diagnostics.push(`${neonOperationsApplication}: required use-case dispatcher is missing (${required})`);
    }
  }

  const cloudSourceFiles = [
    ...walk("workspace-cloud/app"),
    ...walk("workspace-cloud/features"),
    ...walk("workspace-cloud/lib"),
  ].map(relative).filter((filePath) => /\.(?:ts|tsx)$/.test(filePath));
  const cloudSources = new Map(cloudSourceFiles.map((filePath) => [filePath, read(filePath)]));
  const runtimeDependencies = buildWorkspaceCloudDependencyGraph(
    cloudSources,
    workspaceCloudRuntimeModuleSpecifiers,
  );
  for (const [filePath, source] of cloudSources) {
    const specifiers = runtimeDependencies.specifiers.get(filePath) ?? [];
    if (filePath.startsWith("workspace-cloud/lib/") && filePath !== "workspace-cloud/lib/provider-integrations.ts") {
      for (const specifier of specifiers) {
        if (providerIntegrationBarrelPattern.test(specifier)) {
          diagnostics.push(`${filePath}: internal modules must import provider integration leaf modules, not the public barrel`);
        }
      }
    }
  }
  for (const component of cyclicDependencyComponents(runtimeDependencies.graph)) {
    const cycle = component.join(" -> ");
    if (!workspaceCloudDependencyCycleBaseline.has(cycle)) {
      diagnostics.push(`workspace-cloud dependency cycle: ${cycle}`);
    }
  }
  const allDependencies = buildWorkspaceCloudDependencyGraph(
    cloudSources,
    (source) => allModuleSpecifiers(source, { includeDynamic: true }),
  );
  for (const filePath of neonOperationModules) {
    const transportPath = nextServerDependencyPath(
      allDependencies.graph,
      allDependencies.specifiers,
      filePath,
    );
    if (transportPath && transportPath.length > 1) {
      diagnostics.push(
        `${filePath}: application service reaches HTTP transport (${[
          ...transportPath,
          "next/server",
        ].join(" -> ")})`,
      );
    }
  }

  return diagnostics;
}
