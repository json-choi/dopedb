//! Connection secrets in the OS credential store (macOS Keychain or Windows
//! Credential Manager through keyring 4).
//! Service = bundle id, account = connection id. The app.db holds only a
//! `secret_ref`; the password never touches disk in cleartext.
//! A zeroizing process-session cache avoids reopening the OS credential store for
//! every query or membership request. The OS store remains the at-rest authority.
//!
//! PRODUCTION REQUIRES A SIGNED BUILD. Unsigned / ad-hoc builds can both hit
//! platform credential-store failures (for example macOS `errSecMissingEntitlement
//! (-34018)`) and accidentally prompt for the installed production app's items.
//! DEBUG builds therefore use only an obfuscated file under the isolated dev app
//! data dir and never open the production credential-store namespace.
//! That store is NOT real security; it exists solely so unsigned dev builds run.
//! Packaged benchmark builds never open the OS credential store. Their synthetic
//! credentials use the benchmark's isolated temporary data root instead.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Duration;

#[cfg(not(feature = "packaged-benchmark"))]
use keyring::Entry;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::kernel::sync::lock_unpoisoned;

/// Credential-store service name (bundle id). Must match the signed bundle identifier.
#[cfg(all(debug_assertions, not(feature = "packaged-benchmark")))]
const SERVICE: &str = "dev.dopedb.desktop.dev";
#[cfg(all(not(debug_assertions), not(feature = "packaged-benchmark")))]
const SERVICE: &str = "dev.dopedb.desktop";
const ANALYSIS_RESULT_CACHE_KEY_ACCOUNT: &str = "analysis-result-cache-key:v1";
static SESSION_CACHE: LazyLock<Mutex<HashMap<String, Zeroizing<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static WORKSPACE_SESSION_KEYCHAIN_GATE: LazyLock<Arc<tokio::sync::Mutex<()>>> =
    LazyLock::new(|| Arc::new(tokio::sync::Mutex::new(())));
const WORKSPACE_SESSION_READ_TIMEOUT: Duration = Duration::from_secs(10);

fn session_cache() -> MutexGuard<'static, HashMap<String, Zeroizing<String>>> {
    lock_unpoisoned(&SESSION_CACHE)
}

fn cached_secret(account: &str) -> Option<String> {
    session_cache()
        .get(account)
        .map(|secret| secret.as_str().to_owned())
}

fn remember_secret(account: &str, secret: &str) {
    session_cache().insert(account.to_owned(), Zeroizing::new(secret.to_owned()));
}

fn read_cached_secret(
    account: &str,
    read: impl FnOnce() -> AppResult<String>,
) -> AppResult<String> {
    if let Some(secret) = cached_secret(account) {
        return Ok(secret);
    }
    let secret = read()?;
    remember_secret(account, &secret);
    Ok(secret)
}

fn forget_secret(account: &str) {
    session_cache().remove(account);
}

#[cfg(not(feature = "packaged-benchmark"))]
fn entry(account: &str) -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, account)?)
}

/// Store (or replace) the secret for a connection.
pub fn store_secret(connection_id: &Uuid, secret: &str) -> AppResult<()> {
    let account = connection_id.to_string();
    #[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
    file_store(&account, secret)?;
    #[cfg(all(not(debug_assertions), not(feature = "packaged-benchmark")))]
    entry(&account)?.set_password(secret)?;
    remember_secret(&account, secret);
    Ok(())
}

/// Fetch the secret for a connection.
pub fn fetch_secret(connection_id: &Uuid) -> AppResult<String> {
    let account = connection_id.to_string();
    read_cached_secret(&account, || {
        #[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
        return file_fetch(&account).map_err(|error| match error {
            AppError::NotFound(_) => {
                AppError::NotFound(format!("no secret for connection {connection_id}"))
            }
            error => error,
        });
        #[cfg(all(not(debug_assertions), not(feature = "packaged-benchmark")))]
        match entry(&account)?.get_password() {
            Ok(s) => Ok(s),
            Err(keyring::Error::NoEntry) => Err(AppError::NotFound(format!(
                "no secret for connection {connection_id}"
            ))),
            Err(e) => Err(e.into()),
        }
    })
}

/// Delete a connection's secret. Missing is not an error.
pub fn delete_secret(connection_id: &Uuid) -> AppResult<()> {
    let account = connection_id.to_string();
    forget_secret(&account);
    #[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
    return file_delete(&account);
    #[cfg(all(not(debug_assertions), not(feature = "packaged-benchmark")))]
    match entry(&account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn workspace_session_account(user_id: &str) -> AppResult<String> {
    let user_id = Uuid::parse_str(user_id)
        .map_err(|_| AppError::Config("workspace account id is invalid".into()))?;
    Ok(format!("workspace-session:{user_id}"))
}

fn store_workspace_session_account(account: &str, token: &str) -> AppResult<()> {
    #[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
    file_store(account, token)?;
    #[cfg(all(not(debug_assertions), not(feature = "packaged-benchmark")))]
    entry(account)?.set_password(token)?;
    remember_secret(account, token);
    Ok(())
}

fn fetch_workspace_session_account(account: &str) -> AppResult<Option<String>> {
    if let Some(token) = cached_secret(account) {
        return Ok(Some(token));
    }
    #[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
    let token = match file_fetch(account) {
        Ok(token) => Some(token),
        Err(AppError::NotFound(_)) => None,
        Err(error) => return Err(error),
    };
    #[cfg(all(not(debug_assertions), not(feature = "packaged-benchmark")))]
    let token = match entry(account)?.get_password() {
        Ok(token) => Some(token),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => return Err(e.into()),
    };
    if let Some(token) = token.as_deref() {
        remember_secret(account, token);
    }
    Ok(token)
}

fn delete_workspace_session_account(account: &str) -> AppResult<()> {
    forget_secret(account);
    #[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
    return file_delete(account);
    #[cfg(all(not(debug_assertions), not(feature = "packaged-benchmark")))]
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

async fn workspace_session_keychain_task<T, F>(task: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    let gate = WORKSPACE_SESSION_KEYCHAIN_GATE.clone().lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let _gate = gate;
        task()
    })
    .await
    .map_err(|_| AppError::Config("workspace session credential task stopped".into()))?
}

async fn bounded_workspace_session_read<T, F>(task: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    bounded_workspace_session_read_with_timeout(WORKSPACE_SESSION_READ_TIMEOUT, task).await
}

async fn bounded_workspace_session_read_with_timeout<T, F>(
    timeout: Duration,
    task: F,
) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::time::timeout(timeout, workspace_session_keychain_task(task))
        .await
        .map_err(|_| {
            AppError::Timeout("workspace session credential read exceeded 10 seconds".into())
        })?
}

/// Store one Better Auth Bearer session without blocking a Tokio runtime worker.
pub async fn store_workspace_session(user_id: &str, token: &str) -> AppResult<()> {
    let account = workspace_session_account(user_id)?;
    let token = Zeroizing::new(token.to_owned());
    workspace_session_keychain_task(move || {
        store_workspace_session_account(&account, token.as_str())
    })
    .await
}

/// Read one account's stored session without blocking a Tokio runtime worker.
/// A missing item is normal signed-out state. The cold-read gate also collapses
/// concurrent startup requests so only the first one reaches the OS credential store.
pub async fn fetch_workspace_session(user_id: &str) -> AppResult<Option<String>> {
    let account = workspace_session_account(user_id)?;
    if let Some(token) = cached_secret(&account) {
        return Ok(Some(token));
    }
    bounded_workspace_session_read(move || {
        // Another caller may have populated the process cache while this read
        // waited for the single-flight gate.
        fetch_workspace_session_account(&account)
    })
    .await
}

/// Delete one local Better Auth session without blocking a Tokio runtime worker.
/// Missing state is idempotently signed out.
pub async fn delete_workspace_session(user_id: &str) -> AppResult<()> {
    let account = workspace_session_account(user_id)?;
    workspace_session_keychain_task(move || delete_workspace_session_account(&account)).await
}

#[cfg(test)]
pub(crate) async fn assert_workspace_session_keychain_async_contract() {
    let source = include_str!("keychain.rs");
    let production_source = source.split("#[cfg(test)]").next().unwrap_or(source);
    for signature in [
        "pub async fn store_workspace_session",
        "pub async fn fetch_workspace_session",
        "pub async fn delete_workspace_session",
    ] {
        assert!(source.contains(signature), "missing {signature}");
    }
    assert!(source.contains("WORKSPACE_SESSION_KEYCHAIN_GATE"));
    assert!(source.contains("WORKSPACE_SESSION_READ_TIMEOUT"));
    assert!(source.contains("lock_owned().await"));
    assert!(source.contains("tokio::time::timeout"));
    assert_eq!(
        production_source
            .matches("tokio::task::spawn_blocking")
            .count(),
        1
    );

    let timed_out: AppResult<()> =
        bounded_workspace_session_read_with_timeout(Duration::from_millis(10), || {
            std::thread::sleep(Duration::from_millis(50));
            Ok(())
        })
        .await;
    assert!(matches!(timed_out, Err(AppError::Timeout(_))));
    // The timed-out blocking task is deliberately detached and keeps the gate until
    // the OS call returns. Let this deterministic stand-in release it for other tests.
    tokio::time::sleep(Duration::from_millis(60)).await;
}

fn analysis_runner_capability_account(
    user_id: &str,
    workspace_id: Uuid,
    device_id: Uuid,
    runner_id: Uuid,
) -> AppResult<String> {
    let user_id = Uuid::parse_str(user_id)
        .map_err(|_| AppError::Config("workspace account id is invalid".into()))?;
    Ok(format!(
        "analysis-runner-capability:v1:{user_id}:{workspace_id}:{device_id}:{runner_id}"
    ))
}

fn store_analysis_runner_capability_account(account: &str, capability: &str) -> AppResult<()> {
    #[cfg(feature = "packaged-benchmark")]
    {
        let _ = (account, capability);
        Err(AppError::Blocked {
            reason: "Analysis runner possession requires the operating system credential store"
                .into(),
        })
    }
    #[cfg(not(feature = "packaged-benchmark"))]
    {
        entry(account)?.set_password(capability)?;
        remember_secret(account, capability);
        Ok(())
    }
}

fn fetch_analysis_runner_capability_account(account: &str) -> AppResult<Option<String>> {
    if let Some(capability) = cached_secret(account) {
        return Ok(Some(capability));
    }
    #[cfg(feature = "packaged-benchmark")]
    {
        Err(AppError::Blocked {
            reason: "Analysis runner possession requires the operating system credential store"
                .into(),
        })
    }
    #[cfg(not(feature = "packaged-benchmark"))]
    match entry(account)?.get_password() {
        Ok(capability) => {
            remember_secret(account, &capability);
            Ok(Some(capability))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn delete_analysis_runner_capability_account(account: &str) -> AppResult<()> {
    forget_secret(account);
    #[cfg(feature = "packaged-benchmark")]
    return Ok(());
    #[cfg(not(feature = "packaged-benchmark"))]
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// Persist one Analysis runner possession capability in the OS credential store.
/// The raw capability never enters SQLite, IPC, logs, or workspace metadata.
pub(crate) fn store_analysis_runner_capability(
    user_id: &str,
    workspace_id: Uuid,
    device_id: Uuid,
    runner_id: Uuid,
    capability: &str,
) -> AppResult<()> {
    if capability.len() != 64
        || !capability
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AppError::Config(
            "Analysis runner capability is invalid".into(),
        ));
    }
    store_analysis_runner_capability_account(
        &analysis_runner_capability_account(user_id, workspace_id, device_id, runner_id)?,
        capability,
    )
}

/// Load one Analysis runner possession capability without exposing it to the webview.
pub(crate) fn fetch_analysis_runner_capability(
    user_id: &str,
    workspace_id: Uuid,
    device_id: Uuid,
    runner_id: Uuid,
) -> AppResult<Option<Zeroizing<String>>> {
    let capability = fetch_analysis_runner_capability_account(
        &analysis_runner_capability_account(user_id, workspace_id, device_id, runner_id)?,
    )?;
    match capability {
        Some(capability)
            if capability.len() == 64
                && capability
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) =>
        {
            Ok(Some(Zeroizing::new(capability)))
        }
        Some(_) => {
            delete_analysis_runner_capability_account(&analysis_runner_capability_account(
                user_id,
                workspace_id,
                device_id,
                runner_id,
            )?)?;
            Ok(None)
        }
        None => Ok(None),
    }
}

pub(crate) fn delete_analysis_runner_capability(
    user_id: &str,
    workspace_id: Uuid,
    device_id: Uuid,
    runner_id: Uuid,
) -> AppResult<()> {
    delete_analysis_runner_capability_account(&analysis_runner_capability_account(
        user_id,
        workspace_id,
        device_id,
        runner_id,
    )?)
}

/// Device-bound key for encrypted, local-only Analysis Article result recovery.
/// The key never enters SQLite, IPC, workspace sync, logs, or an Agent process.
pub(crate) fn analysis_result_cache_key() -> AppResult<Zeroizing<[u8; 32]>> {
    let secret = match fetch_workspace_session_account(ANALYSIS_RESULT_CACHE_KEY_ACCOUNT)? {
        Some(secret) => secret,
        None => {
            let mut generated = Zeroizing::new([0_u8; 32]);
            getrandom::fill(generated.as_mut()).map_err(|_| {
                AppError::Config("operating system random source is unavailable".into())
            })?;
            let secret = hex::encode(generated.as_ref());
            store_workspace_session_account(ANALYSIS_RESULT_CACHE_KEY_ACCOUNT, &secret)?;
            secret
        }
    };
    let mut key = Zeroizing::new([0_u8; 32]);
    hex::decode_to_slice(secret, key.as_mut()).map_err(|_| {
        AppError::Config("stored Analysis Article result cache key is invalid".into())
    })?;
    Ok(key)
}

fn knowledge_source_root_account(source_id: Uuid) -> String {
    format!("knowledge-source-root:{source_id}")
}

/// Local Folder roots are device capabilities, not workspace metadata. Persist the
/// canonical root only in the OS credential store under the source UUID.
pub(crate) fn store_knowledge_source_root(
    source_id: Uuid,
    root: &std::path::Path,
) -> AppResult<()> {
    let canonical = std::fs::canonicalize(root)?;
    if !canonical.is_dir() {
        return Err(AppError::Config(
            "the Project Knowledge root is not a directory".into(),
        ));
    }
    let value = canonical
        .to_str()
        .ok_or_else(|| AppError::Config("the Project Knowledge root is not Unicode".into()))?;
    store_workspace_session_account(&knowledge_source_root_account(source_id), value)
}

pub(crate) fn fetch_knowledge_source_root(
    source_id: Uuid,
) -> AppResult<Option<std::path::PathBuf>> {
    let Some(value) = fetch_workspace_session_account(&knowledge_source_root_account(source_id))?
    else {
        return Ok(None);
    };
    let root = std::path::PathBuf::from(value);
    let canonical = std::fs::canonicalize(&root)?;
    if canonical != root || !canonical.is_dir() {
        return Err(AppError::Blocked {
            reason: "the Project Knowledge root capability changed".into(),
        });
    }
    Ok(Some(root))
}

pub(crate) fn delete_knowledge_source_root(source_id: Uuid) -> AppResult<()> {
    delete_workspace_session_account(&knowledge_source_root_account(source_id))
}

// ---------------------------------------------------------------------------
// DEBUG-ONLY credential store. Obfuscated, NOT encrypted with a real key.
// ponytail: XOR-with-static-key obfuscation. Ceiling: not secure against anyone
// with file read access — it only stops a casual `cat`. Upgrade path is a signed
// build so the OS credential store works and this whole section is dead.
// ---------------------------------------------------------------------------

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
const OBFUSCATION_KEY: &[u8] = b"dopedb-dev-only-not-secure-v1";

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn fallback_dir() -> AppResult<std::path::PathBuf> {
    let dir = crate::app_paths::data_root()?.join("dev-secrets");
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(dir)
}

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn fallback_path_in(dir: &std::path::Path, account: &str) -> std::path::PathBuf {
    let filename = if Uuid::parse_str(account).is_ok() {
        account.to_owned()
    } else {
        format!("account-{}", hex::encode(account.as_bytes()))
    };
    dir.join(format!("{filename}.secret"))
}

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn xor(bytes: &[u8]) -> Vec<u8> {
    bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect()
}

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn file_store(account: &str, secret: &str) -> AppResult<()> {
    file_store_at(&fallback_dir()?, account, secret)
}

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn file_store_at(dir: &std::path::Path, account: &str, secret: &str) -> AppResult<()> {
    let obfuscated = hex::encode(xor(secret.as_bytes()));
    let path = fallback_path_in(dir, account);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        std::io::Write::write_all(&mut file, obfuscated.as_bytes())?;
        file.sync_all()?;
    }
    #[cfg(not(unix))]
    std::fs::write(path, obfuscated)?;
    Ok(())
}

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn file_fetch(account: &str) -> AppResult<String> {
    file_fetch_at(&fallback_dir()?, account)
}

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn file_fetch_at(dir: &std::path::Path, account: &str) -> AppResult<String> {
    let path = fallback_path_in(dir, account);
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| AppError::NotFound(format!("no secret for account {account}")))?;
    let bytes = hex::decode(raw.trim())
        .map_err(|e| AppError::Config(format!("corrupt dev secret: {e}")))?;
    String::from_utf8(xor(&bytes)).map_err(|e| AppError::Config(format!("corrupt dev secret: {e}")))
}

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn file_delete(account: &str) -> AppResult<()> {
    file_delete_at(&fallback_dir()?, account)
}

#[cfg(any(debug_assertions, feature = "packaged-benchmark"))]
fn file_delete_at(dir: &std::path::Path, account: &str) -> AppResult<()> {
    let path = fallback_path_in(dir, account);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}
