use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use dopedb_protocol::{AcpPluginManifestV1, MAX_ACP_PLUGIN_UNPACKED_BYTES};
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

use super::verification::sha256_file;

const MAX_ARCHIVE_FILES: usize = 10_000;
const MAX_ARCHIVE_DEPTH: usize = 16;
const MAX_ARCHIVE_PATH_BYTES: usize = 4 * 1024;
const MAX_ARCHIVE_FILE_BYTES: u64 = 128 * 1024 * 1024;

pub(super) fn extract_verified_archive(
    archive_path: &Path,
    stage: &Path,
    manifest: &AcpPluginManifestV1,
) -> AppResult<String> {
    let stage_metadata = fs::symlink_metadata(stage)?;
    if !stage_metadata.file_type().is_dir() || fs::read_dir(stage)?.next().is_some() {
        return Err(AppError::Config(
            "the ACP plugin staging directory is not empty".into(),
        ));
    }

    let archive = File::open(archive_path)?;
    let decoder = GzDecoder::new(archive);
    let mut archive = tar::Archive::new(decoder);
    let mut seen = BTreeSet::new();
    let mut file_count = 0usize;
    let mut unpacked_bytes = 0u64;
    for entry in archive
        .entries()
        .map_err(|_| archive_error("the ACP plugin archive index is invalid"))?
    {
        let mut entry =
            entry.map_err(|_| archive_error("an ACP plugin archive entry is invalid"))?;
        file_count = file_count.saturating_add(1);
        if file_count > MAX_ARCHIVE_FILES {
            return Err(archive_error(
                "the ACP plugin archive contains too many entries",
            ));
        }
        let relative = entry
            .path()
            .map_err(|_| archive_error("an ACP plugin archive path is invalid"))?
            .into_owned();
        validate_relative_path(&relative)?;
        if relative == Path::new("installed.json") {
            return Err(archive_error("the ACP plugin archive uses a reserved path"));
        }
        let collision_key = collision_key(&relative)?;
        if !seen.insert(collision_key) {
            return Err(archive_error(
                "the ACP plugin archive contains duplicate or colliding paths",
            ));
        }
        let destination = stage.join(&relative);
        if !destination.starts_with(stage) {
            return Err(archive_error("an ACP plugin archive path escaped staging"));
        }
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            create_owned_directories(stage, &destination)?;
            continue;
        }
        if !entry_type.is_file() {
            return Err(archive_error(
                "ACP plugin archives may contain only regular files and directories",
            ));
        }
        let size = entry.size();
        if size > MAX_ARCHIVE_FILE_BYTES {
            return Err(archive_error("an ACP plugin archive file is too large"));
        }
        unpacked_bytes = unpacked_bytes
            .checked_add(size)
            .ok_or_else(|| archive_error("the ACP plugin archive size overflowed"))?;
        if unpacked_bytes > manifest.artifact.unpacked_bytes
            || unpacked_bytes > MAX_ACP_PLUGIN_UNPACKED_BYTES
        {
            return Err(archive_error(
                "the ACP plugin archive exceeds its unpacked size budget",
            ));
        }
        let parent = destination
            .parent()
            .ok_or_else(|| archive_error("an ACP plugin archive file has no parent"))?;
        create_owned_directories(stage, parent)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)?;
        let copied = io::copy(
            &mut entry.by_ref().take(size.saturating_add(1)),
            &mut output,
        )?;
        if copied != size {
            return Err(archive_error(
                "an ACP plugin archive file did not match its declared size",
            ));
        }
        output.sync_all()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(0o600))?;
        }
    }

    let entrypoint = checked_stage_file(stage, &manifest.adapter_entrypoint)?;
    if fs::metadata(&entrypoint)?.len() == 0 {
        return Err(archive_error("the ACP plugin adapter entrypoint is empty"));
    }
    let sbom = checked_stage_file(stage, "sbom.spdx.json")?;
    if sha256_file(&sbom)? != manifest.sbom_sha256 {
        return Err(archive_error("the ACP plugin SBOM digest does not match"));
    }
    for license in &manifest.licenses {
        checked_stage_file(stage, &license.path)?;
    }
    verify_content_tree(stage, &manifest.content_sha256)?;
    sha256_file(&entrypoint)
}

pub(super) fn verify_content_tree(root: &Path, expected_sha256: &str) -> AppResult<()> {
    if content_tree_sha256(root)? != expected_sha256 {
        return Err(archive_error(
            "the ACP plugin content tree digest does not match",
        ));
    }
    Ok(())
}

fn content_tree_sha256(root: &Path) -> AppResult<String> {
    let metadata = fs::symlink_metadata(root)?;
    if !metadata.file_type().is_dir() {
        return Err(archive_error(
            "the ACP plugin content root is not a directory",
        ));
    }
    let mut files = BTreeMap::<String, (u64, String)>::new();
    let mut collisions = BTreeSet::new();
    collect_content_files(root, root, &mut files, &mut collisions)?;
    let mut hasher = Sha256::new();
    for (path, (bytes, sha256)) in files {
        let path = path.as_bytes();
        hasher.update((path.len() as u64).to_be_bytes());
        hasher.update(path);
        hasher.update(bytes.to_be_bytes());
        let digest = hex::decode(sha256)
            .map_err(|_| archive_error("an ACP plugin content digest is invalid"))?;
        hasher.update(digest);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn collect_content_files(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, (u64, String)>,
    collisions: &mut BTreeSet<String>,
) -> AppResult<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| archive_error("an ACP plugin content path escaped its root"))?;
        validate_relative_path(relative)?;
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            return Err(archive_error(
                "an ACP plugin content path is a symbolic link",
            ));
        }
        if metadata.file_type().is_dir() {
            collect_content_files(root, &path, files, collisions)?;
            continue;
        }
        if !metadata.file_type().is_file() {
            return Err(archive_error(
                "an ACP plugin content path has an unsupported type",
            ));
        }
        if relative == Path::new("installed.json") {
            continue;
        }
        if metadata.len() > MAX_ARCHIVE_FILE_BYTES {
            return Err(archive_error(
                "an ACP plugin content file has an invalid size",
            ));
        }
        if files.len() >= MAX_ARCHIVE_FILES {
            return Err(archive_error(
                "the ACP plugin content tree contains too many files",
            ));
        }
        let normalized = relative
            .to_str()
            .ok_or_else(|| archive_error("an ACP plugin content path is not Unicode"))?
            .replace('\\', "/");
        let key = if cfg!(any(target_os = "macos", windows)) {
            normalized.to_lowercase()
        } else {
            normalized.clone()
        };
        if !collisions.insert(key) {
            return Err(archive_error(
                "the ACP plugin content tree has colliding paths",
            ));
        }
        files.insert(normalized, (metadata.len(), sha256_file(&path)?));
    }
    let total = files.values().try_fold(0u64, |total, (bytes, _)| {
        total
            .checked_add(*bytes)
            .ok_or_else(|| archive_error("the ACP plugin content size overflowed"))
    })?;
    if total > MAX_ACP_PLUGIN_UNPACKED_BYTES {
        return Err(archive_error("the ACP plugin content tree is too large"));
    }
    Ok(())
}

pub(super) fn checked_stage_file(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let relative = Path::new(relative);
    validate_relative_path(relative)?;
    let path = root.join(relative);
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() {
        return Err(archive_error(
            "an expected ACP plugin file is not a regular file",
        ));
    }
    Ok(path)
}

fn create_owned_directories(root: &Path, target: &Path) -> AppResult<()> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| archive_error("an ACP plugin directory escaped staging"))?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err(archive_error("an ACP plugin directory path is unsafe"));
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_dir() => {}
            Ok(_) => {
                return Err(archive_error(
                    "an ACP plugin directory path collides with a non-directory",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::create_dir(&current)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&current, fs::Permissions::from_mode(0o700))?;
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn validate_relative_path(path: &Path) -> AppResult<()> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.to_string_lossy().len() > MAX_ARCHIVE_PATH_BYTES
        || path.components().count() > MAX_ARCHIVE_DEPTH
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || path.to_string_lossy().chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '\u{061c}'
                        | '\u{200e}'
                        | '\u{200f}'
                        | '\u{202a}'..='\u{202e}'
                        | '\u{2066}'..='\u{2069}'
                        | '\u{feff}'
                )
        })
    {
        return Err(archive_error("an ACP plugin archive path is unsafe"));
    }
    Ok(())
}

fn collision_key(path: &Path) -> AppResult<String> {
    let value = path
        .to_str()
        .ok_or_else(|| archive_error("an ACP plugin archive path is not Unicode"))?;
    if cfg!(any(target_os = "macos", windows)) {
        Ok(value.to_lowercase())
    } else {
        Ok(value.to_owned())
    }
}

fn archive_error(message: &str) -> AppError {
    AppError::Blocked {
        reason: message.into(),
    }
}

#[cfg(test)]
pub(super) fn assert_archive_security_contract() {
    use dopedb_protocol::{
        AcpPluginArtifact, AcpPluginCompatibility, AcpPluginId, AcpPluginLicense,
        AcpPluginProvider, AcpPluginUpstream, ACP_PLUGIN_MANIFEST_SCHEMA_VERSION,
    };
    use flate2::write::GzEncoder;
    use flate2::Compression;

    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    fs::create_dir_all(source.join("dist")).unwrap();
    fs::create_dir_all(source.join("licenses")).unwrap();
    fs::write(source.join("dist/index.js"), b"console.log('fixture')").unwrap();
    fs::write(
        source.join("sbom.spdx.json"),
        b"{\"spdxVersion\":\"SPDX-2.3\"}",
    )
    .unwrap();
    fs::write(source.join("licenses/NOTICE.txt"), b"fixture license").unwrap();
    let content_sha256 = content_tree_sha256(&source).unwrap();
    let sbom_sha256 = sha256_file(&source.join("sbom.spdx.json")).unwrap();
    let archive_path = temp.path().join("plugin.tar.gz");
    let output = File::create(&archive_path).unwrap();
    let encoder = GzEncoder::new(output, Compression::default());
    let mut builder = tar::Builder::new(encoder);
    for relative in ["dist/index.js", "sbom.spdx.json", "licenses/NOTICE.txt"] {
        builder
            .append_path_with_name(source.join(relative), relative)
            .unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap();
    let unpacked_bytes = fs::read(source.join("dist/index.js")).unwrap().len()
        + fs::read(source.join("sbom.spdx.json")).unwrap().len()
        + fs::read(source.join("licenses/NOTICE.txt")).unwrap().len();
    let manifest = AcpPluginManifestV1 {
        schema_version: ACP_PLUGIN_MANIFEST_SCHEMA_VERSION,
        plugin_id: AcpPluginId::Claude,
        provider: AcpPluginProvider::Claude,
        adapter_version: "0.63.0".into(),
        adapter_bundle_version: "1.0.0".into(),
        adapter_entrypoint: "dist/index.js".into(),
        upstream: AcpPluginUpstream {
            repository: AcpPluginId::Claude.upstream_repository().into(),
            tag: "v0.63.0".into(),
            commit: "ab".repeat(20),
        },
        compatibility: AcpPluginCompatibility {
            acp_protocol_min: "2025-11-25".into(),
            acp_protocol_max: "2025-11-25".into(),
            node_version_min: "24.0.0".into(),
            node_version_max: "24.99.99".into(),
            dopedb_version_min: "0.3.0".into(),
            dopedb_version_max: "0.3.99".into(),
        },
        artifact: AcpPluginArtifact {
            url: "https://github.com/json-choi/dopedb/releases/download/acp-bundle-fixture/claude.tar.gz".into(),
            sha256: sha256_file(&archive_path).unwrap(),
            signature: "fixture".into(),
            key_id: "fixture".into(),
            packed_bytes: fs::metadata(&archive_path).unwrap().len(),
            unpacked_bytes: unpacked_bytes as u64,
        },
        licenses: vec![AcpPluginLicense {
            name: "fixture".into(),
            path: "licenses/NOTICE.txt".into(),
        }],
        sbom_sha256,
        content_sha256: content_sha256.clone(),
        released_at: "2026-08-08T00:00:00Z".into(),
        revoked_at: None,
        rollout_basis_points: 10_000,
    };
    assert!(super::verification::verify_app_compatibility(&manifest).is_err());
    let mut compatible = manifest.clone();
    compatible.compatibility.dopedb_version_min = env!("CARGO_PKG_VERSION").into();
    compatible.compatibility.dopedb_version_max = env!("CARGO_PKG_VERSION").into();
    assert!(super::verification::verify_app_compatibility(&compatible).is_ok());
    compatible.compatibility.dopedb_version_min = "999.0.0".into();
    compatible.compatibility.dopedb_version_max = "999.99.99".into();
    assert!(super::verification::verify_app_compatibility(&compatible).is_err());
    let stage = temp.path().join("stage");
    fs::create_dir(&stage).unwrap();
    assert!(!extract_verified_archive(&archive_path, &stage, &manifest)
        .unwrap()
        .is_empty());
    verify_content_tree(&stage, &content_sha256).unwrap();
    fs::write(stage.join("dist/index.js"), b"tampered").unwrap();
    assert!(verify_content_tree(&stage, &content_sha256).is_err());

    let linked_archive = temp.path().join("linked.tar.gz");
    let encoder = GzEncoder::new(
        File::create(&linked_archive).unwrap(),
        Compression::default(),
    );
    let mut builder = tar::Builder::new(encoder);
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_mode(0o777);
    header.set_size(0);
    header.set_cksum();
    builder
        .append_link(&mut header, "link", "dist/index.js")
        .unwrap();
    builder.into_inner().unwrap().finish().unwrap();
    let linked_stage = temp.path().join("linked-stage");
    fs::create_dir(&linked_stage).unwrap();
    assert!(extract_verified_archive(&linked_archive, &linked_stage, &manifest).is_err());
}
