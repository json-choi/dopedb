//! Desktop-only ephemeral loopback login attempts and serialized account commits.

mod http;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub(crate) use tests::assert_desktop_login_contract;

use std::{future::Future, sync::Arc, time::Duration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex},
    time::Instant,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::super::domain::WorkspaceDesktopAuthorization;
use crate::error::{AppError, AppResult};

const LIFETIME: Duration = Duration::from_secs(600);

/// Never serialized: only the native control-plane adapter receives these values.
pub(crate) struct DesktopAuthorizationCode {
    pub(crate) code: Zeroizing<String>,
    pub(crate) verifier: Zeroizing<String>,
    pub(crate) redirect_uri: String,
}

pub(crate) enum DesktopCallback {
    Code(DesktopAuthorizationCode),
    Denied,
    Expired,
}

struct Attempt {
    id: String,
    cancellation: CancellationToken,
    receiver: Option<oneshot::Receiver<AppResult<DesktopCallback>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Attempt {
    fn drop(&mut self) {
        self.cancellation.cancel();
        self.task.abort();
    }
}

#[derive(Clone, Default)]
pub(crate) struct DesktopLoginRuntime {
    active: Arc<Mutex<Option<Attempt>>>,
}

fn random_secret() -> AppResult<Zeroizing<String>> {
    let mut bytes = Zeroizing::new([0u8; 32]);
    getrandom::fill(bytes.as_mut())
        .map_err(|_| AppError::Config("could not generate workspace login randomness".into()))?;
    Ok(Zeroizing::new(URL_SAFE_NO_PAD.encode(bytes.as_ref())))
}

impl DesktopLoginRuntime {
    pub(crate) async fn begin(&self, scheme: &str) -> AppResult<WorkspaceDesktopAuthorization> {
        self.begin_at(&crate::hosted_control_plane::origin()?, LIFETIME, scheme)
            .await
    }

    async fn begin_at(
        &self,
        origin: &str,
        lifetime: Duration,
        scheme: &str,
    ) -> AppResult<WorkspaceDesktopAuthorization> {
        // Serializes replacement with the complete account commit, never with browser wait.
        let mut active = self.active.lock().await;
        retire(&mut active).await;
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| {
                AppError::Network("could not open the local workspace login callback".into())
            })?;
        let address = listener.local_addr()?;
        let redirect_uri = format!("http://{address}/callback");
        let verifier = random_secret()?;
        let state = random_secret()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = url::Url::parse(&format!("{origin}/auth/desktop"))
            .map_err(|_| AppError::Config("workspace authorization URL is invalid".into()))?;
        url.query_pairs_mut().extend_pairs([
            ("client_id", "dopedb-desktop"),
            ("response_type", "code"),
            ("redirect_uri", redirect_uri.as_str()),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ]);
        let id = Uuid::new_v4().to_string();
        let authorization_url = format!("http://{address}/start/{id}");
        let browser_id = id.clone();
        let app_url = match scheme {
            "dev.dopedb.desktop.dev" => "dopedb-dev://workspace/access-complete",
            "dev.dopedb.desktop.benchmark" => "dopedb-benchmark://workspace/access-complete",
            "dev.dopedb.desktop" => "dopedb://workspace/access-complete",
            _ => {
                return Err(AppError::Config(
                    "unrecognized desktop login application".into(),
                ))
            }
        };
        let cancellation = CancellationToken::new();
        let cancelled = cancellation.clone();
        let (sender, receiver) = oneshot::channel();
        let task = tokio::spawn(async move {
            let callback = tokio::select! {
                biased;
                _ = cancelled.cancelled() => return,
                result = tokio::time::timeout_at(Instant::now() + lifetime, http::receive(listener, &state, &browser_id, url.as_str(), app_url)) => {
                    match result {
                        Err(_) => Ok(DesktopCallback::Expired),
                        Ok(Err(error)) => Err(error),
                        Ok(Ok(None)) => Ok(DesktopCallback::Denied),
                        Ok(Ok(Some(code))) => Ok(DesktopCallback::Code(DesktopAuthorizationCode { code, verifier, redirect_uri })),
                    }
                }
            };
            let _ = sender.send(callback);
        });
        *active = Some(Attempt {
            id: id.clone(),
            cancellation,
            receiver: Some(receiver),
            task,
        });
        Ok(WorkspaceDesktopAuthorization {
            attempt_id: id,
            authorization_url,
            expires_in: lifetime.as_secs(),
        })
    }

    pub(crate) async fn wait(&self, id: &str) -> AppResult<DesktopCallback> {
        let receiver = {
            let mut active = self.active.lock().await;
            active
                .as_mut()
                .filter(|attempt| attempt.id == id)
                .and_then(|attempt| attempt.receiver.take())
                .ok_or_else(|| {
                    AppError::Config("workspace login attempt is no longer available".into())
                })?
        };
        receiver
            .await
            .map_err(|_| AppError::Config("workspace login was cancelled".into()))?
    }

    /// Cancellation/replacement cannot cross a token persistence and account activation.
    pub(crate) async fn commit<T>(
        &self,
        id: &str,
        action: impl Future<Output = AppResult<T>>,
    ) -> AppResult<T> {
        let mut active = self.active.lock().await;
        if !active
            .as_ref()
            .is_some_and(|attempt| attempt.id == id && !attempt.cancellation.is_cancelled())
        {
            return Err(AppError::Config("workspace login was cancelled".into()));
        }
        let result = action.await;
        active.take();
        result
    }

    pub(crate) async fn cancel(&self, id: &str) {
        let mut active = self.active.lock().await;
        if active.as_ref().is_some_and(|attempt| attempt.id == id) {
            retire(&mut active).await;
        }
    }

    pub(crate) async fn shutdown(&self) {
        let mut active = self.active.lock().await;
        retire(&mut active).await;
    }
}

async fn retire(active: &mut Option<Attempt>) {
    if let Some(mut attempt) = active.take() {
        attempt.cancellation.cancel();
        attempt.task.abort();
        // Await abortion so cancellation returns only after the listener is released.
        let _ = (&mut attempt.task).await;
    }
}
