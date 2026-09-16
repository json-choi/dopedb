//! End-to-end suite for the built `dopedb-cli` and `dopedb-agent-bridge`
//! binaries, driven against an isolated fake Broker over a Unix socket. No
//! installed Desktop, account, credential, or real database is touched.
//!
//! # The two `platform` branches are deliberately asymmetric
//!
//! Both branches are reached through the same single test name, but they do
//! not cover the same ground, so a green Windows job is not evidence for the
//! Unix journeys.
//!
//! The `#[cfg(unix)]` branch is the real suite. It boots a fake Broker on a
//! Unix socket and runs the actual binaries as child processes across every
//! journey named in `stage(..)` below: typed MCP tool surface, direct-Broker
//! catalog search, single-call plan/run, request cancellation, ACP launcher
//! argv/env pinning, external-Agent config bootstrap and session revocation,
//! and the `schema_diff` journeys (refusal exit codes with no partial output,
//! snapshot identity, fingerprint-bound paging).
//!
//! The `#[cfg(windows)]` branch covers only the launcher security boundary,
//! in-process: that the registration bearer is taken out of the environment
//! exactly once, and that `adapter_command` pins the verified launcher argv
//! and env and refuses a changed runtime digest. It spawns no Broker, no
//! socket, and no child process. Everything else above is unverified there,
//! which is why `windows-check` is not a substitute for the Unix job.

use std::panic::{catch_unwind, AssertUnwindSafe};

/// Upper bound for every "wait for the fixture to make progress" timeout in
/// this suite: waiting for a child process to reach the Broker, to exit after
/// cancellation, or to open its socket connection.
///
/// These are liveness bounds, never performance assertions -- the suite
/// asserts *that* the bridge reaches the Broker, never how fast. The default
/// is therefore deliberately generous so that a loaded CI runner cannot be
/// mistaken for a regression; a genuine hang never completes and still fails,
/// just later. Override with `DOPEDB_E2E_TIMEOUT_SECS` (whole seconds, must be
/// greater than zero) to tighten it locally or loosen it on a slow runner.
#[cfg(unix)]
const DEFAULT_E2E_TIMEOUT_SECS: u64 = 30;

#[cfg(unix)]
fn e2e_timeout() -> std::time::Duration {
    let seconds = std::env::var("DOPEDB_E2E_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|seconds| *seconds > 0)
        .unwrap_or(DEFAULT_E2E_TIMEOUT_SECS);
    std::time::Duration::from_secs(seconds)
}

/// Runs one named journey, so a panic or timeout inside it reports which
/// journey broke instead of only a bare line number.
///
/// The label is printed before the journey starts, so the captured output the
/// harness replays for a failing test ends with the journey that broke or
/// hung. It is also folded into the panic message, which the harness prints
/// after the original panic has already reported its own file and line.
fn stage<T>(label: &str, journey: impl FnOnce() -> T) -> T {
    eprintln!("--- e2e stage: {label}");
    match catch_unwind(AssertUnwindSafe(journey)) {
        Ok(value) => value,
        Err(payload) => {
            let detail = payload
                .downcast_ref::<&'static str>()
                .map(|text| (*text).to_owned())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic payload was not a string".to_owned());
            panic!("e2e stage `{label}` failed: {detail}");
        }
    }
}

#[cfg(unix)]
#[path = "support/schema_diff.rs"]
mod schema_diff;

#[cfg(unix)]
mod platform {

    use std::ffi::OsString;
    use std::fs;
    use std::io::{Read, Write};
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration as StdDuration, Instant};

    use chrono::{Duration, Utc};
    use dopedb_protocol::{
        decode_frame, encode_frame, parse_frame_length, AcpPluginId, AgentSessionRegisterArguments,
        CatalogArguments, CatalogContents, CatalogSearchArguments, CatalogSearchMatch,
        CatalogSearchMatchType, CatalogSearchResult, CatalogSnapshot, Column, CommandName,
        ConnectionSelector, DatabaseEngine, EmptyArguments, ErrorCode, ExternalAgentConfig,
        ExternalAgentConfigCreateArguments, ExternalAgentConfigCreateResult, ExternalAgentProvider,
        ExternalAgentResourceScope, ExternalAgentSessionStartArguments,
        ExternalAgentSessionStartResult, NormalizedTypeFamily, ObjectKind, ObjectRef,
        ProtocolError, QueryHealth, QueryPlanArguments, QueryPlanResult, QueryResultPage,
        QueryRunArguments, QueryRunResult, Relation, RequestEnvelope, ResponseEnvelope,
        RuntimeDiscovery, SchemaListResult, SchemaSummary, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
        PROTOCOL_MAX, PROTOCOL_MIN,
    };
    use sha2::{Digest, Sha256};
    use tempfile::TempDir;

    use uuid::Uuid;

    fn read_request(stream: &mut UnixStream) -> RequestEnvelope {
        let mut prefix = [0u8; 4];
        stream.read_exact(&mut prefix).unwrap();
        let length = parse_frame_length(prefix, MAX_REQUEST_BYTES).unwrap();
        let mut frame = Vec::from(prefix);
        frame.resize(4 + length, 0);
        stream.read_exact(&mut frame[4..]).unwrap();
        decode_frame(&frame, MAX_REQUEST_BYTES).unwrap()
    }

    fn respond<T: serde::Serialize>(
        stream: &mut UnixStream,
        request: &RequestEnvelope,
        result: &T,
    ) {
        let response = ResponseEnvelope::success(
            request.protocol_version,
            request.request_id,
            serde_json::to_value(result).unwrap(),
        );
        stream
            .write_all(&encode_frame(&response, MAX_RESPONSE_BYTES).unwrap())
            .unwrap();
    }

    fn respond_retryable_authority_refresh(stream: &mut UnixStream, request: &RequestEnvelope) {
        let response = ResponseEnvelope::failure(
            request.protocol_version,
            request.request_id,
            ProtocolError::new(ErrorCode::RuntimeUnavailable, true),
        );
        stream
            .write_all(&encode_frame(&response, MAX_RESPONSE_BYTES).unwrap())
            .unwrap();
    }

    fn respond_invalid_request(stream: &mut UnixStream, request: &RequestEnvelope) {
        let response = ResponseEnvelope::failure(
            request.protocol_version,
            request.request_id,
            ProtocolError::new(ErrorCode::InvalidRequest, false),
        );
        stream
            .write_all(&encode_frame(&response, MAX_RESPONSE_BYTES).unwrap())
            .unwrap();
    }

    fn process_bound_agent_command(runtime_file: &std::path::Path, session_id: Uuid) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_dopedb-agent-bridge"));
        command
            .env("DOPEDB_RUNTIME_FILE", runtime_file)
            .env("DOPEDB_TERMINAL_SESSION_ID", session_id.to_string())
            .env("DOPEDB_CONNECTION_SCOPE", Uuid::from_u128(7).to_string())
            .env("DOPEDB_AGENT_PROCESS_BOUND", "1")
            .env_remove("DOPEDB_SESSION_TOKEN")
            .env(
                "DATABASE_URL",
                "postgresql://fixture:must-never-escape@example.invalid/app",
            );
        command
    }

    fn agent_bridge_messages(
        runtime_file: &std::path::Path,
        session_id: Uuid,
        messages: &[serde_json::Value],
    ) -> Vec<serde_json::Value> {
        let mut child = process_bound_agent_command(runtime_file, session_id)
            .arg("mcp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut input = child.stdin.take().unwrap();
        for message in messages {
            serde_json::to_writer(&mut input, message).unwrap();
            input.write_all(b"\n").unwrap();
        }
        drop(input);
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        assert!(output.stderr.is_empty());
        String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn users_catalog(connection_id: Uuid) -> CatalogSnapshot {
        CatalogSnapshot::capture(
            connection_id,
            DatabaseEngine::Postgres,
            "app",
            Utc::now(),
            CatalogContents {
                relations: vec![Relation {
                    object: ObjectRef {
                        catalog: Some("app".into()),
                        namespace: Some("public".into()),
                        name: "users".into(),
                        kind: ObjectKind::Table,
                        native_id: None,
                    },
                    comment: Some("Application user accounts".into()),
                    row_estimate: Some(42),
                    partition_parent: None,
                    partition_children: Vec::new(),
                    columns: vec![
                        Column {
                            name: "id".into(),
                            ordinal: 1,
                            native_type: "bigint".into(),
                            type_family: NormalizedTypeFamily::Integer,
                            length: None,
                            precision: None,
                            scale: None,
                            nullable: false,
                            default_expression: None,
                            generated_expression: None,
                            identity: true,
                            auto_increment: true,
                            collation: None,
                            comment: None,
                            sensitivity: None,
                        },
                        Column {
                            name: "deleted_at".into(),
                            ordinal: 2,
                            native_type: "timestamp with time zone".into(),
                            type_family: NormalizedTypeFamily::Timestamp,
                            length: None,
                            precision: None,
                            scale: None,
                            nullable: true,
                            default_expression: None,
                            generated_expression: None,
                            identity: false,
                            auto_increment: false,
                            collation: None,
                            comment: Some("Soft deletion timestamp".into()),
                            sensitivity: None,
                        },
                    ],
                    constraints: Vec::new(),
                    indexes: Vec::new(),
                }],
                ..CatalogContents::default()
            },
        )
        .unwrap()
    }

    /// Long-lived fixture shared by every journey below: the temporary runtime
    /// directory, the fake Broker socket, and the identifiers the fake Broker and
    /// the assertions agree on.
    struct BrokerFixture {
        temp: TempDir,
        runtime_directory: PathBuf,
        endpoint: PathBuf,
        runtime_file: PathBuf,
        session_id: Uuid,
        connection_id: Uuid,
        plan_id: Uuid,
        sql: &'static str,
        proposal_definition: serde_json::Value,
    }

    /// State the external-Agent bootstrap journey hands to the journeys that
    /// start, refuse to overwrite, and refuse to follow a symlink to it.
    struct ExternalAgentFixture {
        runtime_file: PathBuf,
        endpoint: PathBuf,
        project_directory: PathBuf,
        config_path: PathBuf,
        config: ExternalAgentConfig,
        session_id: Uuid,
    }

    /// The fake provider-CLI directory and the `PATH` that selects it.
    struct ProviderPath {
        fake_bin: PathBuf,
        test_path: OsString,
    }

    fn response_by_id(bridge: &[serde_json::Value], id: i64) -> &serde_json::Value {
        bridge
            .iter()
            .find(|message| message["id"] == id)
            .expect("every MCP request must receive one response")
    }

    pub(super) fn run() {
        let (fixture, server, cancel_started_rx) =
            crate::stage("broker-fixture", bind_broker_fixture);
        let bridge = crate::stage("typed-bridge-exchange", || typed_bridge_exchange(&fixture));
        crate::stage("mcp-tool-surface", || assert_tool_surface(&bridge));
        crate::stage("catalog-search-and-query-run", || {
            assert_catalog_and_query_results(&bridge, &fixture)
        });
        crate::stage("mcp-request-cancellation", || {
            cancellation_journey(&fixture, server, cancel_started_rx)
        });
        crate::stage("acp-launcher-argv-env-pinning", || {
            launcher_journey(&fixture)
        });
        let (external, external_server) = crate::stage("external-agent-config-bootstrap", || {
            external_agent_bootstrap(&fixture)
        });
        let provider = crate::stage("external-agent-start-codex", || {
            external_agent_start_codex(&fixture, &external, external_server)
        });
        crate::stage("external-agent-init-overwrite-refusal", || {
            external_agent_init_refuses_overwrite(&external)
        });
        crate::stage("external-agent-start-claude", || {
            external_agent_start_claude(&fixture, &external, &provider)
        });
        crate::stage("external-agent-symlinked-config-refusal", || {
            external_agent_start_refuses_symlinked_config(&external)
        });
    }

    /// Binds the fake Broker socket and spawns the thread that answers the typed
    /// bridge journey, including the cancelled request it must leave open.
    fn bind_broker_fixture() -> (BrokerFixture, thread::JoinHandle<()>, mpsc::Receiver<()>) {
        let temp = TempDir::new().unwrap();
        let runtime_directory = temp.path().join("runtime");
        fs::create_dir(&runtime_directory).unwrap();
        fs::set_permissions(&runtime_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let runtime_id = Uuid::from_u128(1);
        let runtime_id_text = runtime_id.simple().to_string();
        let endpoint = runtime_directory.join(format!("broker-{}.sock", &runtime_id_text[..16]));
        let listener = UnixListener::bind(&endpoint).unwrap();
        fs::set_permissions(&endpoint, fs::Permissions::from_mode(0o600)).unwrap();
        let runtime_file = runtime_directory.join("runtime.json");
        let discovery = RuntimeDiscovery::new(
            runtime_id,
            std::process::id(),
            "0.3.3",
            PROTOCOL_MIN,
            PROTOCOL_MAX,
            endpoint.to_string_lossy(),
            Utc::now(),
        )
        .unwrap();
        fs::write(&runtime_file, serde_json::to_vec(&discovery).unwrap()).unwrap();
        fs::set_permissions(&runtime_file, fs::Permissions::from_mode(0o600)).unwrap();

        let session_id = Uuid::from_u128(2);
        let connection_id = Uuid::from_u128(7);
        let plan_id = Uuid::from_u128(8);
        let query_run_id = Uuid::from_u128(9);
        let sql = "SELECT COUNT(*) AS total_users FROM public.users";
        let contracts: serde_json::Value = serde_json::from_str(include_str!(
            "../../dopedb-protocol/tests/fixtures/control-plane-contracts-v1.json"
        ))
        .unwrap();
        let stored_definition = &contracts["analysisArticleCreate"]["definition"];
        let proposal_definition = serde_json::json!({
            "version": 3,
            "title": stored_definition["title"],
            "html": stored_definition["html"],
            "query": stored_definition["query"],
        });
        let (cancel_started_tx, cancel_started_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            let mut catalog_searches = 0;
            let mut authority_retry_sent = false;
            for _ in 0..7 {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                let authentication = request.authentication.as_ref().unwrap();
                assert_eq!(authentication.terminal_session_id, session_id);
                assert!(authentication.token().is_none());
                assert!(serde_json::to_value(authentication)
                    .unwrap()
                    .get("token")
                    .is_none());
                match request.command {
                    CommandName::SchemaList => {
                        if !authority_retry_sent {
                            authority_retry_sent = true;
                            respond_retryable_authority_refresh(&mut stream, &request);
                            continue;
                        }
                        let arguments: CatalogArguments =
                            serde_json::from_value(request.arguments.clone()).unwrap();
                        assert_eq!(arguments.connection, ConnectionSelector::Current);
                        assert_eq!(arguments.database.as_deref(), Some("app"));
                        respond(
                            &mut stream,
                            &request,
                            &SchemaListResult {
                                connection_id,
                                database: "app".into(),
                                schemas: vec![SchemaSummary {
                                    name: "public".into(),
                                    relation_count: 1,
                                    routine_count: 0,
                                    object_count: 1,
                                }],
                            },
                        );
                    }
                    CommandName::CatalogSearch => {
                        catalog_searches += 1;
                        let arguments: CatalogSearchArguments =
                            serde_json::from_value(request.arguments.clone()).unwrap();
                        assert_eq!(arguments.connection, ConnectionSelector::Current);
                        assert_eq!(arguments.database.as_deref(), Some("app"));
                        assert_eq!(arguments.kinds, vec![ObjectKind::Table]);
                        if catalog_searches == 1 {
                            assert_eq!(arguments.query, "user");
                            assert_eq!(arguments.limit, Some(20));
                        } else {
                            assert_eq!(catalog_searches, 2);
                            assert_eq!(arguments.query, "*");
                            assert_eq!(arguments.limit, Some(50));
                        }
                        let catalog = users_catalog(connection_id);
                        respond(
                            &mut stream,
                            &request,
                            &CatalogSearchResult {
                                connection_id,
                                engine: catalog.engine(),
                                database: catalog.database().into(),
                                captured_at: catalog.captured_at(),
                                fingerprint: catalog.fingerprint().into(),
                                query: arguments.query,
                                total_matches: 1,
                                truncated: false,
                                matches: vec![CatalogSearchMatch {
                                    match_type: CatalogSearchMatchType::Relation,
                                    qualified_name: "app.public.users".into(),
                                    object: catalog.relations()[0].object.clone(),
                                    matched_fields: if catalog_searches == 1 {
                                        vec!["deleted_at".into()]
                                    } else {
                                        Vec::new()
                                    },
                                }],
                            },
                        );
                    }
                    CommandName::QueryPlan => {
                        let arguments: QueryPlanArguments =
                            serde_json::from_value(request.arguments.clone()).unwrap();
                        assert_eq!(arguments.connection, ConnectionSelector::Current);
                        assert_eq!(arguments.database.as_deref(), Some("app"));
                        assert_eq!(arguments.sql, sql);
                        respond(
                            &mut stream,
                            &request,
                            &QueryPlanResult {
                                connection_id,
                                connection_name: "fixture".into(),
                                database: "app".into(),
                                environment: Some("test".into()),
                                plan_id,
                                decision: "ready".into(),
                                notices: Vec::new(),
                                suggestions: Vec::new(),
                                estimated_rows: Some(1),
                                health: QueryHealth {
                                    level: "healthy".into(),
                                    coverage: "full".into(),
                                    total_connections: None,
                                    max_connections: None,
                                    connection_usage_percent: None,
                                    active_queries: None,
                                    long_running_queries: None,
                                    lock_waits: None,
                                    replication_lag_seconds: None,
                                    reasons: Vec::new(),
                                    captured_at: Utc::now(),
                                },
                                expires_at: Utc::now() + Duration::minutes(5),
                            },
                        );
                    }
                    CommandName::QueryRun => {
                        let arguments: QueryRunArguments =
                            serde_json::from_value(request.arguments.clone()).unwrap();
                        assert_eq!(arguments.plan_id, plan_id);
                        respond(
                            &mut stream,
                            &request,
                            &QueryRunResult {
                                connection_id,
                                connection_name: "fixture".into(),
                                database: "app".into(),
                                plan_id,
                                query_run_id,
                                planning_decision: "ready".into(),
                                result: QueryResultPage {
                                    columns: vec!["total_users".into()],
                                    rows: vec![vec![serde_json::json!(42)]],
                                    decode_failures: Vec::new(),
                                    row_count: 1,
                                    truncated: false,
                                    duration_ms: 1,
                                },
                            },
                        );
                    }
                    CommandName::AnalysisArticlePropose => {
                        respond_invalid_request(&mut stream, &request);
                    }
                    _ => unreachable!(),
                }
            }
            assert!(authority_retry_sent);

            let (mut stream, _) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert_eq!(request.command, CommandName::CatalogSearch);
            let arguments: CatalogSearchArguments =
                serde_json::from_value(request.arguments.clone()).unwrap();
            assert_eq!(arguments.connection, ConnectionSelector::Current);
            assert_eq!(arguments.database.as_deref(), Some("app"));
            assert_eq!(arguments.query, "users");
            cancel_started_tx.send(()).unwrap();

            let mut byte = [0u8; 1];
            match stream.read(&mut byte) {
                Ok(0) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::UnexpectedEof
                    ) => {}
                result => panic!("cancelled Broker request remained open: {result:?}"),
            }
        });

        (
            BrokerFixture {
                temp,
                runtime_directory,
                endpoint,
                runtime_file,
                session_id,
                connection_id,
                plan_id,
                sql,
                proposal_definition,
            },
            server,
            cancel_started_rx,
        )
    }

    /// Drives one process-bound bridge through the whole typed MCP exchange.
    fn typed_bridge_exchange(fixture: &BrokerFixture) -> Vec<serde_json::Value> {
        let runtime_file = fixture.runtime_file.clone();
        let session_id = fixture.session_id;
        let connection_id = fixture.connection_id;
        let sql = fixture.sql;
        let proposal_definition = fixture.proposal_definition.clone();

        agent_bridge_messages(
            &runtime_file,
            session_id,
            &[
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": { "protocolVersion": "2025-11-25" }
                }),
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized"
                }),
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/list",
                    "params": {}
                }),
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": { "name": "schema_list", "arguments": { "database": "app" } }
                }),
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 4,
                    "method": "tools/call",
                    "params": {
                        "name": "catalog_search",
                        "arguments": { "database": "app", "query": "user", "kinds": ["table"] }
                    }
                }),
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 5,
                    "method": "tools/call",
                    "params": {
                        "name": "catalog_search",
                        "arguments": { "database": "app", "query": "", "kinds": ["table"], "limit": 500 }
                    }
                }),
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 6,
                    "method": "tools/call",
                    "params": {
                        "name": "query_read",
                        "arguments": { "database": "app", "sql": sql }
                    }
                }),
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 7,
                    "method": "tools/call",
                    "params": {
                        "name": "analysis_article_propose",
                        "arguments": {
                            "connectionId": connection_id,
                            "definition": proposal_definition
                        }
                    }
                }),
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 8,
                    "method": "tools/call",
                    "params": {
                        "name": "knowledge_search",
                        "arguments": { "query": "users" }
                    }
                }),
            ],
        )
    }

    /// The advertised tool surface: which tools exist, their schema bounds, and
    /// the ones that must never be advertised.
    fn assert_tool_surface(bridge: &[serde_json::Value]) {
        let response = |id: i64| response_by_id(bridge, id);
        assert_eq!(bridge.len(), 8);
        assert_eq!(response(1)["result"]["serverInfo"]["name"], "dopedb");
        let instructions = response(1)["result"]["instructions"].as_str().unwrap();
        assert!(instructions.contains("partial result"));
        assert!(instructions.contains("EVIDENCE ROUTING"));
        let tools = response(2)["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|tool| tool["name"] == "catalog_search"));
        assert!(tools.iter().any(|tool| tool["name"] == "query_read"));
        assert!(tools.iter().any(|tool| tool["name"] == "source_search"));
        assert!(tools.iter().any(|tool| tool["name"] == "source_read"));
        let article_guide = tools
            .iter()
            .find(|tool| tool["name"] == "analysis_article_guide")
            .unwrap();
        assert_eq!(article_guide["annotations"]["readOnlyHint"], true);
        assert_eq!(article_guide["inputSchema"]["additionalProperties"], false);
        assert!(!tools.iter().any(|tool| {
            tool["name"]
                .as_str()
                .is_some_and(|name| name.starts_with("knowledge_") || name == "funnel_trace")
        }));
        let query_read_tool = tools
            .iter()
            .find(|tool| tool["name"] == "query_read")
            .unwrap();
        assert_eq!(
            query_read_tool["inputSchema"]["properties"]["timeoutMs"]["maximum"],
            300_000,
        );
        assert!(query_read_tool["description"]
            .as_str()
            .unwrap()
            .contains("establish that meaning from pinned source first"));
        let catalog_search_tool = tools
            .iter()
            .find(|tool| tool["name"] == "catalog_search")
            .unwrap();
        assert!(catalog_search_tool["inputSchema"].get("required").is_none());
        assert_eq!(
            catalog_search_tool["inputSchema"]["properties"]["limit"]["maximum"],
            50,
        );
        assert!(catalog_search_tool["description"]
            .as_str()
            .unwrap()
            .contains("Omit query"));
        let article_tool = tools
            .iter()
            .find(|tool| tool["name"] == "analysis_article_propose")
            .expect("the app-managed MCP bridge must expose Analysis Article proposals");
        assert_eq!(article_tool["annotations"]["destructiveHint"], false);
        assert_eq!(article_tool["annotations"]["idempotentHint"], false);
        assert_eq!(article_tool["inputSchema"]["additionalProperties"], false);
        assert!(article_tool["inputSchema"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|property| property == "connectionId"));
        assert_eq!(
            article_tool["inputSchema"]["properties"]["definition"]["properties"]["version"]
                ["const"],
            3,
        );
        assert_eq!(
            article_tool["inputSchema"]["properties"]["definition"]["properties"]["html"]
                ["maxLength"],
            250_000,
        );
        assert_eq!(
            article_tool["inputSchema"]["properties"]["definition"]["required"],
            serde_json::json!(["version", "title", "html", "query"]),
        );
        let query_schema =
            &article_tool["inputSchema"]["properties"]["definition"]["properties"]["query"];
        assert!(query_schema["properties"].get("parameterIds").is_none());
        assert!(query_schema["properties"].get("cacheTtlSeconds").is_none());
        assert!(article_tool["description"]
            .as_str()
            .unwrap()
            .contains("sanitized HTML"));
        let update_tool = tools
            .iter()
            .find(|tool| tool["name"] == "analysis_article_update")
            .expect("the app-managed MCP bridge must expose exact Article updates");
        assert_eq!(update_tool["inputSchema"]["additionalProperties"], false);
        assert_eq!(
            update_tool["inputSchema"]["properties"]["expectedRevision"]["minimum"],
            1,
        );
        assert!(update_tool["description"]
            .as_str()
            .unwrap()
            .contains("cross-resource"));
        let verify_tool = tools
            .iter()
            .find(|tool| tool["name"] == "analysis_article_verify")
            .expect("the app-managed MCP bridge must expose bounded Article verification");
        assert_eq!(verify_tool["annotations"]["readOnlyHint"], true);
        assert!(verify_tool["inputSchema"]["properties"]
            .get("parameterValues")
            .is_none());
        for name in ["operation_status", "operation_wait", "operation_cancel"] {
            let tool = tools.iter().find(|tool| tool["name"] == name).unwrap();
            assert_eq!(
                tool["inputSchema"]["properties"]["connectionId"]["format"],
                "uuid",
            );
        }
        assert!(!tools.iter().any(|tool| tool["name"] == "run"));
    }

    /// Catalog search, the single-call plan/run, the refused Article proposal, and
    /// the rule that no fixture secret may appear in any response.
    fn assert_catalog_and_query_results(bridge: &[serde_json::Value], fixture: &BrokerFixture) {
        let plan_id = fixture.plan_id;
        let response = |id: i64| response_by_id(bridge, id);

        assert_eq!(response(3)["result"]["isError"], false);
        assert_eq!(
            response(3)["result"]["structuredContent"]["schemas"][0]["name"],
            "public"
        );
        assert_eq!(response(4)["result"]["isError"], false);
        assert_eq!(
            response(4)["result"]["structuredContent"]["matches"][0]["qualifiedName"],
            "app.public.users"
        );
        assert_eq!(
            response(4)["result"]["structuredContent"]["matches"][0]["matchedFields"][0],
            "deleted_at"
        );
        assert!(response(4)["result"]["structuredContent"]["matches"][0]
            .get("relation")
            .is_none());
        assert_eq!(response(5)["result"]["isError"], false);
        assert_eq!(response(5)["result"]["structuredContent"]["query"], "*");
        assert_eq!(
            response(5)["result"]["structuredContent"]["matches"][0]["qualifiedName"],
            "app.public.users"
        );

        assert_eq!(response(6)["result"]["isError"], false);
        assert_eq!(
            response(6)["result"]["structuredContent"]["plan"]["planId"],
            plan_id.to_string()
        );
        assert_eq!(
            response(6)["result"]["structuredContent"]["run"]["result"]["rows"][0][0],
            42
        );
        assert_eq!(response(7)["result"]["isError"], true);
        assert!(response(7)["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("sanitized HTML and exactly one bounded read-only query"));
        assert_eq!(response(8)["result"]["isError"], true);
        assert!(response(8)["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("knowledge graph tools are unavailable"));
        let serialized = serde_json::to_string(&bridge).unwrap();
        assert!(!serialized.contains("must-never-escape"));
    }

    /// A cancelled in-flight call must close the Broker request and stop the
    /// bridge without leaking the fixture secret.
    fn cancellation_journey(
        fixture: &BrokerFixture,
        server: thread::JoinHandle<()>,
        cancel_started_rx: mpsc::Receiver<()>,
    ) {
        let runtime_file = fixture.runtime_file.clone();
        let session_id = fixture.session_id;

        let mut cancellable = process_bound_agent_command(&runtime_file, session_id)
            .arg("mcp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut input = cancellable.stdin.take().unwrap();
        for message in [
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 10,
                "method": "initialize",
                "params": { "protocolVersion": "2025-11-25" }
            }),
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 11,
                "method": "tools/call",
                "params": {
                    "name": "catalog_search",
                    "arguments": { "database": "app", "query": "users" }
                }
            }),
        ] {
            serde_json::to_writer(&mut input, &message).unwrap();
            input.write_all(b"\n").unwrap();
        }
        input.flush().unwrap();
        cancel_started_rx
            .recv_timeout(crate::e2e_timeout())
            .expect("catalog search must reach the Broker before cancellation");
        serde_json::to_writer(
            &mut input,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "method": "notifications/cancelled",
                "params": { "requestId": 11, "reason": "user cancelled" }
            }),
        )
        .unwrap();
        input.write_all(b"\n").unwrap();
        input.flush().unwrap();
        drop(input);

        let deadline = Instant::now() + crate::e2e_timeout();
        let status = loop {
            if let Some(status) = cancellable.try_wait().unwrap() {
                break status;
            }
            if Instant::now() >= deadline {
                cancellable.kill().unwrap();
                cancellable.wait().unwrap();
                panic!("the MCP bridge did not stop after its active call was cancelled");
            }
            thread::sleep(StdDuration::from_millis(10));
        };
        assert!(status.success());
        let mut stdout = String::new();
        cancellable
            .stdout
            .take()
            .unwrap()
            .read_to_string(&mut stdout)
            .unwrap();
        let mut stderr = String::new();
        cancellable
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut stderr)
            .unwrap();
        assert!(stderr.is_empty());
        let responses = stdout
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(responses.len(), 2);
        assert!(responses.iter().any(|response| response["id"] == 10));
        let cancelled = responses
            .iter()
            .find(|response| response["id"] == 11)
            .expect("a cancelled MCP request must terminate with an error response");
        assert_eq!(cancelled["error"]["code"], -32800);
        assert!(!stdout.contains("must-never-escape"));

        server.join().unwrap();
    }

    /// The token-bearing launcher path: exact argv, injected provider CLI path,
    /// and the parent-process environment that must not reach the adapter.
    fn launcher_journey(fixture: &BrokerFixture) {
        let temp = &fixture.temp;
        let endpoint = fixture.endpoint.clone();
        let runtime_directory = fixture.runtime_directory.clone();

        // Exercise the token-bearing launcher path in the same critical journey so
        // the fixed test budget does not grow. The fake executable stands in for
        // bundled Node and records only its adapter argument and injected CLI path.
        fs::remove_file(&endpoint).unwrap();
        let launcher_runtime_directory = runtime_directory;
        let launcher_runtime_id = Uuid::from_u128(11);
        let launcher_runtime_id_text = launcher_runtime_id.simple().to_string();
        let launcher_endpoint = launcher_runtime_directory
            .join(format!("broker-{}.sock", &launcher_runtime_id_text[..16]));
        let launcher_listener = UnixListener::bind(&launcher_endpoint).unwrap();
        fs::set_permissions(&launcher_endpoint, fs::Permissions::from_mode(0o600)).unwrap();
        let launcher_runtime_file = launcher_runtime_directory.join("runtime.json");
        let launcher_discovery = RuntimeDiscovery::new(
            launcher_runtime_id,
            std::process::id(),
            env!("CARGO_PKG_VERSION"),
            PROTOCOL_MIN,
            PROTOCOL_MAX,
            launcher_endpoint.to_string_lossy(),
            Utc::now(),
        )
        .unwrap();
        fs::write(
            &launcher_runtime_file,
            serde_json::to_vec(&launcher_discovery).unwrap(),
        )
        .unwrap();
        fs::set_permissions(&launcher_runtime_file, fs::Permissions::from_mode(0o600)).unwrap();

        let launcher_target = temp.path().join("verified-node-target");
        fs::write(
        &launcher_target,
        b"#!/bin/sh\nif env | grep -Eq '^(DOPEDB_SESSION_TOKEN|DOPEDB_TEST_PARENT_HOOK|DOPEDB_TEST_SECRET)='; then exit 91; fi\nprintf '%s\\n%s\\n%s\\n%s\\n' \"$1\" \"$CODEX_PATH\" \"$DOPEDB_TERMINAL_SESSION_ID\" \"$HOME\"\n",
    )
    .unwrap();
        fs::set_permissions(&launcher_target, fs::Permissions::from_mode(0o700)).unwrap();
        let launcher = temp.path().join("verified-node");
        symlink(&launcher_target, &launcher).unwrap();
        let launcher_resolved = fs::canonicalize(&launcher).unwrap();
        let launcher_sha256 = hex::encode(Sha256::digest(fs::read(&launcher_resolved).unwrap()));
        let adapter = temp.path().join("codex-adapter.js");
        fs::write(&adapter, b"verified adapter fixture").unwrap();
        let adapter = fs::canonicalize(adapter).unwrap();
        let adapter_sha256 = hex::encode(Sha256::digest(fs::read(&adapter).unwrap()));
        let provider_cli = temp.path().join("codex");
        fs::write(&provider_cli, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&provider_cli, fs::Permissions::from_mode(0o700)).unwrap();
        let provider_cli_resolved = fs::canonicalize(&provider_cli).unwrap();
        let provider_cli_sha256 =
            hex::encode(Sha256::digest(fs::read(&provider_cli_resolved).unwrap()));
        let launcher_session_id = Uuid::from_u128(12);
        let expected_launcher = launcher.to_string_lossy().into_owned();
        let expected_resolved_launcher = launcher_resolved.to_string_lossy().into_owned();
        let expected_sha256 = launcher_sha256.clone();
        let expected_adapter = adapter.to_string_lossy().into_owned();
        let expected_adapter_sha256 = adapter_sha256.clone();
        let expected_provider_cli = provider_cli.to_string_lossy().into_owned();
        let expected_provider_cli_resolved = provider_cli_resolved.to_string_lossy().into_owned();
        let expected_provider_cli_sha256 = provider_cli_sha256.clone();
        let launcher_server = thread::spawn(move || {
            let (mut stream, _) = launcher_listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert_eq!(request.command, CommandName::AgentSessionRegister);
            let authentication = request.authentication.as_ref().unwrap();
            assert_eq!(authentication.terminal_session_id, launcher_session_id);
            assert_eq!(authentication.token(), Some("cd".repeat(32).as_str()));
            let arguments: AgentSessionRegisterArguments =
                serde_json::from_value(request.arguments.clone()).unwrap();
            assert_eq!(arguments.plugin_id, AcpPluginId::Codex);
            assert_eq!(arguments.adapter_bundle_version, "1.0.0");
            assert_eq!(arguments.runtime_executable, expected_launcher);
            assert_eq!(
                arguments.runtime_resolved_executable,
                expected_resolved_launcher
            );
            assert_eq!(arguments.runtime_sha256, expected_sha256);
            assert_eq!(arguments.adapter_entrypoint, expected_adapter);
            assert_eq!(arguments.adapter_entrypoint_sha256, expected_adapter_sha256);
            assert_eq!(arguments.provider_cli_executable, expected_provider_cli);
            assert_eq!(
                arguments.provider_cli_resolved_executable,
                expected_provider_cli_resolved
            );
            assert_eq!(arguments.provider_cli_sha256, expected_provider_cli_sha256);
            respond(&mut stream, &request, &EmptyArguments::default());
        });

        let launcher_status = Command::new(env!("CARGO_BIN_EXE_dopedb-agent-bridge"))
            .args([
                "launch",
                AcpPluginId::Codex.as_str(),
                "1.0.0",
                launcher.to_str().unwrap(),
                launcher_resolved.to_str().unwrap(),
                launcher_sha256.as_str(),
                adapter.to_str().unwrap(),
                adapter_sha256.as_str(),
                provider_cli.to_str().unwrap(),
                provider_cli_resolved.to_str().unwrap(),
                provider_cli_sha256.as_str(),
            ])
            .env("DOPEDB_RUNTIME_FILE", &launcher_runtime_file)
            .env(
                "DOPEDB_TERMINAL_SESSION_ID",
                launcher_session_id.to_string(),
            )
            .env("DOPEDB_SESSION_TOKEN", "cd".repeat(32))
            .env("DOPEDB_TEST_PARENT_HOOK", "stale-terminal-session")
            .env("DOPEDB_TEST_SECRET", "unrelated-parent-credential")
            .env("HOME", temp.path())
            .output()
            .unwrap();
        assert!(launcher_status.status.success());
        launcher_server.join().unwrap();
        let inherited = String::from_utf8(launcher_status.stdout).unwrap();
        assert_eq!(
            inherited.lines().collect::<Vec<_>>(),
            [
                adapter.to_string_lossy().as_ref(),
                provider_cli.to_string_lossy().as_ref(),
                launcher_session_id.to_string().as_str(),
                temp.path().to_string_lossy().as_ref(),
            ]
        );
    }

    /// `dopedb agent init` writes a secret-free, checked-in config.
    fn external_agent_bootstrap(
        fixture: &BrokerFixture,
    ) -> (ExternalAgentFixture, thread::JoinHandle<()>) {
        let temp = &fixture.temp;

        // Exercise the public external-Agent bootstrap in this same critical
        // journey: config is secret-free, provider MCP settings contain no bearer,
        // and the exact process-bound session is revoked after the provider exits.
        let agent_runtime_directory = temp.path().join("agent-runtime");
        fs::create_dir(&agent_runtime_directory).unwrap();
        fs::set_permissions(&agent_runtime_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let agent_runtime_id = Uuid::from_u128(13);
        let agent_runtime_id_text = agent_runtime_id.simple().to_string();
        let agent_endpoint =
            agent_runtime_directory.join(format!("broker-{}.sock", &agent_runtime_id_text[..16]));
        let agent_listener = UnixListener::bind(&agent_endpoint).unwrap();
        fs::set_permissions(&agent_endpoint, fs::Permissions::from_mode(0o600)).unwrap();
        let agent_runtime_file = agent_runtime_directory.join("runtime.json");
        let agent_discovery = RuntimeDiscovery::new(
            agent_runtime_id,
            std::process::id(),
            env!("CARGO_PKG_VERSION"),
            PROTOCOL_MIN,
            PROTOCOL_MAX,
            agent_endpoint.to_string_lossy(),
            Utc::now(),
        )
        .unwrap();
        fs::write(
            &agent_runtime_file,
            serde_json::to_vec(&agent_discovery).unwrap(),
        )
        .unwrap();
        fs::set_permissions(&agent_runtime_file, fs::Permissions::from_mode(0o600)).unwrap();

        let agent_project_directory = temp.path().join("external-project");
        fs::create_dir(&agent_project_directory).unwrap();
        let agent_project_directory = fs::canonicalize(agent_project_directory).unwrap();
        let agent_project_id = Uuid::from_u128(14);
        let agent_environment_id = Uuid::from_u128(15);
        let agent_connection_id = Uuid::from_u128(16);
        let external_session_id = Uuid::from_u128(17);
        let external_config = ExternalAgentConfig {
            schema_version: 1,
            provider: ExternalAgentProvider::Codex,
            project_id: agent_project_id,
            anchor_connection_id: agent_connection_id,
            resource_scopes: vec![ExternalAgentResourceScope {
                project_environment_id: agent_environment_id,
                authority_connection_id: agent_connection_id,
                connection_ids: vec![agent_connection_id],
                source_ids: Vec::new(),
            }],
            write_connection_id: None,
        };
        let expected_external_config = external_config.clone();
        let expected_working_directory = agent_project_directory.to_string_lossy().into_owned();
        let external_server = thread::spawn(move || {
            let (mut stream, _) = agent_listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert_eq!(request.command, CommandName::ExternalAgentConfigCreate);
            assert!(request.authentication.is_none());
            let arguments: ExternalAgentConfigCreateArguments =
                serde_json::from_value(request.arguments.clone()).unwrap();
            assert_eq!(arguments.provider, ExternalAgentProvider::Codex);
            assert_eq!(arguments.working_directory, expected_working_directory);
            respond(
                &mut stream,
                &request,
                &ExternalAgentConfigCreateResult {
                    config: expected_external_config.clone(),
                },
            );

            let (mut stream, _) = agent_listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert_eq!(request.command, CommandName::ExternalAgentSessionStart);
            assert!(request.authentication.is_none());
            let arguments: ExternalAgentSessionStartArguments =
                serde_json::from_value(request.arguments.clone()).unwrap();
            assert_eq!(arguments.config, expected_external_config);
            assert_eq!(arguments.working_directory, expected_working_directory);
            respond(
                &mut stream,
                &request,
                &ExternalAgentSessionStartResult {
                    terminal_session_id: external_session_id,
                    expires_at: Utc::now() + Duration::minutes(15),
                },
            );

            let (mut stream, _) = agent_listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert_eq!(request.command, CommandName::ExternalAgentSessionRevoke);
            let authentication = request.authentication.as_ref().unwrap();
            assert_eq!(authentication.terminal_session_id, external_session_id);
            assert!(authentication.token().is_none());
            respond(&mut stream, &request, &EmptyArguments::default());
        });

        let init = Command::new(env!("CARGO_BIN_EXE_dopedb-cli"))
            .args(["agent", "init", "--provider", "codex", "--json"])
            .current_dir(&agent_project_directory)
            .env("DOPEDB_RUNTIME_FILE", &agent_runtime_file)
            .output()
            .unwrap();
        assert!(
            init.status.success(),
            "{}",
            String::from_utf8_lossy(&init.stderr)
        );
        let init_output: serde_json::Value = serde_json::from_slice(&init.stdout).unwrap();
        assert_eq!(init_output["provider"], "codex");
        assert_eq!(init_output["resourceCount"], 1);
        let config_path = agent_project_directory.join(".dopedb/agent.json");
        let config_bytes = fs::read(&config_path).unwrap();
        let saved_config: ExternalAgentConfig = serde_json::from_slice(&config_bytes).unwrap();
        assert_eq!(saved_config, external_config);
        let config_text = String::from_utf8(config_bytes)
            .unwrap()
            .to_ascii_lowercase();
        for forbidden in ["password", "token", "credential", "connectionurl"] {
            assert!(!config_text.contains(forbidden));
        }

        (
            ExternalAgentFixture {
                runtime_file: agent_runtime_file,
                endpoint: agent_endpoint,
                project_directory: agent_project_directory,
                config_path,
                config: external_config,
                session_id: external_session_id,
            },
            external_server,
        )
    }

    /// `dopedb agent start` launches the user's own Codex CLI inside the exact
    /// process-bound session and revokes it when the provider exits.
    fn external_agent_start_codex(
        fixture: &BrokerFixture,
        external: &ExternalAgentFixture,
        external_server: thread::JoinHandle<()>,
    ) -> ProviderPath {
        let temp = &fixture.temp;
        let agent_project_directory = external.project_directory.clone();
        let agent_runtime_file = external.runtime_file.clone();
        let external_session_id = external.session_id;

        let fake_bin = temp.path().join("external-agent-bin");
        fs::create_dir(&fake_bin).unwrap();
        let fake_codex = fake_bin.join("codex");
        fs::write(
        &fake_codex,
        b"#!/bin/sh\nif env | grep -q '^DOPEDB_SESSION_TOKEN='; then exit 91; fi\nprintf '%s\\n%s\\n%s\\n' \"$DOPEDB_RUNTIME_FILE\" \"$DOPEDB_TERMINAL_SESSION_ID\" \"$DOPEDB_AGENT_PROCESS_BOUND\" > \"$DOPEDB_TEST_EXTERNAL_OUTPUT\"\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\" >> \"$DOPEDB_TEST_EXTERNAL_OUTPUT\"; done\n",
    )
    .unwrap();
        fs::set_permissions(&fake_codex, fs::Permissions::from_mode(0o700)).unwrap();
        let external_output = temp.path().join("external-agent-output.txt");
        let mut test_paths = vec![fake_bin.clone()];
        test_paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        let test_path = std::env::join_paths(test_paths).unwrap();
        let start = Command::new(env!("CARGO_BIN_EXE_dopedb-cli"))
            .args(["agent", "start", "--", "exec", "fixture prompt"])
            .current_dir(&agent_project_directory)
            .env("PATH", &test_path)
            .env("DOPEDB_RUNTIME_FILE", &agent_runtime_file)
            .env("DOPEDB_SESSION_TOKEN", "must-not-reach-provider")
            .env("DOPEDB_TEST_EXTERNAL_OUTPUT", &external_output)
            .output()
            .unwrap();
        assert!(
            start.status.success(),
            "{}",
            String::from_utf8_lossy(&start.stderr)
        );
        external_server.join().unwrap();
        let launch = fs::read_to_string(external_output).unwrap();
        let launch_lines = launch.lines().collect::<Vec<_>>();
        assert_eq!(launch_lines[0], agent_runtime_file.to_string_lossy());
        assert_eq!(launch_lines[1], external_session_id.to_string());
        assert_eq!(launch_lines[2], "1");
        assert!(launch_lines
            .iter()
            .any(|line| line.contains("mcp_servers.dopedb.command=")));
        assert!(launch_lines
            .iter()
            .any(|line| line.contains("[\"agent\",\"mcp\"]")));
        assert!(launch_lines.contains(&"exec"));
        assert!(launch_lines.contains(&"fixture prompt"));
        assert!(!launch.contains("must-not-reach-provider"));

        ProviderPath {
            fake_bin,
            test_path,
        }
    }

    /// A second `agent init` must refuse rather than overwrite the config.
    fn external_agent_init_refuses_overwrite(external: &ExternalAgentFixture) {
        let agent_project_directory = external.project_directory.clone();
        let agent_runtime_file = external.runtime_file.clone();

        let overwrite = Command::new(env!("CARGO_BIN_EXE_dopedb-cli"))
            .args(["agent", "init", "--provider", "codex"])
            .current_dir(&agent_project_directory)
            .env("DOPEDB_RUNTIME_FILE", &agent_runtime_file)
            .output()
            .unwrap();
        assert_eq!(overwrite.status.code(), Some(2));
        assert!(String::from_utf8_lossy(&overwrite.stderr).contains("already exists"));
    }

    /// The same bootstrap for the Claude provider, from a nested working
    /// directory, with its own MCP config shape.
    fn external_agent_start_claude(
        fixture: &BrokerFixture,
        external: &ExternalAgentFixture,
        provider: &ProviderPath,
    ) {
        let temp = &fixture.temp;
        let agent_endpoint = external.endpoint.clone();
        let agent_project_directory = external.project_directory.clone();
        let agent_runtime_file = external.runtime_file.clone();
        let config_path = external.config_path.clone();
        let external_config = external.config.clone();
        let fake_bin = provider.fake_bin.clone();
        let test_path = provider.test_path.clone();

        fs::remove_file(&agent_endpoint).unwrap();
        let claude_listener = UnixListener::bind(&agent_endpoint).unwrap();
        fs::set_permissions(&agent_endpoint, fs::Permissions::from_mode(0o600)).unwrap();
        let mut claude_config = external_config.clone();
        claude_config.provider = ExternalAgentProvider::Claude;
        fs::write(
            &config_path,
            serde_json::to_vec_pretty(&claude_config).unwrap(),
        )
        .unwrap();
        let claude_session_id = Uuid::from_u128(18);
        let claude_working_directory = agent_project_directory.join("nested");
        fs::create_dir(&claude_working_directory).unwrap();
        let claude_working_directory = fs::canonicalize(claude_working_directory).unwrap();
        let expected_claude_working_directory =
            claude_working_directory.to_string_lossy().into_owned();
        let expected_claude_config = claude_config.clone();
        let claude_server = thread::spawn(move || {
            let (mut stream, _) = claude_listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert_eq!(request.command, CommandName::ExternalAgentSessionStart);
            assert!(request.authentication.is_none());
            let arguments: ExternalAgentSessionStartArguments =
                serde_json::from_value(request.arguments.clone()).unwrap();
            assert_eq!(arguments.config, expected_claude_config);
            assert_eq!(
                arguments.working_directory,
                expected_claude_working_directory
            );
            respond(
                &mut stream,
                &request,
                &ExternalAgentSessionStartResult {
                    terminal_session_id: claude_session_id,
                    expires_at: Utc::now() + Duration::minutes(15),
                },
            );

            let (mut stream, _) = claude_listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert_eq!(request.command, CommandName::ExternalAgentSessionRevoke);
            let authentication = request.authentication.as_ref().unwrap();
            assert_eq!(authentication.terminal_session_id, claude_session_id);
            assert!(authentication.token().is_none());
            respond(&mut stream, &request, &EmptyArguments::default());
        });
        let fake_claude = fake_bin.join("claude");
        fs::write(
        &fake_claude,
        b"#!/bin/sh\nif env | grep -q '^DOPEDB_SESSION_TOKEN='; then exit 91; fi\nprintf '%s\\n%s\\n' \"$DOPEDB_TERMINAL_SESSION_ID\" \"$DOPEDB_AGENT_PROCESS_BOUND\" > \"$DOPEDB_TEST_EXTERNAL_OUTPUT\"\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\" >> \"$DOPEDB_TEST_EXTERNAL_OUTPUT\"; done\n",
    )
    .unwrap();
        fs::set_permissions(&fake_claude, fs::Permissions::from_mode(0o700)).unwrap();
        let claude_output = temp.path().join("external-claude-output.txt");
        let claude_start = Command::new(env!("CARGO_BIN_EXE_dopedb-cli"))
            .args(["agent", "start", "--", "--print", "fixture prompt"])
            .current_dir(&claude_working_directory)
            .env("PATH", &test_path)
            .env("DOPEDB_RUNTIME_FILE", &agent_runtime_file)
            .env("DOPEDB_SESSION_TOKEN", "must-not-reach-provider")
            .env("DOPEDB_TEST_EXTERNAL_OUTPUT", &claude_output)
            .output()
            .unwrap();
        assert!(
            claude_start.status.success(),
            "{}",
            String::from_utf8_lossy(&claude_start.stderr)
        );
        claude_server.join().unwrap();
        let claude_launch = fs::read_to_string(claude_output).unwrap();
        let claude_lines = claude_launch.lines().collect::<Vec<_>>();
        assert_eq!(claude_lines[0], claude_session_id.to_string());
        assert_eq!(claude_lines[1], "1");
        assert!(claude_lines.contains(&"--mcp-config"));
        assert!(claude_lines.iter().any(|line| {
            line.contains("\"mcpServers\"")
                && line.contains("\"dopedb\"")
                && line.contains("[\"agent\",\"mcp\"]")
        }));
        assert!(claude_lines.contains(&"--print"));
        assert!(!claude_launch.contains("must-not-reach-provider"));
    }

    /// A config reached through a symlink is refused.
    fn external_agent_start_refuses_symlinked_config(external: &ExternalAgentFixture) {
        let agent_project_directory = external.project_directory.clone();
        let agent_runtime_file = external.runtime_file.clone();
        let config_path = external.config_path.clone();

        let linked_config = agent_project_directory.join(".dopedb/linked.json");
        symlink(&config_path, &linked_config).unwrap();
        let linked = Command::new(env!("CARGO_BIN_EXE_dopedb-cli"))
            .args([
                "agent",
                "start",
                "--config",
                linked_config.to_str().unwrap(),
            ])
            .current_dir(&agent_project_directory)
            .env("DOPEDB_RUNTIME_FILE", &agent_runtime_file)
            .output()
            .unwrap();
        assert_eq!(linked.status.code(), Some(2));
        assert!(String::from_utf8_lossy(&linked.stderr).contains("invalid"));
    }
}

#[cfg(windows)]
mod platform {
    use std::fs;

    use dopedb_cli::agent_launch_policy::{adapter_command, take_registration_authentication};
    use dopedb_protocol::{AcpPluginId, AgentSessionRegisterArguments};
    use sha2::{Digest, Sha256};
    use tempfile::TempDir;

    pub(super) fn run() {
        crate::stage(
            "windows-registration-bearer-handoff",
            registration_bearer_handoff,
        );
        crate::stage(
            "windows-launcher-argv-env-pinning",
            launcher_argv_env_pinning,
        );
    }

    /// The registration bearer is taken out of the environment exactly once so
    /// it cannot be inherited by anything the launcher later spawns.
    fn registration_bearer_handoff() {
        let session_id = uuid::Uuid::from_u128(12);
        let bearer = "cd".repeat(32);
        std::env::set_var("DOPEDB_TERMINAL_SESSION_ID", session_id.to_string());
        std::env::set_var("DOPEDB_SESSION_TOKEN", &bearer);
        let authentication = take_registration_authentication().unwrap();
        assert_eq!(authentication.terminal_session_id, session_id);
        assert_eq!(authentication.token(), Some(bearer.as_str()));
        assert!(std::env::var_os("DOPEDB_SESSION_TOKEN").is_none());
        std::env::remove_var("DOPEDB_TERMINAL_SESSION_ID");
    }

    /// `adapter_command` pins the verified launcher argv and env, and refuses a
    /// registration whose runtime digest no longer matches the file on disk.
    fn launcher_argv_env_pinning() {
        let temp = TempDir::new().unwrap();
        let launcher = temp.path().join("verified-node.cmd");
        fs::write(&launcher, b"@echo off\r\nexit /b 0\r\n").unwrap();
        let launcher_resolved = fs::canonicalize(&launcher).unwrap();
        let adapter = temp.path().join("claude-adapter.js");
        fs::write(&adapter, b"verified adapter fixture").unwrap();
        let provider_cli = temp.path().join("claude.cmd");
        fs::write(&provider_cli, b"@echo off\r\nexit /b 0\r\n").unwrap();
        let provider_cli_resolved = fs::canonicalize(&provider_cli).unwrap();
        let registration = AgentSessionRegisterArguments {
            plugin_id: AcpPluginId::Claude,
            adapter_bundle_version: "1.0.0".into(),
            runtime_executable: launcher.to_string_lossy().into_owned(),
            runtime_resolved_executable: launcher_resolved.to_string_lossy().into_owned(),
            runtime_sha256: hex::encode(Sha256::digest(fs::read(&launcher_resolved).unwrap())),
            adapter_entrypoint: adapter.to_string_lossy().into_owned(),
            adapter_entrypoint_sha256: hex::encode(Sha256::digest(fs::read(&adapter).unwrap())),
            provider_cli_executable: provider_cli.to_string_lossy().into_owned(),
            provider_cli_resolved_executable: provider_cli_resolved.to_string_lossy().into_owned(),
            provider_cli_sha256: hex::encode(Sha256::digest(
                fs::read(&provider_cli_resolved).unwrap(),
            )),
        };
        let command = adapter_command(&registration).unwrap();
        assert_eq!(command.get_program(), launcher.as_os_str());
        assert_eq!(
            command
                .get_args()
                .map(|argument| argument.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            [adapter.to_string_lossy().into_owned()]
        );
        assert!(command.get_envs().any(|(name, value)| {
            name == "CLAUDE_CODE_EXECUTABLE" && value == Some(provider_cli.as_os_str())
        }));
        assert!(command
            .get_envs()
            .all(|(name, _)| name != "DOPEDB_SESSION_TOKEN"));

        let mut changed = registration;
        changed.runtime_sha256 = "00".repeat(32);
        assert!(adapter_command(&changed).is_err());
    }
}

#[test]
fn typed_agent_bridge_searches_catalog_and_pins_the_launcher_security_boundary() {
    platform::run();
    #[cfg(unix)]
    schema_diff::run();
}
