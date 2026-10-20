//! One official-CLI selection policy for readiness probes and ACP launches.
//! Respect the inherited PATH before GUI fallbacks, and resolve mise shims to
//! the selected CLI file so launch verification pins the CLI, not mise itself.

use std::collections::BTreeSet;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::time::Duration;

use dopedb_protocol::AcpPluginId;

use super::super::domain::AgentProvider;

pub(crate) fn provider_executable_search_path() -> OsString {
    provider_search_path(
        std::env::var_os("PATH").as_deref(),
        crate::app_paths::optional_home_dir().as_deref(),
        &crate::cli_environment::executable_search_path(None),
    )
}

fn provider_search_path(
    inherited: Option<&OsStr>,
    home: Option<&Path>,
    fallback: &OsStr,
) -> OsString {
    let mut directories = inherited
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    // Finder does not inherit the interactive shell PATH. These are selected
    // user installations, not a scan for whichever installed version is newest.
    if let Some(home) = home {
        for relative in [
            ".local/bin",
            ".local/share/mise/shims",
            ".volta/bin",
            ".asdf/shims",
        ] {
            directories.push(home.join(relative));
        }
    }
    directories.extend(std::env::split_paths(fallback));
    let mut seen = BTreeSet::new();
    directories.retain(|directory| {
        let key = directory.as_os_str().to_string_lossy();
        let key = if cfg!(windows) {
            key.to_lowercase()
        } else {
            key.into_owned()
        };
        directory.is_absolute() && seen.insert(key)
    });
    std::env::join_paths(directories).unwrap_or_default()
}

pub(crate) async fn resolve_provider_cli(
    provider: AgentProvider,
) -> Result<Option<PathBuf>, String> {
    let (name, plugin) = match provider {
        AgentProvider::Claude => ("claude", AcpPluginId::Claude),
        AgentProvider::Codex => ("codex", AcpPluginId::Codex),
    };
    let Some(candidate) =
        crate::cli_environment::find_in_path(&provider_executable_search_path(), name)
    else {
        return Ok(None);
    };
    let resolved =
        std::fs::canonicalize(&candidate).map_err(|_| "CLI path could not be resolved")?;
    if !is_mise_shim(&candidate, &resolved) {
        return Ok(Some(candidate));
    }

    // Never execute from a source repository: its .mise.toml must not select a
    // different CLI or run project hooks during a Desktop readiness check.
    let home = crate::app_paths::optional_home_dir().ok_or("CLI home directory is unavailable")?;
    let mut command = super::cli_probe::quiet_command(resolved);
    super::cli_probe::apply_probe_environment(&mut command, plugin);
    command.current_dir(home).args(["which", name]);
    let output = tokio::time::timeout(
        Duration::from_secs(4),
        tokio::process::Command::from(command)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "command timed out after 4000 ms resolving CLI shim")?
    .map_err(|_| "CLI shim resolver could not start")?;
    if !output.status.success() {
        return Err("CLI shim has no usable selected installation".into());
    }
    selected_mise_cli(&output.stdout, &candidate).map(Some)
}

fn is_mise_shim(candidate: &Path, resolved: &Path) -> bool {
    candidate.parent().and_then(Path::file_name) == Some(OsStr::new("shims"))
        && matches!(
            resolved.file_name().and_then(OsStr::to_str),
            Some("mise" | "mise.exe")
        )
}

fn selected_mise_cli(output: &[u8], shim: &Path) -> Result<PathBuf, String> {
    let text = std::str::from_utf8(output).map_err(|_| "CLI shim returned an invalid path")?;
    if text.len() > 8192 || text.trim().chars().any(char::is_control) {
        return Err("CLI shim returned an invalid path".into());
    }
    let selected = PathBuf::from(text.trim());
    if !selected.is_absolute() || selected == shim || selected.file_name() != shim.file_name() {
        return Err("CLI shim did not resolve to an absolute CLI installation".into());
    }
    let resolved = std::fs::canonicalize(&selected).map_err(|_| "Selected CLI is unavailable")?;
    if is_mise_shim(&selected, &resolved) {
        return Err("CLI shim resolved to another version-manager shim".into());
    }
    let parent = selected
        .parent()
        .ok_or("Selected CLI has no installation directory")?;
    let name = selected
        .file_name()
        .ok_or("Selected CLI has no executable name")?;
    let path = std::env::join_paths([parent]).map_err(|_| "Selected CLI has an invalid path")?;
    if crate::cli_environment::find_in_path(&path, &name.to_string_lossy()).as_ref()
        != Some(&selected)
    {
        return Err("Selected CLI is not executable".into());
    }
    Ok(selected)
}

#[cfg(test)]
pub(super) fn assert_cli_runtime_contract() {
    let root = if cfg!(windows) {
        Path::new("C:/fixture")
    } else {
        Path::new("/fixture")
    };
    let chosen = root.join("selected/bin");
    let fallback = root.join("system/bin");
    let inherited =
        std::env::join_paths([chosen.as_path(), Path::new("relative"), chosen.as_path()]).unwrap();
    let fallback_path = std::env::join_paths([fallback.as_path()]).unwrap();
    let path = provider_search_path(Some(&inherited), Some(root), &fallback_path);
    let directories = std::env::split_paths(&path).collect::<Vec<_>>();
    assert_eq!(directories.first(), Some(&chosen));
    assert_eq!(directories.last(), Some(&fallback));
    assert_eq!(
        directories.iter().filter(|path| *path == &chosen).count(),
        1
    );
    assert!(directories.iter().all(|path| path.is_absolute()));
    let gui_path = provider_search_path(None, Some(root), &fallback_path);
    let gui = std::env::split_paths(&gui_path).collect::<Vec<_>>();
    assert!(
        gui.iter()
            .position(|path| path.ends_with("mise/shims"))
            .unwrap()
            < gui.iter().position(|path| path == &fallback).unwrap()
    );
    assert!(is_mise_shim(
        &root.join("mise/shims/codex"),
        &root.join("bin/mise")
    ));
    assert!(!is_mise_shim(
        &root.join("bin/codex"),
        &root.join("codex.js")
    ));
    for invalid in [
        b"relative/codex".as_slice(),
        b"/missing/codex\n/another/codex",
        b"\xff",
    ] {
        assert!(selected_mise_cli(invalid, &root.join("mise/shims/codex")).is_err());
    }
    // The verified launch descriptor must name the selected CLI file, never
    // the manager executable a symlink-based shim canonicalizes to.
    let fixture = tempfile::tempdir().unwrap();
    let selected = fixture.path().join("codex");
    std::fs::write(&selected, "official-cli-fixture").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&selected, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let shim = fixture.path().join("shims/codex");
    assert_eq!(
        selected_mise_cli(selected.to_str().unwrap().as_bytes(), &shim).unwrap(),
        selected
    );
    assert!(selected_mise_cli(fixture.path().to_str().unwrap().as_bytes(), &shim).is_err());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        std::fs::set_permissions(&selected, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(selected_mise_cli(selected.to_str().unwrap().as_bytes(), &shim).is_err());
    }
}
