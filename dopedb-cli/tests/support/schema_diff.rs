//! Exercises the real CLI/Agent binaries against an isolated authenticated Broker
//! fixture. No installed Desktop, account, credential, or database is accessed.

use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::process::{Command, Output, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, Instant};

use dopedb_protocol::*;
use serde_json::{json, Value};
use uuid::Uuid;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../dopedb-protocol/tests/fixtures/schema-diff-v1.json"
    ))
    .unwrap()
}

fn snapshot(side: &str) -> CatalogSnapshot {
    let data = fixture();
    let value = &data[side];
    CatalogSnapshot::capture(
        value["connectionId"].as_str().unwrap().parse().unwrap(),
        DatabaseEngine::Postgres,
        value["database"].as_str().unwrap(),
        chrono::Utc::now(),
        CatalogContents {
            relations: serde_json::from_value(value["relations"].clone()).unwrap(),
            ..Default::default()
        },
    )
    .unwrap()
}

fn invoke(scenario: &str, tool_arguments: Option<Value>, human: bool) -> Output {
    let directory = tempfile::TempDir::new().unwrap();
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let runtime_id = Uuid::from_u128(1);
    let endpoint = directory.path().join(format!(
        "broker-{}.sock",
        &runtime_id.simple().to_string()[..16]
    ));
    let listener = UnixListener::bind(&endpoint).unwrap();
    listener.set_nonblocking(true).unwrap();
    fs::set_permissions(&endpoint, fs::Permissions::from_mode(0o600)).unwrap();
    let discovery = RuntimeDiscovery::new(
        runtime_id,
        std::process::id(),
        "0.4.22",
        PROTOCOL_MIN,
        PROTOCOL_MAX,
        endpoint.to_string_lossy(),
        chrono::Utc::now(),
    )
    .unwrap();
    let runtime_file = directory.path().join("runtime.json");
    fs::write(&runtime_file, serde_json::to_vec(&discovery).unwrap()).unwrap();
    fs::set_permissions(&runtime_file, fs::Permissions::from_mode(0o600)).unwrap();
    let done = Arc::new(AtomicBool::new(false));
    let server_done = done.clone();
    let scenario = scenario.to_owned();
    let expected_requests = match scenario.as_str() {
        "invalid_page" | "no_auth" => 0,
        "wrong_summary" => 1,
        "denied_target" | "different_engine" => 2,
        "wrong_snapshot" => 3,
        "failed_target" => 4,
        _ => 6,
    };
    let agent = tool_arguments.is_some();
    let no_auth = scenario == "no_auth";
    let server = thread::spawn(move || {
        let start = Instant::now();
        let mut requests = 0;
        loop {
            let (mut stream, _) = match listener.accept() {
                Ok(stream) => stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if server_done.load(Ordering::SeqCst) {
                        break;
                    }
                    assert!(
                        start.elapsed() < Duration::from_secs(35),
                        "schema diff journey timed out"
                    );
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(error) => panic!("{error}"),
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut prefix = [0u8; 4];
            stream.read_exact(&mut prefix).unwrap();
            let size = parse_frame_length(prefix, MAX_REQUEST_BYTES).unwrap();
            let mut frame = prefix.to_vec();
            frame.resize(size + 4, 0);
            stream.read_exact(&mut frame[4..]).unwrap();
            let request: RequestEnvelope = decode_frame(&frame, MAX_REQUEST_BYTES).unwrap();
            let auth = request.authentication.as_ref().unwrap();
            assert_eq!(auth.terminal_session_id, Uuid::from_u128(2));
            assert_eq!(auth.token().is_none(), agent);
            let (command, side) = match requests {
                0 | 4 => (CommandName::ConnectionShow, "baseline"),
                1 | 5 => (CommandName::ConnectionShow, "target"),
                2 => (CommandName::CatalogShow, "baseline"),
                3 => (CommandName::CatalogShow, "target"),
                _ => panic!("unexpected Broker request"),
            };
            assert_eq!(request.command, command);
            let catalog = snapshot(side);
            assert_eq!(
                request.arguments["connection"],
                format!("id:{}", catalog.connection_id())
            );
            let denied = (scenario == "denied_target" && requests == 1)
                || (scenario == "revoked_after_read" && requests == 5);
            let response = if denied || (scenario == "failed_target" && requests == 3) {
                ResponseEnvelope::failure(
                    PROTOCOL_MAX,
                    request.request_id,
                    ProtocolError::new(
                        if denied {
                            ErrorCode::ScopeDenied
                        } else {
                            ErrorCode::TargetExecutionFailed
                        },
                        false,
                    ),
                )
            } else {
                let result = if command == CommandName::ConnectionShow {
                    serde_json::to_value(ConnectionSummary {
                        id: if scenario == "wrong_summary" {
                            Uuid::from_u128(999)
                        } else {
                            catalog.connection_id()
                        },
                        name: side.into(),
                        engine: if scenario == "different_engine" && side == "target" {
                            DatabaseEngine::Mysql
                        } else {
                            DatabaseEngine::Postgres
                        },
                        database: catalog.database().into(),
                        environment: None,
                        readonly: true,
                        allow_writes: false,
                    })
                    .unwrap()
                } else {
                    // Explicit database selection requires the existing fresh read path.
                    assert_eq!(request.arguments["database"], catalog.database());
                    if scenario == "wrong_snapshot" {
                        serde_json::to_value(snapshot("target")).unwrap()
                    } else {
                        serde_json::to_value(catalog).unwrap()
                    }
                };
                ResponseEnvelope::success(PROTOCOL_MAX, request.request_id, result)
            };
            stream
                .write_all(&encode_frame(&response, MAX_RESPONSE_BYTES).unwrap())
                .unwrap();
            requests += 1;
        }
        assert_eq!(requests, expected_requests);
    });
    let mut command = Command::new(if agent {
        env!("CARGO_BIN_EXE_dopedb-agent-bridge")
    } else {
        env!("CARGO_BIN_EXE_dopedb-cli")
    });
    command
        .env("DOPEDB_RUNTIME_FILE", &runtime_file)
        .env_remove("DOPEDB_SESSION_TOKEN")
        .env_remove("DOPEDB_AGENT_PROCESS_BOUND")
        .env_remove("DOPEDB_TERMINAL_SESSION_ID");
    if !no_auth {
        command.env("DOPEDB_TERMINAL_SESSION_ID", Uuid::from_u128(2).to_string());
    }
    let input = if let Some(arguments) = tool_arguments {
        command.arg("mcp").env("DOPEDB_AGENT_PROCESS_BOUND", "1");
        Some(
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "schema_diff", "arguments": arguments } }),
        )
    } else {
        if !no_auth {
            command.env("DOPEDB_SESSION_TOKEN", "fixture-only-schema-diff-session");
        }
        command.args([
            "schema",
            "diff",
            "--baseline",
            "id:00000000-0000-0000-0000-000000000007",
            "--target",
            "id:00000000-0000-0000-0000-000000000008",
        ]);
        if !human {
            command.arg("--json");
        }
        None
    };
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().unwrap();
    if let Some(input) = input {
        let mut stdin = child.stdin.take().unwrap();
        serde_json::to_writer(&mut stdin, &input).unwrap();
        stdin.write_all(b"\n").unwrap();
    } else {
        drop(child.stdin.take());
    }
    let output = child.wait_with_output().unwrap();
    done.store(true, Ordering::SeqCst);
    server.join().unwrap();
    output
}

pub(super) fn run() {
    let output = invoke("ok", None, false);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let diff: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(diff["objects"], fixture()["objects"]);
    assert_eq!(diff["counts"], fixture()["counts"]);
    let human = invoke("ok", None, true);
    assert!(human.status.success());
    let human = String::from_utf8(human.stdout).unwrap();
    assert!(human.contains("2 added · 2 missing · 5 changed"));
    assert!(human.contains(fixture()["objects"][2]["name"].as_str().unwrap()));
    assert!(human.contains("− (status)"));
    assert!(human.contains("+ UNIQUE (status)"));
    for (scenario, code) in [
        ("denied_target", 4),
        ("failed_target", 8),
        ("revoked_after_read", 4),
        ("different_engine", 2),
        ("wrong_snapshot", 10),
        ("wrong_summary", 10),
        ("no_auth", 4),
    ] {
        let output = invoke(scenario, None, false);
        assert_eq!(output.status.code(), Some(code), "{scenario}");
        assert!(
            output.stdout.is_empty(),
            "a failed comparison must have no partial result"
        );
        assert!(
            !String::from_utf8_lossy(&output.stderr).contains("fixture-only-schema-diff-session")
        );
    }
    let arguments = json!({ "baselineConnectionId": snapshot("baseline").connection_id(),
        "targetConnectionId": snapshot("target").connection_id(), "limit": 2 });
    let output = invoke("ok", Some(arguments.clone()), false);
    assert!(output.status.success());
    let page: Value = serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"]
        ["structuredContent"]
        .clone();
    assert_eq!(page["diff"]["total"], 9);
    assert_eq!(page["nextOffset"], 2);
    assert_eq!(page["diff"]["objects"].as_array().unwrap().len(), 2);
    let mut next = arguments.clone();
    next["offset"] = json!(2);
    next["baselineFingerprint"] = diff["baseline"]["fingerprint"].clone();
    next["targetFingerprint"] = diff["target"]["fingerprint"].clone();
    let output = invoke("ok", Some(next.clone()), false);
    let page: Value = serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"]
        ["structuredContent"]
        .clone();
    assert_eq!(page["diff"]["objects"][0], fixture()["objects"][2]);
    next["targetFingerprint"] = json!("stale");
    let output = invoke("ok", Some(next), false);
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"]["isError"],
        true
    );
    let mut invalid = arguments;
    invalid["limit"] = json!(0);
    let output = invoke("invalid_page", Some(invalid), false);
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"]["isError"],
        true
    );
}
