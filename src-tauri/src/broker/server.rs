//! Owner-local UDS/named-pipe server with bounded length-prefixed frames.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::error::{AppError, AppResult};
use crate::services::ApplicationServices;
use crate::skills::SkillManager;
use chrono::Utc;
use dopedb_protocol::{
    decode_frame, encode_frame, parse_frame_length, RequestEnvelope, RuntimeDiscovery,
    MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, PROTOCOL_MAX, PROTOCOL_MIN,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::dispatch::BrokerDispatcher;
use super::{discovery, peer, BrokerRuntime};

const CONTROL_IO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CONCURRENT_CONNECTIONS: usize = 64;
/// How often sessions nothing authenticates with are checked for expiry.
const EXPIRED_SESSION_SWEEP_INTERVAL: Duration = Duration::from_secs(30);

pub(crate) async fn serve(
    runtime: BrokerRuntime,
    services: ApplicationServices,
    skills: Option<SkillManager>,
    app_handle: tauri::AppHandle,
) -> AppResult<()> {
    match discovery::runtime_file_for_identifier(&app_handle.config().identifier) {
        Ok(runtime_file) => {
            serve_at(
                runtime,
                runtime_file,
                Some(services),
                skills,
                Some(app_handle),
            )
            .await
        }
        Err(error) => {
            runtime.finish(Some(&error));
            Err(error)
        }
    }
}

async fn serve_at(
    runtime: BrokerRuntime,
    runtime_file: PathBuf,
    services: Option<ApplicationServices>,
    skills: Option<SkillManager>,
    app_handle: Option<tauri::AppHandle>,
) -> AppResult<()> {
    let revocations = services
        .as_ref()
        .map(|services| bind_proposal_revocation(&runtime, services, app_handle.clone()));
    let result = platform_serve(&runtime, &runtime_file, services, skills, app_handle).await;
    if let Some(revocations) = revocations {
        revocations.abort();
    }
    discovery::remove_if_owned(&runtime_file, runtime.runtime_id());
    runtime.finish(result.as_ref().err());
    result
}

/// A closed, interrupted, expired, or revoked Agent/Terminal grant must not leave
/// an approvable proposal or a queued approval behind. The registry reports every
/// removed session with its proposals; this consumer releases the session's
/// external approval queue and cancels the proposals nobody started executing.
/// Expired sessions are swept periodically so the same release happens even
/// when nothing authenticates with them again.
fn bind_proposal_revocation(
    runtime: &BrokerRuntime,
    services: &ApplicationServices,
    app_handle: Option<tauri::AppHandle>,
) -> tokio::task::JoinHandle<()> {
    services
        .operation
        .bind_agent_session_liveness(Arc::new(runtime.sessions().clone()));
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    runtime.sessions().install_revocation_sink(sender);
    let operation = services.operation.clone();
    let sessions = runtime.sessions().clone();
    let requests = runtime.external_agent_requests().clone();
    tokio::spawn(async move {
        let mut sweep = tokio::time::interval(EXPIRED_SESSION_SWEEP_INTERVAL);
        sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                revocation = receiver.recv() => {
                    let Some(revocation) = revocation else { break };
                    super::dispatch::release_external_session(
                        &requests,
                        app_handle.as_ref(),
                        revocation.terminal_session_id,
                    );
                    if !revocation.operations.is_empty() {
                        operation
                            .cancel_revoked_agent_proposals(revocation.operations)
                            .await;
                    }
                }
                _ = sweep.tick() => {
                    sessions.sweep_expired();
                }
            }
        }
    })
}

#[cfg(unix)]
async fn platform_serve(
    runtime: &BrokerRuntime,
    runtime_file: &Path,
    services: Option<ApplicationServices>,
    skills: Option<SkillManager>,
    app_handle: Option<tauri::AppHandle>,
) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;

    let directory = discovery::prepare_runtime_directory(runtime_file)?;
    let runtime_name = runtime.runtime_id().to_string().replace('-', "");
    let endpoint = directory.join(format!("broker-{}.sock", &runtime_name[..16]));
    if std::fs::symlink_metadata(&endpoint).is_ok() {
        std::fs::remove_file(&endpoint)?;
    }
    let listener = tokio::net::UnixListener::bind(&endpoint)?;
    std::fs::set_permissions(&endpoint, std::fs::Permissions::from_mode(0o600))?;
    let endpoint_text = endpoint.to_string_lossy().into_owned();
    publish_discovery(runtime, runtime_file, &endpoint_text)?;
    runtime.mark_running(endpoint_text, runtime_file.to_path_buf());

    let dispatcher = BrokerDispatcher::new(
        runtime.runtime_id(),
        env!("CARGO_PKG_VERSION"),
        runtime.sessions().clone(),
        runtime.external_agent_requests().clone(),
        services,
        skills,
        app_handle,
    );
    let mut tasks = JoinSet::new();
    let connection_slots = Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS));
    let loop_result = loop {
        tokio::select! {
            _ = runtime.shutdown_token().cancelled() => break Ok(()),
            accepted = listener.accept() => {
                let (stream, _) = match accepted {
                    Ok(accepted) => accepted,
                    Err(error) => break Err(AppError::Io(error)),
                };
                let peer = match peer::verify_unix_peer(&stream) {
                    Ok(peer) => peer,
                    Err(error) => {
                        tracing::warn!(error_kind = ?error.kind(), "rejected local broker peer");
                        continue;
                    }
                };
                let permit = match Arc::clone(&connection_slots).try_acquire_owned() {
                    Ok(permit) => permit,
                    Err(_) => {
                        tracing::warn!("rejected local broker peer because the connection limit is full");
                        continue;
                    }
                };
                let dispatcher = dispatcher.for_peer(peer);
                tasks.spawn(async move {
                    let _permit = permit;
                    if let Err(error) = handle_stream(stream, dispatcher).await {
                        tracing::debug!(error_kind = ?error.kind(), "broker connection closed");
                    }
                });
            }
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
        }
    };
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    drop(listener);
    let _ = std::fs::remove_file(endpoint);
    loop_result
}

#[cfg(windows)]
async fn platform_serve(
    runtime: &BrokerRuntime,
    runtime_file: &Path,
    services: Option<ApplicationServices>,
    skills: Option<SkillManager>,
    app_handle: Option<tauri::AppHandle>,
) -> AppResult<()> {
    let _directory = discovery::prepare_runtime_directory(runtime_file)?;
    let endpoint = format!(r"\\.\pipe\dopedb-{}", runtime.runtime_id());
    let mut server = peer::create_named_pipe(&endpoint, true)?;
    publish_discovery(runtime, runtime_file, &endpoint)?;
    runtime.mark_running(endpoint.clone(), runtime_file.to_path_buf());

    let dispatcher = BrokerDispatcher::new(
        runtime.runtime_id(),
        env!("CARGO_PKG_VERSION"),
        runtime.sessions().clone(),
        runtime.external_agent_requests().clone(),
        services,
        skills,
        app_handle,
    );
    let mut tasks = JoinSet::new();
    let connection_slots = Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS));
    let loop_result = loop {
        tokio::select! {
            _ = runtime.shutdown_token().cancelled() => break Ok(()),
            connected = server.connect() => {
                if let Err(error) = connected {
                    break Err(AppError::Io(error));
                }
                let next = match peer::create_named_pipe(&endpoint, false) {
                    Ok(next) => next,
                    Err(error) => break Err(AppError::Io(error)),
                };
                let connected = std::mem::replace(&mut server, next);
                let peer = match peer::verify_named_pipe_peer(&connected) {
                    Ok(peer) => peer,
                    Err(error) => {
                        tracing::warn!(error_kind = ?error.kind(), "rejected local broker peer");
                        continue;
                    }
                };
                let permit = match Arc::clone(&connection_slots).try_acquire_owned() {
                    Ok(permit) => permit,
                    Err(_) => {
                        tracing::warn!("rejected local broker peer because the connection limit is full");
                        continue;
                    }
                };
                let dispatcher = dispatcher.for_peer(peer);
                tasks.spawn(async move {
                    let _permit = permit;
                    if let Err(error) = handle_stream(connected, dispatcher).await {
                        tracing::debug!(error_kind = ?error.kind(), "broker connection closed");
                    }
                });
            }
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
        }
    };
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    loop_result
}

fn publish_discovery(
    runtime: &BrokerRuntime,
    runtime_file: &Path,
    endpoint: &str,
) -> AppResult<()> {
    let metadata = RuntimeDiscovery::new(
        runtime.runtime_id().into(),
        std::process::id(),
        env!("CARGO_PKG_VERSION"),
        PROTOCOL_MIN,
        PROTOCOL_MAX,
        endpoint,
        Utc::now(),
    )
    .map_err(|_| AppError::Config("could not construct runtime discovery metadata".into()))?;
    discovery::publish(runtime_file, &metadata)
}

async fn handle_stream<S>(mut stream: S, dispatcher: BrokerDispatcher) -> std::io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let request = tokio::time::timeout(CONTROL_IO_TIMEOUT, read_request(&mut stream))
        .await
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::TimedOut, "broker read timed out")
        })??;
    let response = dispatcher.dispatch(request).await;
    let frame = encode_frame(&response, MAX_RESPONSE_BYTES)
        .map_err(|_| std::io::Error::other("broker response framing failed"))?;
    tokio::time::timeout(CONTROL_IO_TIMEOUT, stream.write_all(&frame))
        .await
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::TimedOut, "broker write timed out")
        })??;
    stream.shutdown().await
}

async fn read_request<S>(stream: &mut S) -> std::io::Result<RequestEnvelope>
where
    S: AsyncRead + Unpin,
{
    let mut prefix = [0u8; 4];
    stream.read_exact(&mut prefix).await?;
    let length = parse_frame_length(prefix, MAX_REQUEST_BYTES).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid frame length")
    })?;
    let mut frame = Vec::with_capacity(4 + length);
    frame.extend_from_slice(&prefix);
    frame.resize(4 + length, 0);
    stream.read_exact(&mut frame[4..]).await?;
    decode_frame(&frame, MAX_REQUEST_BYTES)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid request frame"))
}
