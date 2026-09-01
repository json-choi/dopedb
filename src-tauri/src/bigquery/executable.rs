//! Audited BigQuery SDK executable discovery and bounded process I/O.

use super::*;

impl ExecutableIdentity {
    async fn audit_named(
        path: &Path,
        allowed_root: &Path,
        allowed_names: &[&str],
    ) -> Result<Self, CommandFailure> {
        let canonical_path = tokio::fs::canonicalize(path)
            .await
            .map_err(|_| CommandFailure::Unavailable)?;
        let canonical_root = tokio::fs::canonicalize(allowed_root)
            .await
            .map_err(|_| CommandFailure::Unavailable)?;
        if !canonical_path.starts_with(&canonical_root)
            || canonical_path
                .file_name()
                .and_then(|name| name.to_str())
                .is_none_or(|name| !allowed_names.contains(&name))
        {
            return Err(CommandFailure::Unavailable);
        }
        let (sha256, byte_length) = hash_regular_file(&canonical_path).await?;
        Ok(Self {
            canonical_path,
            sha256,
            byte_length,
        })
    }

    pub(super) async fn revalidate(&self) -> Result<PathBuf, CommandFailure> {
        let canonical = tokio::fs::canonicalize(&self.canonical_path)
            .await
            .map_err(|_| CommandFailure::Changed)?;
        if canonical != self.canonical_path {
            return Err(CommandFailure::Changed);
        }
        let (sha256, byte_length) = hash_regular_file(&canonical).await?;
        if sha256 != self.sha256 || byte_length != self.byte_length {
            return Err(CommandFailure::Changed);
        }
        Ok(canonical)
    }
}

pub(super) async fn discover_executable() -> AppResult<ResolvedSdkExecutable> {
    discover_sdk_executable(&["bq", "bq.cmd"], "BigQuery CLI").await
}

pub(super) async fn discover_sdk_executable(
    allowed_names: &[&str],
    label: &str,
) -> AppResult<ResolvedSdkExecutable> {
    let file_name = if cfg!(windows) {
        allowed_names
            .iter()
            .find(|name| name.ends_with(".cmd"))
            .copied()
    } else {
        allowed_names
            .iter()
            .find(|name| !name.ends_with(".cmd"))
            .copied()
    }
    .ok_or_else(|| AppError::Config(format!("the {label} executable name is invalid")))?;
    for root in sdk_roots() {
        let candidate = root.join("bin").join(file_name);
        if !candidate.is_file() {
            continue;
        }
        if let Ok(identity) =
            ExecutableIdentity::audit_named(&candidate, &root, allowed_names).await
        {
            return Ok(ResolvedSdkExecutable {
                identity,
                environment: runtime::command_environment_for_sdk_root(&root),
            });
        }
    }
    Err(AppError::Config(format!(
        "{label} is unavailable; reconnect so DopeDB can prepare the official Google tools"
    )))
}

pub(super) fn sdk_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.extend([
            home.join("google-cloud-sdk"),
            home.join(".local/share/google-cloud-sdk"),
            home.join("Library/google-cloud-sdk"),
        ]);
    }
    #[cfg(not(windows))]
    roots.extend([
        PathBuf::from("/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk"),
        PathBuf::from("/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk"),
        PathBuf::from("/usr/lib/google-cloud-sdk"),
        PathBuf::from("/opt/google-cloud-sdk"),
    ]);
    #[cfg(windows)]
    if let Some(local) = dirs::data_local_dir() {
        roots.push(local.join("Google/Cloud SDK/google-cloud-sdk"));
    }
    if let Some(managed) = runtime::managed_sdk_root_if_ready() {
        roots.push(managed);
    }
    roots
}

async fn hash_regular_file(path: &Path) -> Result<(String, u64), CommandFailure> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|_| CommandFailure::Unavailable)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_EXECUTABLE_BYTES {
        return Err(CommandFailure::Unavailable);
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_| CommandFailure::Unavailable)?;
    if bytes.len() as u64 != metadata.len() {
        return Err(CommandFailure::Changed);
    }
    Ok((hex::encode(Sha256::digest(&bytes)), metadata.len()))
}

pub(super) async fn read_bounded<R: AsyncRead + Unpin>(
    mut reader: R,
    maximum: usize,
) -> Result<Vec<u8>, CommandFailure> {
    let mut output = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|_| CommandFailure::Output)?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > maximum {
            return Err(CommandFailure::Output);
        }
        output.extend_from_slice(&buffer[..count]);
    }
}
