//! Credential-free loopback probes that identify a database server already
//! running on this machine.
//!
//! Each probe opens exactly one allowlisted candidate, exchanges the fewest
//! bytes a protocol needs to identify itself, and closes. No probe sends a
//! credential, a startup or authentication packet, or a query, and none reads a
//! client configuration or credential file, so a probe cannot leave a failed
//! login behind on the server it touched.

use std::time::Duration;

use mongodb::bson::{doc, Document};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::model::Engine;

use super::domain::{LocalDatabaseListener, LocalListenerTarget, LOCAL_LISTENER_HOST};
use super::ports::LocalListenerProbePort;

/// A loopback server answers immediately and a closed port fails at once, so a
/// slower answer is reported as "nothing found" rather than holding the
/// first-run screen open.
const PROBE_TIMEOUT: Duration = Duration::from_millis(600);

/// Upper bound on the bytes one probe reads. Every handshake parsed here is far
/// smaller; the cap keeps an unexpected service on an allowlisted port from
/// streaming into the probe.
const MAX_HANDSHAKE_BYTES: usize = 16 * 1024;

/// MongoDB wire protocol opcode for a single-document command message.
const MONGODB_OP_MSG: i32 = 2013;

#[derive(Clone, Copy, Default)]
pub(crate) struct SystemLocalListenerProbe;

impl LocalListenerProbePort for SystemLocalListenerProbe {
    async fn probe(&self, target: LocalListenerTarget) -> Option<LocalDatabaseListener> {
        timeout(PROBE_TIMEOUT, handshake(target))
            .await
            .ok()
            .flatten()
    }
}

/// Returns `None` when nothing answers or the answer is not the protocol this
/// candidate claims. The inner `Option` is the server version, which only some
/// protocols report before authentication.
async fn handshake(target: LocalListenerTarget) -> Option<LocalDatabaseListener> {
    let mut stream = TcpStream::connect((LOCAL_LISTENER_HOST, target.port))
        .await
        .ok()?;
    let version = match target.engine {
        Engine::Postgres => postgres_version(&mut stream).await,
        Engine::Mysql => mysql_version(&mut stream).await,
        Engine::Mongodb => mongodb_version(&mut stream).await,
        // Neither engine is a local listener: SQLite is a file and BigQuery is
        // reached through the official CLI.
        Engine::Sqlite | Engine::Bigquery => None,
    }?;
    let _ = stream.shutdown().await;
    // The domain decides what a suggestion may carry; the probe only reports
    // what the protocol said.
    Some(LocalDatabaseListener::new(target, version.as_deref()))
}

/// PostgreSQL never speaks first, so the probe sends the 8-byte `SSLRequest`
/// every client sends ahead of its startup packet and reads the one-byte
/// answer. It stops there deliberately: a startup packet would have to name a
/// role and would leave an authentication failure in the server log.
async fn postgres_version(stream: &mut TcpStream) -> Option<Option<String>> {
    const SSL_REQUEST: [u8; 8] = [0, 0, 0, 8, 0x04, 0xD2, 0x16, 0x2F];
    stream.write_all(&SSL_REQUEST).await.ok()?;
    stream.flush().await.ok()?;
    let mut answer = [0u8; 1];
    stream.read_exact(&mut answer).await.ok()?;
    // `S` accepts TLS and `N` declines it; either proves a PostgreSQL server.
    // The version stays unknown because PostgreSQL reports it only after the
    // startup packet this probe refuses to send.
    matches!(answer[0], b'S' | b'N').then_some(None)
}

/// MySQL and MariaDB speak first with the initial handshake packet, so the
/// probe only reads. Its payload opens with the protocol version and a
/// NUL-terminated server version string.
async fn mysql_version(stream: &mut TcpStream) -> Option<Option<String>> {
    let mut header = [0u8; 4];
    stream.read_exact(&mut header).await.ok()?;
    let length = u32::from_le_bytes([header[0], header[1], header[2], 0]) as usize;
    if length == 0 || length > MAX_HANDSHAKE_BYTES {
        return None;
    }
    let mut payload = vec![0u8; length];
    stream.read_exact(&mut payload).await.ok()?;
    match payload[0] {
        // A server that refuses the connection up front — a host blocked after
        // too many connection errors, for example — answers with an error
        // packet instead. It is still a MySQL server.
        0xFF => Some(None),
        10 => Some(
            std::str::from_utf8(payload[1..].split(|byte| *byte == 0).next()?)
                .ok()
                .map(str::to_owned),
        ),
        _ => None,
    }
}

/// MongoDB does not speak first either. `hello` is the one command every driver
/// may run before authenticating, so the probe sends it as a single OP_MSG.
async fn mongodb_version(stream: &mut TcpStream) -> Option<Option<String>> {
    let command = mongodb::bson::to_vec(&doc! { "hello": 1, "$db": "admin" }).ok()?;
    // Header, flag bits, and the single body-section kind precede the document.
    let length = 16 + 4 + 1 + command.len();
    let mut request = Vec::with_capacity(length);
    request.extend_from_slice(&(i32::try_from(length).ok()?).to_le_bytes());
    request.extend_from_slice(&1i32.to_le_bytes());
    request.extend_from_slice(&0i32.to_le_bytes());
    request.extend_from_slice(&MONGODB_OP_MSG.to_le_bytes());
    request.extend_from_slice(&0u32.to_le_bytes());
    request.push(0);
    request.extend_from_slice(&command);
    stream.write_all(&request).await.ok()?;
    stream.flush().await.ok()?;

    let mut header = [0u8; 16];
    stream.read_exact(&mut header).await.ok()?;
    let reply_length = i32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let op_code = i32::from_le_bytes([header[12], header[13], header[14], header[15]]);
    let body_length = usize::try_from(reply_length).ok()?.checked_sub(16)?;
    if op_code != MONGODB_OP_MSG || body_length > MAX_HANDSHAKE_BYTES {
        return None;
    }
    let mut body = vec![0u8; body_length];
    stream.read_exact(&mut body).await.ok()?;
    let document = Document::from_reader(body.get(5..)?).ok()?;
    // `hello` answers before authentication and always reports the wire version
    // range. The version string itself needs `buildInfo`, which does require a
    // credential, so it stays unknown here.
    document.get_i32("maxWireVersion").ok().map(|_| None)
}
