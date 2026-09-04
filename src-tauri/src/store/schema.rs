//! Current DDL baseline for a fresh local app database.
//! Secrets never live here — connections hold only a `secret_ref` (credential-store id).

/// Stable id for the offline-first Personal Workspace created at bootstrap.
pub const PERSONAL_WORKSPACE_ID: &str = "00000000-0000-0000-0000-000000000001";

/// Project Knowledge stays in a separate baseline block so focused tests can
/// create that domain independently while receiving the same constraints.
/// Absolute Local Folder paths, repository credentials, and source bodies are
/// intentionally absent.
pub const KNOWLEDGE_SCHEMA: &str = r#"
CREATE TABLE knowledge_projects (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 512),
    revision     INTEGER NOT NULL CHECK(revision > 0),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE(workspace_id, name)
);

CREATE TABLE knowledge_project_environments (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 512),
    production INTEGER NOT NULL CHECK(production IN (0, 1)),
    risk_class TEXT NOT NULL DEFAULT 'custom'
               CHECK(risk_class IN ('production', 'staging', 'development', 'test', 'custom')),
    revision   INTEGER NOT NULL CHECK(revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name)
);

CREATE TABLE knowledge_sources (
    id                     TEXT PRIMARY KEY,
    project_id             TEXT NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
    project_environment_id TEXT NOT NULL REFERENCES knowledge_project_environments(id) ON DELETE CASCADE,
    environment_revision   INTEGER NOT NULL CHECK(environment_revision > 0),
    provider               TEXT NOT NULL CHECK(provider IN ('github', 'local_folder')),
    display_name           TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 512),
    visibility             TEXT NOT NULL CHECK(visibility IN ('local_only', 'shared_graph')),
    binding_json           TEXT NOT NULL CHECK(json_valid(binding_json) AND length(binding_json) <= 65536),
    source_revision_sha256 TEXT CHECK(source_revision_sha256 IS NULL OR
                               (length(source_revision_sha256) = 64 AND
                                source_revision_sha256 NOT GLOB '*[^0-9a-f]*')),
    snapshot_json          TEXT CHECK(snapshot_json IS NULL OR
                               (json_valid(snapshot_json) AND length(snapshot_json) <= 67108864)),
    revoked_at             TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);
CREATE INDEX idx_knowledge_sources_environment
    ON knowledge_sources(project_environment_id, provider, updated_at DESC);

CREATE TABLE knowledge_environment_connections (
    id                     TEXT PRIMARY KEY,
    workspace_id           TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_environment_id TEXT NOT NULL REFERENCES knowledge_project_environments(id) ON DELETE CASCADE,
    environment_revision   INTEGER NOT NULL CHECK(environment_revision > 0),
    connection_id          TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    connection_revision    INTEGER NOT NULL CHECK(connection_revision > 0),
    role                   TEXT NOT NULL CHECK(length(role) BETWEEN 1 AND 64),
    alias                  TEXT NOT NULL CHECK(length(alias) BETWEEN 1 AND 128),
    created_at             TEXT NOT NULL,
    revoked_at             TEXT
);
CREATE UNIQUE INDEX idx_knowledge_environment_connection_active
    ON knowledge_environment_connections(project_environment_id, connection_id)
    WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_knowledge_environment_connection_workspace_active
    ON knowledge_environment_connections(workspace_id, connection_id)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_knowledge_environment_connection_scope
    ON knowledge_environment_connections(workspace_id, project_environment_id, revoked_at);

CREATE TABLE knowledge_graph_revisions (
    graph_revision_id        TEXT PRIMARY KEY,
    source_id                TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    project_environment_id   TEXT NOT NULL REFERENCES knowledge_project_environments(id) ON DELETE CASCADE,
    environment_revision     INTEGER NOT NULL CHECK(environment_revision > 0),
    parent_graph_revision_id TEXT REFERENCES knowledge_graph_revisions(graph_revision_id),
    source_revision_sha256   TEXT NOT NULL
                             CHECK(length(source_revision_sha256) = 64
                               AND source_revision_sha256 NOT GLOB '*[^0-9a-f]*'),
    artifact_sha256          TEXT NOT NULL
                             CHECK(length(artifact_sha256) = 64
                               AND artifact_sha256 NOT GLOB '*[^0-9a-f]*'),
    artifact_json            TEXT NOT NULL CHECK(json_valid(artifact_json)),
    generated_at             TEXT NOT NULL,
    staged_at                TEXT NOT NULL
);
CREATE INDEX idx_knowledge_graph_revisions_environment
    ON knowledge_graph_revisions(project_environment_id, staged_at DESC);

CREATE TABLE knowledge_environment_heads (
    project_environment_id TEXT NOT NULL
                           REFERENCES knowledge_project_environments(id) ON DELETE CASCADE,
    source_id              TEXT NOT NULL
                           REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    graph_revision_id      TEXT NOT NULL UNIQUE
                           REFERENCES knowledge_graph_revisions(graph_revision_id),
    environment_revision   INTEGER NOT NULL CHECK(environment_revision > 0),
    activated_at           TEXT NOT NULL,
    PRIMARY KEY (project_environment_id, source_id)
);

CREATE TABLE knowledge_grants (
    id                     TEXT PRIMARY KEY,
    workspace_id           TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_user_id        TEXT NOT NULL CHECK(account_user_id <> ''),
    project_id             TEXT NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
    project_environment_id TEXT NOT NULL REFERENCES knowledge_project_environments(id) ON DELETE CASCADE,
    environment_revision   INTEGER NOT NULL CHECK(environment_revision > 0),
    graph_revision_id      TEXT NOT NULL REFERENCES knowledge_graph_revisions(graph_revision_id),
    expires_at             TEXT NOT NULL,
    created_at             TEXT NOT NULL,
    UNIQUE(workspace_id, account_user_id, project_environment_id, graph_revision_id)
);
CREATE INDEX idx_knowledge_grants_account
    ON knowledge_grants(workspace_id, account_user_id, expires_at);

CREATE TABLE knowledge_grant_graph_revisions (
    grant_id          TEXT NOT NULL REFERENCES knowledge_grants(id) ON DELETE CASCADE,
    graph_revision_id TEXT NOT NULL REFERENCES knowledge_graph_revisions(graph_revision_id),
    PRIMARY KEY (grant_id, graph_revision_id)
);

CREATE TABLE knowledge_mapping_proposals (
    id                     TEXT PRIMARY KEY,
    project_environment_id TEXT NOT NULL REFERENCES knowledge_project_environments(id) ON DELETE CASCADE,
    graph_revision_id      TEXT NOT NULL REFERENCES knowledge_graph_revisions(graph_revision_id),
    schema_fingerprint     TEXT NOT NULL
                           CHECK(length(schema_fingerprint) = 64
                             AND schema_fingerprint NOT GLOB '*[^0-9a-f]*'),
    from_node_id           TEXT NOT NULL
                           CHECK(length(from_node_id) = 64
                             AND from_node_id NOT GLOB '*[^0-9a-f]*'),
    target_kind            TEXT NOT NULL CHECK(length(target_kind) BETWEEN 1 AND 128),
    target_identity        TEXT NOT NULL CHECK(length(target_identity) BETWEEN 1 AND 2048),
    state                  TEXT NOT NULL CHECK(state IN ('proposed', 'approved', 'rejected', 'stale')),
    proposed_at            TEXT NOT NULL,
    decided_at             TEXT
);
CREATE INDEX idx_knowledge_mapping_proposals_review
    ON knowledge_mapping_proposals(project_environment_id, state, proposed_at DESC);

CREATE TRIGGER knowledge_graph_revisions_reject_update
BEFORE UPDATE ON knowledge_graph_revisions
BEGIN
    SELECT RAISE(ABORT, 'knowledge graph revisions are immutable');
END;

CREATE TRIGGER knowledge_graph_revisions_reject_delete_active
BEFORE DELETE ON knowledge_graph_revisions
WHEN EXISTS (
    SELECT 1 FROM knowledge_environment_heads
    WHERE graph_revision_id = OLD.graph_revision_id
)
BEGIN
    SELECT RAISE(ABORT, 'active knowledge graph revision cannot be deleted');
END;
"#;

/// Current application schema, executed once for a new store.
pub const SCHEMA: &str = r#"
CREATE TABLE workspaces (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL,       -- personal|team
    lifecycle_state TEXT NOT NULL,       -- active|archived|deleted
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE workspace_members (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    user_id      TEXT,                   -- NULL for the offline local owner
    display_name TEXT NOT NULL,
    role         TEXT NOT NULL,
    status       TEXT NOT NULL,
    joined_at    TEXT NOT NULL
);
CREATE INDEX idx_workspace_members_workspace
    ON workspace_members(workspace_id, status);
CREATE INDEX idx_workspace_members_user_status
    ON workspace_members(user_id, status, workspace_id);
CREATE UNIQUE INDEX idx_workspace_members_remote_identity
    ON workspace_members(workspace_id, user_id)
    WHERE user_id IS NOT NULL;

-- Non-secret account index for the unified account/workspace switcher. Better Auth
-- Bearer tokens stay in per-account OS credential-store entries and never enter SQLite.
CREATE TABLE workspace_accounts (
    user_id           TEXT PRIMARY KEY,
    email             TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    last_workspace_id TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    last_used_at      TEXT NOT NULL
);
CREATE INDEX idx_workspace_accounts_last_used
    ON workspace_accounts(last_used_at DESC);

CREATE TABLE app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO workspaces
    (id, name, kind, lifecycle_state, created_at, updated_at)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Personal Workspace', 'personal', 'active',
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO workspace_members
    (id, workspace_id, user_id, display_name, role, status, joined_at)
VALUES
    ('00000000-0000-0000-0000-000000000002',
     '00000000-0000-0000-0000-000000000001', NULL, 'Local owner', 'owner', 'active',
     CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('active_workspace_id', '00000000-0000-0000-0000-000000000001');
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('active_scope_generation', '0');

CREATE TABLE connections (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    engine            TEXT NOT NULL,
    provider          TEXT NOT NULL DEFAULT 'auto', -- control-plane overlay
    driver_id         TEXT,                          -- NULL = registry recommendation
    host              TEXT NOT NULL,
    port              INTEGER NOT NULL
                      CHECK(typeof(port) = 'integer' AND port BETWEEN 0 AND 65535),
    db_name           TEXT NOT NULL,
    username          TEXT NOT NULL,
    sslmode           TEXT NOT NULL,
    extra_params      TEXT NOT NULL DEFAULT '{}'
                      CHECK(json_valid(extra_params) AND json_type(extra_params) = 'object'),
    secret_ref        TEXT,                          -- credential-store item id, NOT the password
    readonly_default  INTEGER NOT NULL DEFAULT 1,
    allow_writes      INTEGER NOT NULL DEFAULT 0,
    env               TEXT,                          -- dev|staging|prod label (optional)
    schema_group      TEXT,                          -- groups dev|staging|prod siblings for schema diff
    workspace_id      TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                      REFERENCES workspaces(id),
    account_user_id   TEXT,                          -- owner of a team-local resource
    remote_id         TEXT,
    revision          INTEGER NOT NULL DEFAULT 1,
    sync_status       TEXT NOT NULL DEFAULT 'local', -- local|dirty|synced|conflict
    workspace_access  TEXT NOT NULL DEFAULT 'local', -- view|read|write|manage|local
    credential_mode   TEXT NOT NULL DEFAULT 'local', -- local|member_local|managed
    provider_target   TEXT
                      CHECK(provider_target IS NULL OR
                        (json_valid(provider_target) AND json_type(provider_target) = 'object')),
    deleted_at        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

-- Per-account local overlay for a redacted shared connection template. The secret
-- value itself stays in the OS credential store; this table stores only its opaque
-- credential-item id, member-local fields, and the last server-verified RBAC view.
CREATE TABLE workspace_connection_bindings (
    connection_id  TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    account_user_id TEXT NOT NULL,
    username       TEXT NOT NULL DEFAULT '',
    extra_params   TEXT NOT NULL DEFAULT '{}'
                   CHECK(json_valid(extra_params) AND json_type(extra_params) = 'object'),
    secret_ref     TEXT,
    workspace_access TEXT NOT NULL DEFAULT 'view',
    allow_writes   INTEGER NOT NULL DEFAULT 0,
    revision       INTEGER NOT NULL DEFAULT 1,
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (connection_id, account_user_id)
);
CREATE INDEX idx_workspace_connection_bindings_account
    ON workspace_connection_bindings(account_user_id, connection_id);

CREATE TABLE connection_safety (
    connection_id         TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    allow_writes          INTEGER NOT NULL DEFAULT 0,
    allow_schema_changes  INTEGER NOT NULL DEFAULT 0,
    wrap_writes_in_tx     INTEGER NOT NULL DEFAULT 1,
    explain_preview       INTEGER NOT NULL DEFAULT 1,
    auto_run_reads        INTEGER NOT NULL DEFAULT 1,
    max_rows              INTEGER NOT NULL DEFAULT 1000,
    exec_preview_row_limit INTEGER NOT NULL DEFAULT 50000
);

CREATE TABLE query_history (
    id            TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    account_scope TEXT NOT NULL DEFAULT 'personal', -- personal or authenticated account id
    sql           TEXT NOT NULL,
    kind          TEXT NOT NULL,
    status        TEXT NOT NULL,           -- ok|error|blocked
    row_count     INTEGER,
    duration_ms   INTEGER,
    error         TEXT,
    executed_at   TEXT NOT NULL,
    origin        TEXT NOT NULL            -- agent|manual|analysis_article|surface id
);
CREATE INDEX idx_history_scope_recent
    ON query_history(connection_id, account_scope, executed_at DESC);

CREATE TABLE query_service_sessions (
    workspace_id  TEXT NOT NULL,
    account_scope TEXT NOT NULL,
    id            TEXT NOT NULL,
    connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    updated_at    INTEGER NOT NULL,
    status        TEXT NOT NULL CHECK(status IN ('completed', 'failed', 'cancelled')),
    snapshot_json TEXT NOT NULL,
    PRIMARY KEY (workspace_id, account_scope, id)
);
CREATE INDEX idx_query_service_sessions_scope_updated
    ON query_service_sessions(workspace_id, account_scope, updated_at DESC);

-- Append-only, hash-chained compliance log. Rows are never updated or deleted;
-- `verify_chain` recomputes hashes to make post-hoc edits evident (tamper-EVIDENT,
-- not tamper-proof — anyone with write access to this file could rebuild the chain).
-- Deliberately NO foreign key: audit rows must SURVIVE connection deletion (a deleted
-- connection must not erase its compliance history).
CREATE TABLE audit_log (
    id                TEXT PRIMARY KEY,
    connection_id     TEXT NOT NULL,
    ts                TEXT NOT NULL,
    engine            TEXT NOT NULL,
    agent_prompt      TEXT,
    sql               TEXT NOT NULL,
    kind              TEXT NOT NULL,
    action            TEXT NOT NULL,       -- propose|approve|reject|execute|blocked
    approved_by       TEXT,
    affected_estimate INTEGER,
    error             TEXT,
    prev_hash         TEXT,
    hash              TEXT NOT NULL
);
CREATE INDEX idx_audit_conn ON audit_log(connection_id, ts);
CREATE INDEX idx_audit_connection_row ON audit_log(connection_id);

-- Durable Operation Runtime projection. Target connection/workspace rows are
-- intentionally not foreign keys: deleting or archiving a resource must not erase
-- the provenance of an already planned or executed operation.
CREATE TABLE operations (
    id                       TEXT PRIMARY KEY,
    runtime_id               TEXT NOT NULL,
    workspace_id             TEXT NOT NULL,
    account_scope            TEXT NOT NULL,
    connection_id            TEXT NOT NULL,
    connection_revision      INTEGER NOT NULL,
    terminal_session_id      TEXT,
    actor_kind               TEXT NOT NULL
                             CHECK(actor_kind IN (
                                 'local_user', 'workspace_user', 'agent', 'plugin', 'system'
                             )),
    actor_id                 TEXT NOT NULL CHECK(actor_id <> ''),
    actor_provenance_json    TEXT NOT NULL CHECK(json_valid(actor_provenance_json)),
    operation_kind           TEXT NOT NULL
                             CHECK(operation_kind IN (
                                 'read_query', 'document_read', 'write_sql', 'ddl',
                                 'privilege', 'sql_script', 'table_data_change',
                                 'schema_change', 'import', 'export',
                                 'plugin_action', 'provider_action'
                             )),
    payload_schema_version   INTEGER NOT NULL CHECK(payload_schema_version > 0),
    payload_json             TEXT NOT NULL CHECK(json_valid(payload_json)),
    payload_hash             TEXT NOT NULL
                             CHECK(length(payload_hash) = 64
                               AND payload_hash NOT GLOB '*[^0-9a-f]*'),
    schema_fingerprint       TEXT
                             CHECK(schema_fingerprint IS NULL OR (
                                 length(schema_fingerprint) = 64
                                 AND schema_fingerprint NOT GLOB '*[^0-9a-f]*'
                             )),
    risk_level               TEXT NOT NULL
                             CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
    preview_json             TEXT NOT NULL CHECK(json_valid(preview_json)),
    policy_snapshot_json     TEXT NOT NULL CHECK(json_valid(policy_snapshot_json)),
    policy_revision          TEXT NOT NULL CHECK(policy_revision <> ''),
    state                    TEXT NOT NULL
                             CHECK(state IN (
                                 'planned', 'pending_approval', 'ready', 'approved',
                                 'rejected', 'expired', 'cancelled', 'executing',
                                 'succeeded', 'failed', 'outcome_unknown'
                             )),
    single_use               INTEGER NOT NULL CHECK(single_use IN (0, 1)),
    idempotency_key          TEXT NOT NULL CHECK(idempotency_key <> ''),
    expires_at               TEXT,
    started_at               TEXT,
    finished_at              TEXT,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_operations_idempotency
    ON operations(workspace_id, actor_kind, actor_id, idempotency_key);
CREATE INDEX idx_operations_state_expiry
    ON operations(state, expires_at);
CREATE INDEX idx_operations_connection_created
    ON operations(connection_id, created_at DESC);
CREATE INDEX idx_operations_runtime_state
    ON operations(runtime_id, state);

-- Every field that gives an operation its meaning is immutable. `runtime_id` is
-- deliberately excluded: a durable queued/resumable job may CAS-rebind only its
-- process-local owner after restart while its payload hash and approval stay fixed.
-- Recreate the trigger on open so installations made before job recovery support
-- receive the corrected invariant as well.
CREATE TRIGGER operations_reject_immutable_update
BEFORE UPDATE ON operations
WHEN OLD.workspace_id IS NOT NEW.workspace_id
  OR OLD.account_scope IS NOT NEW.account_scope
  OR OLD.connection_id IS NOT NEW.connection_id
  OR OLD.connection_revision IS NOT NEW.connection_revision
  OR OLD.terminal_session_id IS NOT NEW.terminal_session_id
  OR OLD.actor_kind IS NOT NEW.actor_kind
  OR OLD.actor_id IS NOT NEW.actor_id
  OR OLD.actor_provenance_json IS NOT NEW.actor_provenance_json
  OR OLD.operation_kind IS NOT NEW.operation_kind
  OR OLD.payload_schema_version IS NOT NEW.payload_schema_version
  OR OLD.payload_json IS NOT NEW.payload_json
  OR OLD.payload_hash IS NOT NEW.payload_hash
  OR OLD.schema_fingerprint IS NOT NEW.schema_fingerprint
  OR OLD.risk_level IS NOT NEW.risk_level
  OR OLD.preview_json IS NOT NEW.preview_json
  OR OLD.policy_snapshot_json IS NOT NEW.policy_snapshot_json
  OR OLD.policy_revision IS NOT NEW.policy_revision
  OR OLD.single_use IS NOT NEW.single_use
  OR OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.expires_at IS NOT NEW.expires_at
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
    SELECT RAISE(ABORT, 'operation immutable fields cannot be changed');
END;

CREATE TRIGGER operations_reject_delete
BEFORE DELETE ON operations
BEGIN
    SELECT RAISE(ABORT, 'operation provenance cannot be deleted');
END;

CREATE TABLE operation_approvals (
    id                TEXT PRIMARY KEY,
    operation_id      TEXT NOT NULL REFERENCES operations(id),
    payload_hash      TEXT NOT NULL
                      CHECK(length(payload_hash) = 64
                        AND payload_hash NOT GLOB '*[^0-9a-f]*'),
    approver_kind     TEXT NOT NULL CHECK(approver_kind IN ('local_user', 'workspace_user')),
    approver_id       TEXT NOT NULL CHECK(approver_id <> ''),
    decision          TEXT NOT NULL CHECK(decision IN ('approved', 'rejected')),
    reason            TEXT,
    policy_revision   TEXT NOT NULL CHECK(policy_revision <> ''),
    created_at        TEXT NOT NULL,
    expires_at        TEXT
);
CREATE INDEX idx_operation_approvals_operation_created
    ON operation_approvals(operation_id, created_at);

CREATE TRIGGER operation_approvals_reject_update
BEFORE UPDATE ON operation_approvals
BEGIN
    SELECT RAISE(ABORT, 'operation approvals are append-only');
END;

CREATE TRIGGER operation_approvals_reject_delete
BEFORE DELETE ON operation_approvals
BEGIN
    SELECT RAISE(ABORT, 'operation approvals are append-only');
END;

-- Per-operation append-only lifecycle ledger. `sequence` and `prev_hash` make a
-- missing/reordered row detectable without changing the existing compliance chain.
CREATE TABLE operation_events (
    id             TEXT PRIMARY KEY,
    operation_id   TEXT NOT NULL REFERENCES operations(id),
    sequence       INTEGER NOT NULL CHECK(sequence > 0),
    event_kind     TEXT NOT NULL
                   CHECK(event_kind IN (
                       'proposed', 'planned', 'approval_requested', 'approved',
                       'rejected', 'execution_started', 'progress', 'succeeded',
                       'failed', 'cancelled', 'outcome_unknown', 'expired'
                   )),
    state          TEXT NOT NULL
                   CHECK(state IN (
                       'planned', 'pending_approval', 'ready', 'approved',
                       'rejected', 'expired', 'cancelled', 'executing',
                       'succeeded', 'failed', 'outcome_unknown'
                   )),
    event_json     TEXT NOT NULL CHECK(json_valid(event_json)),
    created_at     TEXT NOT NULL,
    prev_hash      TEXT
                   CHECK(prev_hash IS NULL OR (
                       length(prev_hash) = 64
                       AND prev_hash NOT GLOB '*[^0-9a-f]*'
                   )),
    hash           TEXT NOT NULL
                   CHECK(length(hash) = 64
                     AND hash NOT GLOB '*[^0-9a-f]*'),
    UNIQUE(operation_id, sequence)
);
CREATE INDEX idx_operation_events_operation_sequence
    ON operation_events(operation_id, sequence);

CREATE TRIGGER operation_events_reject_update
BEFORE UPDATE ON operation_events
BEGIN
    SELECT RAISE(ABORT, 'operation events are append-only');
END;

CREATE TRIGGER operation_events_reject_delete
BEFORE DELETE ON operation_events
BEGIN
    SELECT RAISE(ABORT, 'operation events are append-only');
END;

CREATE TABLE snippets (
    id            TEXT PRIMARY KEY,
    connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    sql           TEXT NOT NULL,
    tags          TEXT NOT NULL DEFAULT '[]',   -- JSON array
    workspace_id  TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES workspaces(id),
    remote_id     TEXT,
    revision      INTEGER NOT NULL DEFAULT 1,
    sync_status   TEXT NOT NULL DEFAULT 'local',
    deleted_at    TEXT,
    updated_at    TEXT NOT NULL
);

-- Persistent SQL workbench documents. `local_revision` is the optimistic-lock
-- token used by autosave; remote revision fields are reserved for hosted sync.
CREATE TABLE sql_documents (
    id                TEXT PRIMARY KEY,
    workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_scope     TEXT NOT NULL,
    connection_id     TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    dialect           TEXT NOT NULL,
    selected_database TEXT NOT NULL,
    selected_schema   TEXT,
    resolve_mode      TEXT NOT NULL DEFAULT 'playground'
                      CHECK(resolve_mode IN ('playground', 'script')),
    content           TEXT NOT NULL,
    local_revision    INTEGER NOT NULL CHECK(local_revision > 0),
    remote_id         TEXT,
    remote_revision   INTEGER,
    dirty             INTEGER NOT NULL DEFAULT 1 CHECK(dirty IN (0, 1)),
    sync_status       TEXT NOT NULL DEFAULT 'local'
                      CHECK(sync_status IN ('local', 'dirty', 'synced', 'conflict')),
    deleted_at        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX idx_sql_documents_scope_updated
    ON sql_documents(workspace_id, account_scope, connection_id, updated_at DESC)
    WHERE deleted_at IS NULL;

-- A bounded revision journal makes a committed autosave recoverable even if the
-- current row is later conflicted or the renderer crashes while switching documents.
CREATE TABLE sql_document_revisions (
    document_id    TEXT NOT NULL REFERENCES sql_documents(id) ON DELETE CASCADE,
    local_revision INTEGER NOT NULL CHECK(local_revision > 0),
    content_hash   TEXT NOT NULL
                   CHECK(length(content_hash) = 64
                     AND content_hash NOT GLOB '*[^0-9a-f]*'),
    content        TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    PRIMARY KEY (document_id, local_revision)
);
CREATE INDEX idx_sql_document_revisions_recent
    ON sql_document_revisions(document_id, local_revision DESC);

-- Local recovery for privacy-minimized Analysis Article query results. The
-- content is authenticated-encrypted with a device key held by the OS credential
-- store; only authority metadata, nonce, ciphertext, and retention timestamps are
-- representable here. This table never participates in workspace sync.
CREATE TABLE analysis_article_local_results (
    workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_scope    TEXT NOT NULL CHECK(account_scope <> ''),
    article_id       TEXT NOT NULL,
    article_revision INTEGER NOT NULL CHECK(article_revision > 0),
    run_id           TEXT NOT NULL,
    result_hash      TEXT NOT NULL
                     CHECK(length(result_hash) = 64
                       AND result_hash NOT GLOB '*[^0-9a-f]*'),
    nonce            BLOB NOT NULL CHECK(length(nonce) = 24),
    ciphertext       BLOB NOT NULL
                     CHECK(length(ciphertext) > 16 AND length(ciphertext) <= 17825792),
    created_at       TEXT NOT NULL,
    expires_at       TEXT NOT NULL,
    PRIMARY KEY (workspace_id, account_scope, article_id, run_id)
);
CREATE INDEX idx_analysis_article_local_result_latest
    ON analysis_article_local_results(
        workspace_id, account_scope, article_id, created_at DESC
    );
CREATE INDEX idx_analysis_article_local_result_expiry
    ON analysis_article_local_results(expires_at);

-- Hosted pull checkpoints are account-scoped. Two accounts in the same team
-- workspace can have different grants and must never share a cursor merely because
-- they share the local SQLite file.
CREATE TABLE workspace_sync_state (
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_scope TEXT NOT NULL CHECK(account_scope <> ''),
    pull_cursor   INTEGER NOT NULL CHECK(pull_cursor >= 0),
    last_pulled_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, account_scope)
);

-- Security-scoped canonical catalog cache.
CREATE TABLE catalog_cache (
    workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_scope         TEXT NOT NULL,
    connection_id         TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    connection_revision   INTEGER NOT NULL,
    binding_revision      INTEGER NOT NULL,
    binding_updated_at    TEXT NOT NULL DEFAULT '',
    catalog_schema_version INTEGER NOT NULL,
    fingerprint           TEXT NOT NULL,
    captured_at           TEXT NOT NULL,
    catalog_json          TEXT NOT NULL,
    PRIMARY KEY (workspace_id, account_scope, connection_id)
);

-- ERD layouts keep physical metadata immutable and store only presentation state
-- plus workspace-scoped virtual relationships.
CREATE TABLE erd_layouts (
    id                  TEXT PRIMARY KEY,
    workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_scope       TEXT NOT NULL,
    connection_id       TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    mode                TEXT NOT NULL CHECK(mode IN ('physical', 'logical', 'uml')),
    catalog_fingerprint TEXT NOT NULL
                        CHECK(length(catalog_fingerprint) = 64
                          AND catalog_fingerprint NOT GLOB '*[^0-9a-f]*'),
    layout_json         TEXT NOT NULL CHECK(json_valid(layout_json)),
    virtual_relations_json TEXT NOT NULL DEFAULT '[]'
                           CHECK(json_valid(virtual_relations_json)),
    revision            INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    remote_id           TEXT,
    remote_revision     INTEGER,
    sync_status         TEXT NOT NULL DEFAULT 'local'
                        CHECK(sync_status IN ('local', 'dirty', 'synced', 'conflict')),
    deleted_at          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
CREATE INDEX idx_erd_layouts_scope_updated
    ON erd_layouts(workspace_id, account_scope, connection_id, updated_at DESC)
    WHERE deleted_at IS NULL;

-- Durable import/export scheduler projection. Plans are immutable and hash pinned;
-- mutable state is constrained to lifecycle/progress fields.
CREATE TABLE jobs (
    id                   TEXT PRIMARY KEY,
    operation_id         TEXT NOT NULL UNIQUE REFERENCES operations(id),
    workspace_id         TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_scope        TEXT NOT NULL,
    connection_id        TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    kind                 TEXT NOT NULL CHECK(kind IN ('import', 'export')),
    format               TEXT NOT NULL
                         CHECK(format IN (
                           'csv', 'tsv', 'json', 'ndjson', 'sql', 'xlsx',
                           'csv_gzip', 'json_gzip', 'ndjson_gzip', 'sql_gzip'
                         )),
    plan_json            TEXT NOT NULL CHECK(json_valid(plan_json)),
    plan_hash            TEXT NOT NULL
                         CHECK(length(plan_hash) = 64
                           AND plan_hash NOT GLOB '*[^0-9a-f]*'),
    state                TEXT NOT NULL
                         CHECK(state IN (
                           'queued', 'running', 'paused', 'cancel_requested',
                           'cancelled', 'succeeded', 'failed'
                         )),
    source_summary       TEXT NOT NULL,
    target_summary       TEXT NOT NULL,
    rows_processed       INTEGER NOT NULL DEFAULT 0 CHECK(rows_processed >= 0),
    bytes_processed      INTEGER NOT NULL DEFAULT 0 CHECK(bytes_processed >= 0),
    rows_total           INTEGER,
    bytes_total          INTEGER,
    resumable            INTEGER NOT NULL DEFAULT 0 CHECK(resumable IN (0, 1)),
    pause_requested      INTEGER NOT NULL DEFAULT 0 CHECK(pause_requested IN (0, 1)),
    error_code           TEXT,
    redacted_error       TEXT,
    created_at           TEXT NOT NULL,
    started_at           TEXT,
    finished_at          TEXT,
    updated_at           TEXT NOT NULL
);
CREATE INDEX idx_jobs_scope_created
    ON jobs(workspace_id, account_scope, connection_id, created_at DESC);
CREATE INDEX idx_jobs_state_created
    ON jobs(state, created_at);

-- Scope, approved plan, and source/target summaries never change after insertion.
-- Mutable lifecycle/progress fields remain available to the scheduler.
CREATE TRIGGER jobs_reject_immutable_update
BEFORE UPDATE ON jobs
WHEN OLD.operation_id IS NOT NEW.operation_id
  OR OLD.workspace_id IS NOT NEW.workspace_id
  OR OLD.account_scope IS NOT NEW.account_scope
  OR OLD.connection_id IS NOT NEW.connection_id
  OR OLD.kind IS NOT NEW.kind
  OR OLD.format IS NOT NEW.format
  OR OLD.plan_json IS NOT NEW.plan_json
  OR OLD.plan_hash IS NOT NEW.plan_hash
  OR OLD.source_summary IS NOT NEW.source_summary
  OR OLD.target_summary IS NOT NEW.target_summary
  OR OLD.resumable IS NOT NEW.resumable
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
    SELECT RAISE(ABORT, 'job immutable fields cannot be changed');
END;

-- Native file selections become opaque, scope-bound capabilities. Plans persist
-- only the random capability id; renderer processes never receive a local path.
CREATE TABLE job_file_capabilities (
    id                 TEXT PRIMARY KEY,
    workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_scope      TEXT NOT NULL,
    connection_id      TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    direction          TEXT NOT NULL CHECK(direction IN ('input', 'output')),
    local_path         TEXT NOT NULL,
    display_name       TEXT NOT NULL,
    size_bytes         INTEGER,
    modified_at        TEXT,
    source_sha256      TEXT,
    claimed_by_job_id  TEXT UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
    expires_at         TEXT NOT NULL,
    revoked_at         TEXT,
    created_at         TEXT NOT NULL
);
CREATE INDEX idx_job_file_capabilities_scope
    ON job_file_capabilities(workspace_id, account_scope, connection_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TRIGGER job_file_capabilities_reject_immutable_update
BEFORE UPDATE ON job_file_capabilities
WHEN OLD.workspace_id IS NOT NEW.workspace_id
  OR OLD.account_scope IS NOT NEW.account_scope
  OR OLD.connection_id IS NOT NEW.connection_id
  OR OLD.direction IS NOT NEW.direction
  OR OLD.local_path IS NOT NEW.local_path
  OR OLD.display_name IS NOT NEW.display_name
  OR OLD.size_bytes IS NOT NEW.size_bytes
  OR OLD.modified_at IS NOT NEW.modified_at
  OR OLD.source_sha256 IS NOT NEW.source_sha256
  OR OLD.expires_at IS NOT NEW.expires_at
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
    SELECT RAISE(ABORT, 'job file capability immutable fields cannot be changed');
END;

CREATE TABLE job_checkpoints (
    job_id               TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sequence             INTEGER NOT NULL CHECK(sequence > 0),
    source_fingerprint   TEXT NOT NULL,
    target_fingerprint   TEXT NOT NULL,
    checkpoint_json      TEXT NOT NULL CHECK(json_valid(checkpoint_json)),
    created_at           TEXT NOT NULL,
    PRIMARY KEY (job_id, sequence)
);

CREATE TABLE job_events (
    id          TEXT PRIMARY KEY,
    job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sequence    INTEGER NOT NULL CHECK(sequence > 0),
    event_kind  TEXT NOT NULL
                CHECK(event_kind IN (
                  'queued', 'started', 'progress', 'warning', 'paused',
                  'resumed', 'succeeded', 'failed', 'cancelled'
                )),
    event_json  TEXT NOT NULL CHECK(json_valid(event_json)),
    created_at  TEXT NOT NULL,
    UNIQUE(job_id, sequence)
);
CREATE INDEX idx_job_events_job_sequence
    ON job_events(job_id, sequence);

CREATE TRIGGER job_events_reject_update
BEFORE UPDATE ON job_events
BEGIN
    SELECT RAISE(ABORT, 'job events are append-only');
END;

CREATE TRIGGER job_events_reject_delete
BEFORE DELETE ON job_events
BEGIN
    SELECT RAISE(ABORT, 'job events are append-only');
END;

CREATE TABLE job_artifacts (
    id              TEXT PRIMARY KEY,
    job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    artifact_type   TEXT NOT NULL
                    CHECK(artifact_type IN (
                      'output', 'error_rows', 'rejected_rows', 'log', 'partial'
                    )),
    local_path      TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL CHECK(size_bytes >= 0),
    sha256          TEXT NOT NULL
                    CHECK(length(sha256) = 64
                      AND sha256 NOT GLOB '*[^0-9a-f]*'),
    retention_state TEXT NOT NULL DEFAULT 'retained'
                    CHECK(retention_state IN ('retained', 'expired', 'deleted')),
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_job_artifacts_job
    ON job_artifacts(job_id, created_at);

-- Current ACP conversations. Authentication and provider credentials are never
-- stored here: `acp_session_id` is only the official adapter's opaque resume
-- identity. Events are bounded projections used to restore the observation and
-- approval surface after an app restart.
CREATE TABLE agent_acp_sessions (
    id             TEXT PRIMARY KEY,
    connection_id  TEXT NOT NULL,
    workspace_id   TEXT NOT NULL,
    account_scope  TEXT NOT NULL,
    provider       TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
    title          TEXT NOT NULL,
    lifecycle      TEXT NOT NULL CHECK(lifecycle IN (
                       'starting', 'ready', 'running', 'waiting_permission',
                       'failed', 'closed'
                   )),
    acp_session_id TEXT,
    knowledge_scopes TEXT NOT NULL DEFAULT '[]',
    write_connection_id TEXT,
    error          TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX idx_agent_acp_sessions_scope
    ON agent_acp_sessions(workspace_id, account_scope, updated_at DESC);

CREATE TABLE agent_acp_events (
    session_id  TEXT NOT NULL REFERENCES agent_acp_sessions(id) ON DELETE CASCADE,
    sequence    INTEGER NOT NULL CHECK(sequence > 0),
    created_at  TEXT NOT NULL,
    payload     TEXT NOT NULL CHECK(length(payload) <= 524288),
    PRIMARY KEY(session_id, sequence)
);
CREATE INDEX idx_agent_acp_events_session
    ON agent_acp_events(session_id, sequence);

-- Provider API credentials are intentionally local-only. `keyring_ref` is an
-- opaque UUID naming an OS Keychain/Credential Manager entry; no token,
-- refresh credential, endpoint, or provider response is ever persisted here
-- or queued for synchronization. A tombstone survives a failed OS-store delete
-- so retry can be explicit without resurrecting provider access.
CREATE TABLE workspace_provider_bindings (
    binding_id           TEXT PRIMARY KEY,
    workspace_id         TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_user_id      TEXT NOT NULL,
    provider             TEXT NOT NULL CHECK(provider IN ('neon', 'gcp_cloud_sql', 'planetscale')),
    integration_id       TEXT NOT NULL,
    integration_generation TEXT NOT NULL CHECK(integration_generation <> ''),
    keyring_ref          TEXT,
    principal_redacted   TEXT NOT NULL DEFAULT '',
    scope_fingerprint    TEXT NOT NULL,
    verified_at          TEXT,
    revision             INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    tombstoned_at        TEXT,
    delete_pending       INTEGER NOT NULL DEFAULT 0 CHECK(delete_pending IN (0, 1)),
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    UNIQUE(workspace_id, account_user_id, provider, integration_id)
);
CREATE INDEX idx_workspace_provider_bindings_scope
    ON workspace_provider_bindings(workspace_id, account_user_id, tombstoned_at);

-- Durable, secret-free work queue for exact OS credential-store deletion.
-- A row is inserted in the same SQLite transaction that tombstones a binding
-- or replaces its keyring pointer, so a failed OS-store call cannot restore
-- access or lose the identity needed to retry after restart.
CREATE TABLE workspace_provider_credential_cleanup (
    workspace_id           TEXT NOT NULL,
    account_user_id        TEXT NOT NULL,
    provider               TEXT NOT NULL CHECK(provider IN ('neon', 'gcp_cloud_sql', 'planetscale')),
    integration_id         TEXT NOT NULL,
    integration_generation TEXT NOT NULL CHECK(integration_generation <> ''),
    binding_id             TEXT NOT NULL,
    keyring_ref            TEXT NOT NULL,
    created_at             TEXT NOT NULL,
    PRIMARY KEY (
        workspace_id, account_user_id, provider, integration_id,
        integration_generation, keyring_ref
    )
);
CREATE INDEX idx_workspace_provider_credential_cleanup_scope
    ON workspace_provider_credential_cleanup(workspace_id, account_user_id, created_at);

-- Secret-free checkpoint for the provider-neutral Managed Access provisioning
-- lifecycle. Provider tokens, database passwords, CLI stdout/stderr, and raw
-- Provider responses have no representable column. Immutable target ownership is
-- separated from the mutable operation/plan used for an explicitly approved
-- apply, repair, or destroy attempt.
CREATE TABLE provider_provisioning_receipts (
    receipt_id          TEXT PRIMARY KEY,
    workspace_id        TEXT NOT NULL,
    account_scope       TEXT NOT NULL CHECK(account_scope <> ''),
    connection_id       TEXT NOT NULL,
    operation_id        TEXT NOT NULL,
    provider            TEXT NOT NULL CHECK(provider IN ('neon', 'gcp_cloud_sql', 'planetscale')),
    target_fingerprint  TEXT NOT NULL
                        CHECK(length(target_fingerprint) = 64
                          AND target_fingerprint NOT GLOB '*[^0-9a-f]*'),
    plan_hash           TEXT NOT NULL
                        CHECK(length(plan_hash) = 64
                          AND plan_hash NOT GLOB '*[^0-9a-f]*'),
    idempotency_key     TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
    ownership_marker    TEXT NOT NULL CHECK(ownership_marker <> ''),
    state               TEXT NOT NULL CHECK(state IN (
                            'needs_setup', 'ready_to_apply', 'applying', 'verifying',
                            'ready', 'needs_repair', 'destroying'
                        )),
    phase               TEXT NOT NULL CHECK(phase IN (
                            'detect', 'discover', 'plan', 'approve', 'apply',
                            'verify', 'issue', 'reconcile', 'destroy'
                        )),
    completed_steps     INTEGER NOT NULL CHECK(completed_steps BETWEEN 0 AND 64),
    revision            INTEGER NOT NULL CHECK(revision > 0),
    snapshot_json       TEXT NOT NULL
                        CHECK(json_valid(snapshot_json) AND length(snapshot_json) <= 65536),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE(workspace_id, account_scope, provider, target_fingerprint)
);
CREATE INDEX idx_provider_provisioning_scope_updated
    ON provider_provisioning_receipts(workspace_id, account_scope, updated_at DESC);
CREATE INDEX idx_provider_provisioning_state
    ON provider_provisioning_receipts(state, updated_at);

CREATE TRIGGER provider_provisioning_reject_target_rewrite
BEFORE UPDATE ON provider_provisioning_receipts
WHEN OLD.workspace_id IS NOT NEW.workspace_id
  OR OLD.account_scope IS NOT NEW.account_scope
  OR OLD.connection_id IS NOT NEW.connection_id
  OR OLD.provider IS NOT NEW.provider
  OR OLD.target_fingerprint IS NOT NEW.target_fingerprint
  OR OLD.ownership_marker IS NOT NEW.ownership_marker
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
    SELECT RAISE(ABORT, 'provider provisioning target ownership cannot be changed');
END;
"#;
