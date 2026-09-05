use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use dopedb_protocol::{AcpPluginManifestV1, SignedAcpPluginManifestV1};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const ACP_PLUGIN_PUBLIC_KEY: &str =
    include_str!("../../../../resources/agent-runtime/acp-plugin.pub");
const NODE_RUNTIME_CATALOG: &str =
    include_str!("../../../../resources/agent-runtime/runtime-catalog.json");
pub(super) const ACP_PLUGIN_KEY_ID: &str = "71F10E6488C84C71";
const ACP_PROTOCOL_VERSION: &str = "2025-11-25";
const MAX_RUNTIME_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_BUNDLED_NODE_BYTES: u64 = 130 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(super) struct VerifiedNodeRuntime {
    pub(super) version: Version,
    pub(super) executable: PathBuf,
    pub(super) executable_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NodeRuntimeCatalog {
    schema_version: u16,
    runtime: String,
    version: String,
    release_line: String,
    released_at: String,
    license: String,
    source: String,
    platforms: std::collections::BTreeMap<String, NodeRuntimeCatalogEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NodeRuntimeCatalogEntry {
    archive: String,
    archive_sha256: String,
    archive_bytes: u64,
    executable: String,
    license_file: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NodeRuntimeManifest {
    schema_version: u16,
    runtime: String,
    version: String,
    release_line: String,
    target_triple: String,
    executable: String,
    executable_sha256: String,
    executable_bytes: u64,
    archive: String,
    archive_sha256: String,
    source_url: String,
    license: String,
    license_file: String,
    sbom_file: String,
    sbom_sha256: String,
}

pub(super) fn verify_manifest(envelope: &SignedAcpPluginManifestV1) -> AppResult<Vec<u8>> {
    if !envelope.validate_shape()
        || envelope.key_id != ACP_PLUGIN_KEY_ID
        || envelope.manifest.artifact.key_id != ACP_PLUGIN_KEY_ID
    {
        return Err(signature_error(
            "the ACP plugin manifest shape or key is invalid",
        ));
    }
    if envelope.manifest.revoked_at.is_some() {
        return Err(AppError::Blocked {
            reason: "this ACP plugin release has been revoked".into(),
        });
    }
    let bytes = serde_json::to_vec(&envelope.manifest)?;
    if sha256_bytes(&bytes) != envelope.manifest_sha256 {
        return Err(signature_error(
            "the ACP plugin manifest digest does not match",
        ));
    }
    verify_minisign(&bytes, &envelope.signature)?;
    Ok(bytes)
}

pub(super) fn verify_compatibility(
    manifest: &AcpPluginManifestV1,
    runtime: &VerifiedNodeRuntime,
) -> AppResult<()> {
    let node_min = parse_version(&manifest.compatibility.node_version_min, "minimum Node")?;
    let node_max = parse_version(&manifest.compatibility.node_version_max, "maximum Node")?;
    if runtime.version < node_min || runtime.version > node_max {
        return Err(AppError::Blocked {
            reason: format!(
                "ACP plugin {} does not support bundled Node {}",
                manifest.plugin_id.as_str(),
                runtime.version
            ),
        });
    }
    if ACP_PROTOCOL_VERSION < manifest.compatibility.acp_protocol_min.as_str()
        || ACP_PROTOCOL_VERSION > manifest.compatibility.acp_protocol_max.as_str()
    {
        return Err(AppError::Blocked {
            reason: "the ACP plugin protocol range is incompatible with this app".into(),
        });
    }
    verify_app_compatibility(manifest)
}

pub(super) fn verify_app_compatibility(manifest: &AcpPluginManifestV1) -> AppResult<()> {
    let app = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|_| AppError::Config("the app version is not valid semver".into()))?;
    let app_min = parse_version(&manifest.compatibility.dopedb_version_min, "minimum DopeDB")?;
    let app_max = parse_version(&manifest.compatibility.dopedb_version_max, "maximum DopeDB")?;
    if app < app_min || app > app_max {
        return Err(AppError::Blocked {
            reason: format!(
                "update the ACP adapter for DopeDB {app}; this adapter supports {app_min} through {app_max}"
            ),
        });
    }
    Ok(())
}

pub(super) fn verify_artifact(path: &Path, manifest: &AcpPluginManifestV1) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.len() != manifest.artifact.packed_bytes {
        return Err(signature_error(
            "the ACP plugin artifact size does not match",
        ));
    }
    let signature = Signature::decode(&manifest.artifact.signature)
        .map_err(|_| signature_error("the ACP plugin artifact signature is malformed"))?;
    let public_key = public_key()?;
    let mut verifier = public_key
        .verify_stream(&signature)
        .map_err(|_| signature_error("the ACP plugin artifact signature is invalid"))?;
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        verifier.update(&buffer[..read]);
    }
    if hex::encode(hasher.finalize()) != manifest.artifact.sha256 {
        return Err(signature_error(
            "the ACP plugin artifact digest does not match",
        ));
    }
    verifier
        .finalize()
        .map_err(|_| signature_error("the ACP plugin artifact signature is invalid"))
}

pub(super) fn verify_bundled_node(app: &AppHandle) -> AppResult<VerifiedNodeRuntime> {
    let catalog: NodeRuntimeCatalog = serde_json::from_str(NODE_RUNTIME_CATALOG)?;
    let target = host_target_triple().ok_or_else(|| {
        AppError::Config("the current platform has no bundled Node runtime".into())
    })?;
    let catalog_entry = catalog.platforms.get(target).ok_or_else(|| {
        AppError::Config("the current target is missing from the Node runtime catalog".into())
    })?;
    if catalog.schema_version != 1
        || catalog.runtime != "node"
        || catalog.release_line.is_empty()
        || catalog.released_at.is_empty()
        || catalog.license != "MIT"
        || !catalog.source.starts_with("https://nodejs.org/dist/")
        || catalog_entry.archive_bytes == 0
        || catalog_entry.archive_bytes > 60 * 1024 * 1024
        || catalog_entry.executable.contains("..")
        || catalog_entry.license_file.contains("..")
    {
        return Err(AppError::Config(
            "the bundled Node runtime catalog is invalid".into(),
        ));
    }

    let relative_root = format!("resources/agent-runtime/node/{target}");
    let manifest_path = app
        .path()
        .resolve(
            format!("{relative_root}/manifest.json"),
            BaseDirectory::Resource,
        )
        .map_err(|_| AppError::Config("the bundled Node manifest path is unavailable".into()))?;
    let manifest_metadata = fs::symlink_metadata(&manifest_path)?;
    if !manifest_metadata.file_type().is_file()
        || manifest_metadata.len() == 0
        || manifest_metadata.len() > MAX_RUNTIME_MANIFEST_BYTES
    {
        return Err(AppError::Config(
            "the bundled Node manifest is invalid".into(),
        ));
    }
    let manifest: NodeRuntimeManifest = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    if manifest.schema_version != 1
        || manifest.runtime != "node"
        || manifest.version != catalog.version
        || manifest.release_line != catalog.release_line
        || manifest.target_triple != target
        || manifest.archive != catalog_entry.archive
        || manifest.archive_sha256 != catalog_entry.archive_sha256
        || manifest.license != catalog.license
        || manifest.source_url != format!("{}{}", catalog.source, catalog_entry.archive)
        || manifest.executable_bytes == 0
        || manifest.executable_bytes > MAX_BUNDLED_NODE_BYTES
    {
        return Err(AppError::Config(
            "the bundled Node manifest does not match its catalog".into(),
        ));
    }

    let root = manifest_path.parent().ok_or_else(|| {
        AppError::Config("the bundled Node manifest has no parent directory".into())
    })?;
    let executable = checked_child(root, &manifest.executable)?;
    let license = checked_child(root, &manifest.license_file)?;
    let sbom = checked_child(root, &manifest.sbom_file)?;
    let executable_metadata = fs::symlink_metadata(&executable)?;
    if !executable_metadata.file_type().is_file()
        || executable_metadata.len() != manifest.executable_bytes
        || executable_metadata.len() > MAX_BUNDLED_NODE_BYTES
        || sha256_file(&executable)? != manifest.executable_sha256
        || !fs::symlink_metadata(&license)?.file_type().is_file()
        || !fs::symlink_metadata(&sbom)?.file_type().is_file()
        || sha256_file(&sbom)? != manifest.sbom_sha256
    {
        return Err(AppError::Config(
            "the bundled Node runtime verification failed".into(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if executable_metadata.permissions().mode() & 0o111 == 0 {
            return Err(AppError::Config(
                "the bundled Node runtime is not executable".into(),
            ));
        }
    }
    Ok(VerifiedNodeRuntime {
        version: Version::parse(&manifest.version)
            .map_err(|_| AppError::Config("the bundled Node version is invalid".into()))?,
        executable,
        executable_sha256: manifest.executable_sha256,
    })
}

pub(super) fn sha256_file(path: &Path) -> AppResult<String> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() {
        return Err(AppError::Blocked {
            reason: "a runtime file is not a regular file".into(),
        });
    }
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn verify_minisign(bytes: &[u8], encoded: &str) -> AppResult<()> {
    let signature = Signature::decode(encoded)
        .map_err(|_| signature_error("the ACP plugin manifest signature is malformed"))?;
    public_key()?
        .verify(bytes, &signature, false)
        .map_err(|_| signature_error("the ACP plugin manifest signature is invalid"))
}

fn public_key() -> AppResult<PublicKey> {
    PublicKey::decode(ACP_PLUGIN_PUBLIC_KEY)
        .map_err(|_| AppError::Config("the bundled ACP plugin public key is invalid".into()))
}

fn checked_child(root: &Path, relative: &str) -> AppResult<PathBuf> {
    if relative.is_empty()
        || Path::new(relative).is_absolute()
        || Path::new(relative)
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(AppError::Config("a runtime manifest path is unsafe".into()));
    }
    let path = root.join(relative);
    if path.parent().is_none_or(|parent| !parent.starts_with(root)) {
        return Err(AppError::Config(
            "a runtime manifest path escaped its root".into(),
        ));
    }
    Ok(path)
}

fn parse_version(value: &str, label: &str) -> AppResult<Version> {
    Version::parse(value).map_err(|_| AppError::Config(format!("the {label} version is invalid")))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn signature_error(message: &str) -> AppError {
    AppError::Blocked {
        reason: message.into(),
    }
}

pub(super) fn host_target_triple() -> Option<&'static str> {
    match (std::env::consts::ARCH, std::env::consts::OS) {
        ("aarch64", "macos") => Some("aarch64-apple-darwin"),
        ("x86_64", "macos") => Some("x86_64-apple-darwin"),
        ("x86_64", "windows") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    }
}
