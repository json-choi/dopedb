import { createHash } from "node:crypto";
import { arch, platform, release } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

if (typeof global.gc !== "function") {
  throw new Error("run with node --expose-gc");
}

const HISTORY_ROWS = 10_000;
const AUDIT_ROWS = 100_000;
const REVISION_ROWS = 50;
const HISTORY_PAGE_SIZE = 100;
const AUDIT_PAGE_SIZE = 50;
const REVISION_PAGE_SIZE = 20;
const SAMPLES = 20;

const db = new DatabaseSync(":memory:");
db.exec(`
  PRAGMA journal_mode = MEMORY;
  PRAGMA synchronous = OFF;
  CREATE TABLE query_history (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    account_scope TEXT NOT NULL,
    sql TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    row_count INTEGER,
    duration_ms INTEGER,
    error TEXT,
    executed_at TEXT NOT NULL,
    origin TEXT NOT NULL
  );
  CREATE INDEX idx_history_scope_recent
    ON query_history(connection_id, account_scope, executed_at DESC);
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    engine TEXT NOT NULL,
    agent_prompt TEXT,
    sql TEXT NOT NULL,
    kind TEXT NOT NULL,
    action TEXT NOT NULL,
    approved_by TEXT,
    affected_estimate INTEGER,
    error TEXT,
    prev_hash TEXT,
    hash TEXT NOT NULL
  );
  CREATE INDEX idx_audit_connection_row ON audit_log(connection_id);
  CREATE TABLE sql_documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    account_scope TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE sql_document_revisions (
    document_id TEXT NOT NULL,
    local_revision INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(document_id, local_revision)
  );
  CREATE INDEX idx_sql_document_revisions_recent
    ON sql_document_revisions(document_id, local_revision DESC);
`);

seedHistory();
seedAudit();
seedRevisions();

const historyStatement = db.prepare(`
  SELECT rowid AS historyRowId, id, connection_id AS connectionId,
         substr(sql, 1, 512) AS sqlPreview,
         length(sql) > 512 AS sqlTruncated,
         kind, status, row_count AS rowCount, duration_ms AS durationMs,
         CASE WHEN error IS NULL THEN NULL ELSE substr(error, 1, 256) END AS errorPreview,
         COALESCE(length(error) > 256, 0) AS errorTruncated,
         executed_at AS executedAt, origin
  FROM query_history
  WHERE connection_id = ? AND account_scope = ?
  ORDER BY executed_at DESC, rowid DESC
  LIMIT ?
`);
const auditStatement = db.prepare(`
  SELECT rowid AS auditRowId, id, connection_id AS connectionId, ts, engine,
         CASE WHEN agent_prompt IS NULL THEN NULL ELSE substr(agent_prompt, 1, 512) END AS agentPromptPreview,
         COALESCE(length(agent_prompt) > 512, 0) AS agentPromptTruncated,
         substr(sql, 1, 2048) AS sqlPreview,
         length(sql) > 2048 AS sqlTruncated,
         kind, action, approved_by AS approvedBy, affected_estimate AS affectedEstimate,
         CASE WHEN error IS NULL THEN NULL ELSE substr(error, 1, 512) END AS errorPreview,
         COALESCE(length(error) > 512, 0) AS errorTruncated,
         prev_hash AS prevHash, hash
  FROM audit_log
  WHERE connection_id = ?
  ORDER BY rowid DESC
  LIMIT ?
`);
const revisionStatement = db.prepare(`
  SELECT revisions.document_id AS documentId,
         revisions.local_revision AS localRevision,
         substr(revisions.content, 1, 512) AS contentPreview,
         length(revisions.content) > 512 AS contentTruncated,
         revisions.created_at AS createdAt
  FROM sql_document_revisions revisions
  INNER JOIN sql_documents documents ON documents.id = revisions.document_id
  WHERE revisions.document_id = ?
    AND documents.workspace_id = ?
    AND documents.account_scope = ?
    AND documents.connection_id = ?
    AND documents.deleted_at IS NULL
  ORDER BY revisions.local_revision DESC
  LIMIT ?
`);

const history = measureRetained(() => page(historyStatement, ["connection", "account", HISTORY_PAGE_SIZE + 1], HISTORY_PAGE_SIZE));
const auditPage = measureRetained(() => page(auditStatement, ["connection", AUDIT_PAGE_SIZE + 1], AUDIT_PAGE_SIZE));
const revisions = measureRetained(() => page(revisionStatement, ["document", "workspace", "account", "connection", REVISION_PAGE_SIZE + 1], REVISION_PAGE_SIZE));
const auditVerification = measureAuditVerification();
const analysisArticle = measureAnalysisArticles();

const report = {
  schemaVersion: 1,
  measurementScope: "sqlite_ipc_renderer_model",
  environment: {
    os: platform(),
    release: release(),
    arch: arch(),
    node: process.version,
  },
  methodology:
    "In-memory SQLite uses the production cursor-list SELECT shapes and production page/preview limits. IPC bytes are JSON UTF-8 bytes for one retained page. Heap is the non-negative V8 heap delta after forced GC while retaining only that page or the four-entry Analysis Article result LRU. Open latency is p50/p95 over 20 synchronous first-page reads after seeding. Audit full verification iterates genesis-to-tail without collecting rows. Analysis values model the current one-query row and byte caps, 60s gcTime, and four-result LRU. This excludes Tauri serialization overhead, React DOM, provider/network latency, and packaged-WebView baseline memory.",
  fixtures: {
    historyRows: HISTORY_ROWS,
    auditRows: AUDIT_ROWS,
    largeRevisions: REVISION_ROWS,
    revisionBytesEach: Buffer.byteLength(largeRevisionContent()),
    analysisInputRows: 100_000,
    analysisQueriesRun: 8,
  },
  surfaces: {
    history: history,
    auditPage,
    auditFullVerification: auditVerification,
    localHistory: revisions,
    analysisArticles: analysisArticle,
  },
};

console.log(JSON.stringify(report, null, 2));

function seedHistory() {
  const insert = db.prepare(`
    INSERT INTO query_history
      (id, connection_id, account_scope, sql, kind, status, row_count,
       duration_ms, error, executed_at, origin)
    VALUES (?, 'connection', 'account', ?, 'read', 'ok', 1, 2, NULL, ?, 'manual')
  `);
  db.exec("BEGIN");
  for (let index = 0; index < HISTORY_ROWS; index += 1) {
    insert.run(`history-${index}`, `SELECT ${index} /* ${"h".repeat(2048)} */`, timestamp(index));
  }
  db.exec("COMMIT");
}

function seedAudit() {
  const insert = db.prepare(`
    INSERT INTO audit_log
      (id, connection_id, ts, engine, agent_prompt, sql, kind, action,
       approved_by, affected_estimate, error, prev_hash, hash)
    VALUES (?, 'connection', ?, 'sqlite', ?, ?, 'read', 'execute', NULL, 1, NULL, ?, ?)
  `);
  let previous = null;
  db.exec("BEGIN");
  for (let index = 0; index < AUDIT_ROWS; index += 1) {
    const id = `audit-${index}`;
    const ts = timestamp(index);
    const prompt = `inspect row ${index} ${"p".repeat(256)}`;
    const sql = `SELECT ${index} /* ${"a".repeat(512)} */`;
    const hash = auditHash(previous, id, ts, prompt, sql);
    insert.run(id, ts, prompt, sql, previous, hash);
    previous = hash;
  }
  db.exec("COMMIT");
}

function seedRevisions() {
  db.prepare("INSERT INTO sql_documents VALUES ('document', 'workspace', 'account', 'connection', NULL)").run();
  const insert = db.prepare("INSERT INTO sql_document_revisions VALUES ('document', ?, ?, ?)");
  const content = largeRevisionContent();
  db.exec("BEGIN");
  for (let revision = 1; revision <= REVISION_ROWS; revision += 1) {
    insert.run(revision, `${content}\n-- revision ${revision}`, timestamp(revision));
  }
  db.exec("COMMIT");
}

function largeRevisionContent() {
  return `SELECT '${"r".repeat(1024 * 1024)}';`;
}

function timestamp(index) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
}

function auditHash(previous, id, ts, prompt, sql) {
  return createHash("sha256")
    .update(`${previous ?? ""}\u0000${id}\u0000${ts}\u0000${prompt}\u0000${sql}`)
    .digest("hex");
}

function page(statement, args, pageSize) {
  const rows = statement.all(...args);
  const hasMore = rows.length > pageSize;
  if (hasMore) rows.pop();
  return { items: rows, nextCursor: hasMore ? rows.at(-1) : null };
}

function samples(operation) {
  const values = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const started = performance.now();
    operation();
    values.push((performance.now() - started) * 1000);
  }
  values.sort((left, right) => left - right);
  return {
    p50Us: Math.round(values[Math.ceil(values.length * 0.5) - 1]),
    p95Us: Math.round(values[Math.ceil(values.length * 0.95) - 1]),
  };
}

function measureRetained(load) {
  load();
  const latency = samples(load);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  const retained = load();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  return {
    retainedRows: retained.items.length,
    hasNextPage: retained.nextCursor !== null,
    ipcBytes: Buffer.byteLength(JSON.stringify(retained)),
    retainedHeapDeltaBytes: Math.max(0, after - before),
    openLatencyP50Us: latency.p50Us,
    openLatencyP95Us: latency.p95Us,
  };
}

function verifyAudit() {
  let expected = null;
  let count = 0;
  for (const row of db.prepare("SELECT * FROM audit_log WHERE connection_id = 'connection' ORDER BY rowid ASC").iterate()) {
    const computed = auditHash(expected, row.id, row.ts, row.agent_prompt, row.sql);
    if (row.prev_hash !== expected || row.hash !== computed) {
      return { ok: false, entryCount: count, tailHash: expected };
    }
    expected = row.hash;
    count += 1;
  }
  return { ok: true, entryCount: count, tailHash: expected };
}

function measureAuditVerification() {
  verifyAudit();
  global.gc();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const verdict = verifyAudit();
  const latencyMs = performance.now() - started;
  global.gc();
  const after = process.memoryUsage().heapUsed;
  return {
    ...verdict,
    retainedHeapDeltaBytes: Math.max(0, after - before),
    latencyMs: Math.round(latencyMs * 10) / 10,
  };
}

function measureAnalysisArticles() {
  const sourceRow = ["2026-01-01", "x".repeat(192), 42];
  const inputRows = Array.from({ length: 100_000 }, () => sourceRow);
  const rowCap = 5_000;
  const byteCap = 1024 * 1024;
  const bounded = enforceResultBudget(inputRows, rowCap, byteCap);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  const cache = new Map();
  for (let run = 0; run < 8; run += 1) {
    const wirePayload = JSON.stringify(bounded);
    cache.delete(`run-${run}`);
    cache.set(`run-${run}`, JSON.parse(wirePayload));
    while (cache.size > 4) cache.delete(cache.keys().next().value);
  }
  global.gc();
  const after = process.memoryUsage().heapUsed;
  return {
    query: {
      retainedRows: bounded.rows.length,
      ipcBytes: Buffer.byteLength(JSON.stringify(bounded)),
      rowCap,
      byteCap,
      truncated: bounded.truncated,
    },
    cacheEntriesAfterEightRuns: cache.size,
    cacheIpcBytes: [...cache.values()].reduce(
      (total, result) => total + Buffer.byteLength(JSON.stringify(result)),
      0,
    ),
    retainedHeapDeltaBytes: Math.max(0, after - before),
    gcTimeMs: 60_000,
  };
}

function enforceResultBudget(sourceRows, rowCap, byteCap) {
  const columns = ["day", "payload", "value"];
  let low = 0;
  let high = Math.min(sourceRows.length, rowCap);
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    const candidate = {
      columns,
      rows: sourceRows.slice(0, middle),
      rowCount: middle,
      truncated: middle < sourceRows.length,
      durationMs: 1,
    };
    if (Buffer.byteLength(JSON.stringify(candidate)) <= byteCap) low = middle;
    else high = middle - 1;
  }
  return {
    columns,
    rows: sourceRows.slice(0, low),
    rowCount: low,
    truncated: low < sourceRows.length,
    durationMs: 1,
  };
}
