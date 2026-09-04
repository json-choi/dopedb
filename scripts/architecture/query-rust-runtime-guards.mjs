export const queryFeatureModules = [
  "src-tauri/src/features/queries/mod.rs",
  "src-tauri/src/features/queries/application.rs",
  "src-tauri/src/features/queries/domain.rs",
  "src-tauri/src/features/queries/manual_transaction.rs",
  "src-tauri/src/features/queries/manual_transaction_execution.rs",
  "src-tauri/src/features/queries/manual_transaction_session.rs",
  "src-tauri/src/features/queries/ports.rs",
  "src-tauri/src/features/queries/transport.rs",
  "src-tauri/src/features/queries/adapters/mod.rs",
  "src-tauri/src/features/queries/adapters/desktop_contracts.rs",
  "src-tauri/src/features/queries/adapters/desktop_execution.rs",
  "src-tauri/src/features/queries/adapters/desktop_inspection.rs",
  "src-tauri/src/features/queries/adapters/desktop_planning.rs",
  "src-tauri/src/features/queries/adapters/desktop_port.rs",
  "src-tauri/src/features/queries/adapters/desktop_provenance.rs",
  "src-tauri/src/features/queries/adapters/desktop_result_store.rs",
  "src-tauri/src/features/queries/adapters/desktop_result_files.rs",
  "src-tauri/src/features/queries/adapters/desktop_result_benchmark.rs",
  "src-tauri/src/features/queries/adapters/desktop_stream_lifecycle.rs",
  "src-tauri/src/features/queries/adapters/desktop_support.rs",
  "src-tauri/src/features/queries/adapters/desktop_trace.rs",
  "src-tauri/src/features/queries/adapters/desktop_stream_registry.rs",
  "src-tauri/src/features/queries/adapters/errors.rs",
  "src-tauri/src/features/queries/adapters/platform.rs",
  "src-tauri/src/features/queries/adapters/terminal_plan.rs",
  "src-tauri/src/features/queries/adapters/terminal_run.rs",
  "src-tauri/src/features/queries/adapters/terminal_support.rs",
];

export const queryFeatureTestModules = [
  "src-tauri/src/features/queries/domain_tests.rs",
];

const queryFeatureTestLineLimit = 800;
const queryCoreFiles = [
  "src-tauri/src/features/queries/domain.rs",
  "src-tauri/src/features/queries/ports.rs",
  "src-tauri/src/features/queries/application.rs",
];

function requireFile({ exists }, diagnostics, filePath) {
  if (!exists(filePath)) diagnostics.push(`required architecture file is missing: ${filePath}`);
}

function forbid({ read }, diagnostics, filePath, rules) {
  const text = read(filePath);
  for (const [pattern, reason] of rules) {
    if (pattern.test(text)) diagnostics.push(`${filePath}: ${reason}`);
  }
}

export function collectQueryProductionModuleDiagnostics(context) {
  const { lineCount, ratchet, read } = context;
  const diagnostics = [];
  for (const filePath of queryFeatureModules) {
    requireFile(context, diagnostics, filePath);
    const lines = lineCount(read(filePath));
    if (lines > ratchet.featureFileLineLimit) {
      diagnostics.push(
        `${filePath}: query module has ${lines} lines; keep query modules below ${ratchet.featureFileLineLimit}`,
      );
    }
  }
  return diagnostics;
}

export function collectQueryTestModuleDiagnostics(context) {
  const { lineCount, ratchet, read, relative, walk } = context;
  const diagnostics = [];
  for (const filePath of queryFeatureTestModules) {
    requireFile(context, diagnostics, filePath);
    const lines = lineCount(read(filePath));
    if (lines > queryFeatureTestLineLimit) {
      diagnostics.push(
        `${filePath}: Query feature test has ${lines} lines; keep it below ${queryFeatureTestLineLimit}`,
      );
    }
  }
  const actual = walk("src-tauri/src/features/queries")
    .map(relative)
    .filter((filePath) => filePath.endsWith(".rs"))
    .sort();
  const expected = [...queryFeatureModules, ...queryFeatureTestModules].sort();
  if (
    actual.length !== expected.length ||
    actual.some((filePath, index) => filePath !== expected[index])
  ) {
    diagnostics.push(
      `src-tauri/src/features/queries: approved module set changed; expected ${expected.join(", ")}, found ${actual.join(", ") || "none"}`,
    );
  }
  return diagnostics;
}

export function collectRemovedQueryRuntimeDiagnostics(rustSource) {
  return [
    "TerminalQueryAdapter",
    "classify_sql",
    "preview_sql",
    "ClassifySqlRequest",
    "ClassifySqlReceipt",
    "PreviewSqlRequest",
    "PreviewSqlReceipt",
    "DesktopSqlPreviewRequest",
    "DesktopSqlPreviewReceipt",
    "ClassifySql",
    "PreviewSql",
  ]
    .filter((token) => rustSource.includes(token))
    .map((token) => `removed runtime token returned: ${token}`);
}

export function collectQuerySharedCoreDiagnostics(context) {
  const diagnostics = [];
  const genericRules = [
    [/crate::connection/, "feature core must not depend on the connection adapter"],
    [/crate::store/, "feature core must not depend on the SQLite store"],
    [/\bsqlx\b/, "feature core must not depend on SQLx"],
    [/\btauri\b/, "feature core must not depend on Tauri"],
    [/crate::state/, "feature core must not depend on global app state"],
    [/crate::services/, "feature core must not depend on the service facade"],
    [/crate::driver/, "feature core must not depend on the driver adapter"],
    [/\bdopedb_protocol\b/, "feature core must not depend on a transport protocol"],
  ];
  for (const filePath of queryCoreFiles) {
    requireFile(context, diagnostics, filePath);
    forbid(context, diagnostics, filePath, genericRules);
  }
  for (const filePath of queryCoreFiles) {
    forbid(context, diagnostics, filePath, [
      [/\bConnectionLease\b/, "Query core must keep lease guards in adapters"],
      [/\bAppError\b|\bAppResult\b/, "Query core must expose feature errors through ports"],
      [/\badapters::/, "Query core must not depend on concrete adapters"],
    ]);
  }
  return diagnostics;
}

function productionRust(read, filePath) {
  return read(filePath)
    .replace(/\r\n/g, "\n")
    .split(/\n#\[cfg\([^\n]*\)\]\nmod tests \{/)[0];
}

const brokerRuntimeFiles = [
  "src-tauri/src/broker/mod.rs",
  "src-tauri/src/broker/session.rs",
  "src-tauri/src/broker/discovery.rs",
  "src-tauri/src/broker/server.rs",
  "src-tauri/src/broker/dispatch/mod.rs",
  "src-tauri/src/broker/dispatch/public_skill.rs",
];
const runtimeIdLocalAliasRules = [
  /\b(?:let|const)\s+\w+\s*:\s*RuntimeId\b/,
  /\b(?:let|const)\s+\w+(?:\s*:\s*RuntimeId)?\s*=\s*RuntimeId::from\b/,
  /\b(?:let|const)\s+\w+(?:\s*:\s*RuntimeId)?\s*=\s*(?:\w+\.)+runtime_id\s*(?:\(\))?\s*;/,
];
const runtimeUuidBoundaryLines = new Map([
  ["src-tauri/src/broker/discovery.rs", ["RuntimeId::from(discovery.runtime_id())"]],
  ["src-tauri/src/broker/server.rs", ["runtime.runtime_id().into()"]],
  [
    "src-tauri/src/broker/dispatch/public_skill.rs",
    [
      "dispatcher.runtime_id.into()",
      "dispatcher.runtime_id.into()",
      "self.runtime_id.into()",
    ],
  ],
]);
const runtimeUuidConversion =
  /\b(?:RuntimeId|Uuid)::from\s*\([^\n]*\bruntime_id\b|\bruntime_id(?:\(\))?\.into\s*\(/;

function runtimeUuidConversionsAreAllowed(filePath, source) {
  const conversions = source
    .split(/\r?\n/)
    .filter((line) => runtimeUuidConversion.test(line));
  const allowed = runtimeUuidBoundaryLines.get(filePath) ?? [];
  return (
    conversions.length === allowed.length &&
    allowed.every((boundary, index) => conversions[index]?.includes(boundary))
  );
}

export function collectRuntimeIdDiagnostics({ read }) {
  const diagnostics = [];
  if (!read("src-tauri/src/kernel/identity.rs").includes("uuid_identity!(RuntimeId);")) {
    diagnostics.push("Broker runtime identity must stay a distinct RuntimeId");
  }
  for (const fixture of [
    "let alias = runtime.runtime_id();",
    "let alias: RuntimeId = self.runtime_id;",
    "let alias = RuntimeId::from(raw);",
    "let alias = dispatcher.runtime_id;",
    "let alias = self.inner.runtime_id;",
    "let alias = nested.runtime.runtime_id();",
    "let alias = dispatcher.runtime_id; let raw = Uuid::from(alias);",
  ]) {
    if (!runtimeIdLocalAliasRules.some((pattern) => pattern.test(fixture))) {
      diagnostics.push(`Broker RuntimeId guard self-test failed for local alias: ${fixture}`);
    }
  }
  const crlfProduction = productionRust(
    () =>
      "fn production() {}\r\n#[cfg(test)]\r\nmod tests {\r\nlet alias = dispatcher.runtime_id;\r\nlet raw = runtime.runtime_id().into();\r\n}\r\n",
    "crlf-fixture.rs",
  );
  if (
    crlfProduction !== "fn production() {}" ||
    runtimeIdLocalAliasRules.some((pattern) => pattern.test(crlfProduction)) ||
    runtimeUuidConversion.test(crlfProduction)
  ) {
    diagnostics.push("Broker RuntimeId CRLF test-module boundary self-test failed");
  }
  for (const filePath of brokerRuntimeFiles) {
    const source = productionRust(read, filePath);
    for (const [pattern, reason] of [
      [/\bruntime_id\s*:\s*(?:uuid::)?Uuid\b/, "Broker runtime identity must stay typed as RuntimeId"],
      [
        /\bfn\s+\w+[^\n{;]*(?:runtime_id\s*:\s*(?:uuid::)?Uuid|->\s*(?:uuid::)?Uuid)/,
        "Broker runtime APIs must not expose a raw runtime UUID",
      ],
      [/\b(?:let|const)\s+runtime_id\s*:\s*(?:uuid::)?Uuid\b/, "Broker internals must not store a raw runtime UUID"],
    ]) {
      if (pattern.test(source)) diagnostics.push(`${filePath}: ${reason}`);
    }
    if (runtimeIdLocalAliasRules.some((pattern) => pattern.test(source))) {
      diagnostics.push(`${filePath}: Broker RuntimeId values must not be rebound through local aliases`);
    }
  }
  for (const [filePath, token] of [
    ["src-tauri/src/broker/mod.rs", "pub(crate) fn runtime_id(&self) -> RuntimeId"],
    ["src-tauri/src/broker/session.rs", "pub(crate) runtime_id: RuntimeId"],
    ["src-tauri/src/broker/discovery.rs", "runtime_id: RuntimeId"],
    ["src-tauri/src/broker/dispatch/mod.rs", "runtime_id: RuntimeId"],
  ]) {
    if (!read(filePath).includes(token)) {
      diagnostics.push(`${filePath}: typed Broker RuntimeId boundary is missing ${token}`);
    }
  }
  if (
    !runtimeUuidConversionsAreAllowed(
      "src-tauri/src/broker/server.rs",
      "runtime.runtime_id().into(),",
    ) ||
    runtimeUuidConversionsAreAllowed(
      "src-tauri/src/broker/mod.rs",
      "let raw = runtime.runtime_id().into();",
    )
  ) {
    diagnostics.push("Broker RuntimeId conversion allowlist self-test failed");
  }
  for (const filePath of brokerRuntimeFiles) {
    if (!runtimeUuidConversionsAreAllowed(filePath, productionRust(read, filePath))) {
      diagnostics.push(
        `${filePath}: raw RuntimeId UUID conversion is allowed only at the explicit protocol boundary`,
      );
    }
  }
  return diagnostics;
}

export function collectQueryCentralCommandDiagnostics({ read }) {
  const diagnostics = [];
  const filePath = "src-tauri/src/commands/mod.rs";
  for (const [pattern, reason] of [
    [/\bpub async fn classify_sql\b/, "SQL classification returned to the central command module"],
    [/\bpub async fn preview_sql\b/, "SQL preview returned to the central command module"],
    [/\bpub async fn propose_sql\b/, "SQL proposal returned to the central command module"],
    [/\bpub async fn run_sql\b/, "SQL execution returned to the central command module"],
  ]) {
    if (pattern.test(read(filePath))) diagnostics.push(`${filePath}: ${reason}`);
  }
  return diagnostics;
}

function tauriCommandDeclaration(command) {
  return new RegExp(
    String.raw`#\[\s*tauri::command(?:\s*\([^\]]*\))?\s*\][\s\S]*?\b(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+${command}\b`,
  );
}

export function collectQueryTauriCommandDiagnostics({ read, relative, sourceFiles }) {
  const diagnostics = [];
  for (const visibility of ["", "pub ", "pub(crate) "]) {
    if (!tauriCommandDeclaration("inspect_sql").test(`#[tauri::command]\n${visibility}async fn inspect_sql() {}`)) {
      diagnostics.push(`Rust Tauri command guard self-test failed for ${visibility || "private"} visibility`);
    }
  }
  for (const command of ["inspect_sql", "propose_sql", "run_sql", "run_sql_stream", "run_sql_read_stream", "pull_sql_stream_batch", "ack_sql_stream", "cancel_sql_stream"]) {
    const owners = sourceFiles
      .filter((file) => file.endsWith(".rs"))
      .filter((file) => tauriCommandDeclaration(command).test(read(relative(file))))
      .map(relative);
    if (owners.length !== 1 || owners[0] !== "src-tauri/src/features/queries/transport.rs") {
      diagnostics.push(
        `${command}: expected only src-tauri/src/features/queries/transport.rs, found ${owners.join(", ") || "none"}`,
      );
    }
  }
  for (const command of ["classify_sql", "preview_sql"]) {
    const owners = sourceFiles
      .filter((file) => file.endsWith(".rs"))
      .filter((file) => tauriCommandDeclaration(command).test(read(relative(file))))
      .map(relative);
    if (owners.length !== 0) {
      diagnostics.push(`${command}: removed Tauri command returned in ${owners.join(", ")}`);
    }
  }
  for (const command of ["classify_sql", "preview_sql"]) {
    if (!tauriCommandDeclaration(command).test(`#[tauri::command]\npub(crate) async fn ${command}() {}`)) {
      diagnostics.push(`Rust removed Query command guard self-test failed for ${command}`);
    }
  }
  return diagnostics;
}

const queryCoreDependencyRules = [
  [/use\s+crate\s+as\s+\w+\s*;/, "Query core must not alias the crate root"],
  [/crate::store|\bStore\b|use\s+crate::\s*\{[^}]*\bstore\b/, "Query core must not depend on the store adapter"],
  [/crate::connection|\bConnectionManager\b|use\s+crate::\s*\{[^}]*\bconnection\b/, "Query core must not depend on the connection runtime"],
  [/crate::operations|\bOperationRuntime\b|use\s+crate::\s*\{[^}]*\boperations\b/, "Query core must not depend on the operation runtime"],
  [/crate::state|\bAppState\b|use\s+crate::\s*\{[^}]*\bstate\b/, "Query core must not depend on application state"],
  [/\btauri\b/, "Query core must not depend on Tauri transport"],
  [/\bsqlx\b/, "Query core must not depend on SQL adapters"],
  [/super::adapters/, "Query core must not depend on concrete adapters"],
];

export function collectQueryRuntimeOwnershipDiagnostics(context) {
  const { read, relative, sourceFiles } = context;
  const diagnostics = [];
  const transport = "src-tauri/src/features/queries/transport.rs";
  const appEntrypoint = "src-tauri/src/lib.rs";
  const appEntrypointSource = read(appEntrypoint);
  if (!appEntrypointSource.includes("queries.shutdown_desktop_streams(Duration::from_secs(2))")) {
    diagnostics.push(
      `${appEntrypoint}: Tauri Exit must bounded-drain owned desktop SQL streams before runtime teardown`,
    );
  }
  if (!appEntrypointSource.includes("connections.shutdown_all()")) {
    diagnostics.push(
      `${appEntrypoint}: Tauri Exit must bounded-stop connection pools and child transports before runtime teardown`,
    );
  }
  if (/block_on\s*\(\s*tokio::time::timeout/.test(appEntrypointSource)) {
    diagnostics.push(
      `${appEntrypoint}: Tokio timeout futures must be constructed inside the async runtime`,
    );
  }
  forbid(context, diagnostics, transport, [
    [/\bsqlx\b/, "Query transport must delegate instead of executing SQL"],
    [/crate::store/, "Query transport must not access the store directly"],
    [/crate::connection/, "Query transport must not authorize connections directly"],
    [/\bOperationRuntime\b/, "Query transport must delegate durable operations"],
    [/adapters::/, "Query transport must not depend on concrete adapters"],
    [/\bTerminalQueryAdapter\b/, "Query transport must delegate through the feature use cases"],
  ]);
  const transportSource = read(transport);
  for (const [command, useCase] of [
    ["inspect_sql", "inspect_desktop_sql"],
    ["propose_sql", "propose_desktop_sql"],
    ["run_sql", "run_desktop_sql"],
    ["run_sql_stream", "run_desktop_sql_stream"],
    ["run_sql_read_stream", "run_desktop_sql_read_stream"],
    ["pull_sql_stream_batch", "pull_desktop_sql_stream"],
    ["ack_sql_stream", "acknowledge_desktop_sql_stream"],
    ["cancel_sql_stream", "cancel_desktop_sql_stream"],
  ]) {
    if (!tauriCommandDeclaration(command).test(transportSource) || !transportSource.includes(useCase)) {
      diagnostics.push(`${transport}: ${command} must delegate only through ${useCase}`);
    }
  }
  for (const [name, fixture] of [
    ["crate-root alias", "use crate as root_alias; type Data = root_alias::connection::ConnectionManager;"],
    ["store module alias", "use crate::{store as persistence}; type Data = persistence::Backend;"],
    ["connection module alias", "use crate::{connection as pools}; type Data = pools::Backend;"],
    ["operation module alias", "use crate::{operations as work}; type Data = work::Backend;"],
    ["application-state alias", "use crate::{state as app}; type Data = app::Backend;"],
    ["Tauri alias", "use tauri as desktop; type Data = desktop::State<'static, ();>"],
    ["SQLx alias", "use sqlx as database; type Data = database::Pool<database::Sqlite>;"],
  ]) {
    if (!queryCoreDependencyRules.some(([pattern]) => pattern.test(fixture))) {
      diagnostics.push(`Query core dependency guard self-test failed for ${name}`);
    }
  }
  for (const filePath of queryCoreFiles) forbid(context, diagnostics, filePath, queryCoreDependencyRules);
  const owners = sourceFiles
    .filter((file) => file.endsWith(".rs"))
    .filter((file) => read(relative(file)).includes("pub(crate) struct QueryPlatformAdapter"))
    .map(relative);
  if (owners.length !== 1 || owners[0] !== "src-tauri/src/features/queries/adapters/platform.rs") {
    diagnostics.push(
      `QueryPlatformAdapter must be owned only by the Query platform adapter, found ${owners.join(", ") || "none"}`,
    );
  }
  return diagnostics;
}
