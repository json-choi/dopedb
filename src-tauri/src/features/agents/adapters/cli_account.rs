//! Reads public account identity through the official Codex CLI's local stdio
//! server. No token files, login requests, refreshes or provider HTTP exist here.

use serde_json::{json, Value};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub(super) fn public_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty() && text.len() <= 320 && !text.chars().any(char::is_control))
        .map(str::to_owned)
}

pub(super) async fn codex_account(
    binary: &Path,
) -> Option<(String, Option<String>, Option<String>)> {
    let mut command = super::cli_probe::quiet_command(binary);
    command.args(["app-server", "--stdio"]);
    super::cli_probe::apply_probe_environment(&mut command);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = tokio::process::Command::from(command)
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let result = tokio::time::timeout(Duration::from_secs(8), async {
        let mut input = child.stdin.take()?;
        let output = child.stdout.take()?;
        let mut reader = BufReader::new(output);
        let initialize = json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"dopedb-account-status","version":env!("CARGO_PKG_VERSION")}}});
        input.write_all(format!("{initialize}\n").as_bytes()).await.ok()?;
        let mut initialized = false;
        loop {
            let mut line = Vec::new();
            loop {
                let buffer = reader.fill_buf().await.ok()?;
                if buffer.is_empty() { return None; }
                let count = buffer.iter().position(|byte| *byte == b'\n').map_or(buffer.len(), |index| index + 1);
                if line.len() + count > 65_536 { return None; }
                let complete = buffer[count - 1] == b'\n';
                line.extend_from_slice(&buffer[..count]);
                reader.consume(count);
                if complete { break; }
            }
            let message: Value = serde_json::from_slice(&line).ok()?;
            if message.get("id") == Some(&json!(1)) && !initialized {
                message.get("result")?;
                initialized = true;
                input.write_all(b"{\"method\":\"initialized\"}\n{\"id\":2,\"method\":\"account/read\",\"params\":{\"refreshToken\":false}}\n").await.ok()?;
            } else if message.get("id") == Some(&json!(2)) {
                let account = message.get("result")?.get("account")?;
                let method = public_text(account.get("type"))?;
                return Some((method, public_text(account.get("email")), public_text(account.get("planType"))));
            }
        }
    }).await.ok().flatten();
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}
