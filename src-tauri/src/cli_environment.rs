//! Shared, credential-free CLI executable discovery for GUI-launched processes.

use std::collections::BTreeSet;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

pub(crate) fn executable_search_path(first: Option<&Path>) -> OsString {
    let mut directories = Vec::new();
    if let Some(first) = first {
        directories.push(first.to_path_buf());
    }

    #[cfg(not(windows))]
    directories.extend(
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
            .into_iter()
            .map(PathBuf::from),
    );

    let home = crate::app_paths::optional_home_dir();
    if let Some(home) = home.as_ref() {
        #[cfg(not(windows))]
        for relative in [
            ".local/bin",
            ".bun/bin",
            ".npm-global/bin",
            ".volta/bin",
            ".cargo/bin",
            ".local/share/pnpm",
            "Library/pnpm",
        ] {
            directories.push(home.join(relative));
        }

        #[cfg(windows)]
        {
            directories.push(home.join(".local/bin"));
            directories.push(home.join("AppData/Local/Programs/OpenAI/Codex/bin"));
            directories.push(home.join("AppData/Local/Microsoft/WindowsApps"));
            directories.push(home.join("AppData/Roaming/npm"));
            directories.push(home.join("AppData/Local/pnpm"));
            directories.push(home.join("AppData/Local/Volta/bin"));
        }
    }
    #[cfg(windows)]
    directories.extend(windows_cli_runtime_directories(home.as_deref(), |key| {
        std::env::var_os(key)
    }));
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path));
    }
    directories.extend(node_runtime_directories(home.as_deref()));

    let mut seen = BTreeSet::new();
    directories.retain(|directory| directory.is_absolute() && seen.insert(path_key(directory)));
    std::env::join_paths(&directories).unwrap_or_default()
}

/// npm and pnpm install `claude` and `codex` as shims that re-exec `node`, so a
/// search path that finds the shim but not the Node runtime fails after launch.
/// These come last, leaving an inherited PATH free to pick the active runtime.
#[cfg(windows)]
fn node_runtime_directories(_home: Option<&Path>) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    for variable in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = non_empty_var(variable) {
            directories.push(PathBuf::from(root).join("nodejs"));
        }
    }
    // nvm-windows keeps the selected runtime behind this symlink directory.
    if let Some(symlink) = non_empty_var("NVM_SYMLINK") {
        directories.push(PathBuf::from(symlink));
    }
    directories
}

/// A GUI launch never sources the shell profile that exposes a keg-only
/// Homebrew `node@N` or a version-manager runtime, so `#!/usr/bin/env node`
/// shims fail with exit 127 unless those install roots are enumerated here.
/// These come last, leaving an inherited PATH free to pick the active runtime.
#[cfg(not(windows))]
fn node_runtime_directories(home: Option<&Path>) -> Vec<PathBuf> {
    unix_node_runtime_directories(
        home,
        |key| std::env::var_os(key),
        directory_entries,
        |file| std::fs::read_to_string(file).ok(),
    )
    .into_iter()
    .filter(|directory| directory.is_dir())
    .collect()
}

#[cfg(not(windows))]
fn directory_entries(directory: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect()
}

#[cfg(windows)]
fn non_empty_var(name: &str) -> Option<OsString> {
    std::env::var_os(name).filter(|value| !value.is_empty())
}

pub(crate) fn find_executable(binary: &str) -> Option<PathBuf> {
    find_in_path(&executable_search_path(None), binary)
}

pub(crate) fn find_in_path(path: &OsStr, binary: &str) -> Option<PathBuf> {
    let names = binary_names(binary);
    std::env::split_paths(path)
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .find(|candidate| is_executable(candidate))
}

pub(crate) fn binary_names(binary: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        if Path::new(binary).extension().is_some() {
            return vec![binary.to_owned()];
        }
        ["exe", "cmd", "bat"]
            .into_iter()
            .map(|extension| format!("{binary}.{extension}"))
            .chain(std::iter::once(binary.to_owned()))
            .collect()
    }

    #[cfg(not(windows))]
    {
        vec![binary.to_owned()]
    }
}

fn is_executable(candidate: &Path) -> bool {
    let Ok(metadata) = candidate.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(windows)]
    {
        true
    }
}

#[cfg(windows)]
fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

#[cfg(not(windows))]
fn path_key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(any(windows, test))]
fn windows_cli_runtime_directories(
    home: Option<&Path>,
    mut environment: impl FnMut(&str) -> Option<OsString>,
) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(home) = home {
        directories.push(home.join(".volta/bin"));
        directories.push(home.join("AppData/Local/Programs/nodejs"));
        directories.push(home.join("AppData/Roaming/nvm"));
    }
    for variable in ["NVM_SYMLINK", "NVM_HOME", "FNM_MULTISHELL_PATH"] {
        if let Some(path) = environment(variable).filter(|value| !value.is_empty()) {
            directories.push(PathBuf::from(path));
        }
    }
    if let Some(path) = environment("VOLTA_HOME").filter(|value| !value.is_empty()) {
        directories.push(PathBuf::from(path).join("bin"));
    }
    if let Some(path) = environment("LOCALAPPDATA").filter(|value| !value.is_empty()) {
        directories.push(PathBuf::from(path).join("Programs/nodejs"));
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(path) = environment(variable).filter(|value| !value.is_empty()) {
            directories.push(PathBuf::from(path).join("nodejs"));
        }
    }
    directories
}

/// Enumerates every Node runtime `bin` directory a Unix package manager or
/// version manager can leave outside the shared bin directories. Explicit
/// selections (a version-manager default alias or shim directory) precede the
/// installed versions, which are ordered newest first.
#[cfg(any(not(windows), test))]
fn unix_node_runtime_directories(
    home: Option<&Path>,
    mut environment: impl FnMut(&str) -> Option<OsString>,
    directory_entries: impl Fn(&Path) -> Vec<PathBuf>,
    read_text: impl Fn(&Path) -> Option<String>,
) -> Vec<PathBuf> {
    let mut variable = |name: &str| {
        environment(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    let mut directories = Vec::new();

    // Keg-only Homebrew formulas such as `node@24` link only under `<prefix>/opt`.
    let mut homebrew_prefixes = vec![
        PathBuf::from("/opt/homebrew"),
        PathBuf::from("/usr/local"),
        PathBuf::from("/home/linuxbrew/.linuxbrew"),
    ];
    if let Some(prefix) = variable("HOMEBREW_PREFIX") {
        if !homebrew_prefixes.contains(&prefix) {
            homebrew_prefixes.insert(0, prefix);
        }
    }
    for prefix in homebrew_prefixes {
        // `opt/node` is whatever Homebrew treats as current, so it outranks
        // pinned `node@N` kegs even when the default formula is unlinked.
        directories.push(prefix.join("opt/node/bin"));
        let mut kegs = directory_entries(&prefix.join("opt"));
        kegs.retain(|keg| {
            keg.file_name()
                .and_then(OsStr::to_str)
                .is_some_and(|name| name.starts_with("node@"))
        });
        for keg in newest_first(kegs) {
            directories.push(keg.join("bin"));
        }
    }

    if let Some(root) = variable("NVM_DIR").or_else(|| home.map(|home| home.join(".nvm"))) {
        let mut versions = newest_first(directory_entries(&root.join("versions/node")));
        if let Some(index) = nvm_default_version(&root, &versions, &read_text) {
            let selected = versions.remove(index);
            versions.insert(0, selected);
        }
        directories.extend(versions.into_iter().map(|version| version.join("bin")));
    }

    if let Some(multishell) = variable("FNM_MULTISHELL_PATH") {
        directories.push(multishell.join("bin"));
    }
    let mut fnm_roots = variable("FNM_DIR").into_iter().collect::<Vec<_>>();
    if let Some(home) = home {
        fnm_roots.push(home.join(".fnm"));
        fnm_roots.push(home.join("Library/Application Support/fnm"));
        fnm_roots.push(home.join(".local/share/fnm"));
    }
    for root in fnm_roots {
        directories.push(root.join("aliases/default/bin"));
        for version in newest_first(directory_entries(&root.join("node-versions"))) {
            directories.push(version.join("installation/bin"));
        }
    }

    if let Some(volta) = variable("VOLTA_HOME") {
        directories.push(volta.join("bin"));
    }

    if let Some(root) = variable("ASDF_DATA_DIR").or_else(|| home.map(|home| home.join(".asdf"))) {
        directories.push(root.join("bin"));
        directories.push(root.join("shims"));
        for version in newest_first(directory_entries(&root.join("installs/nodejs"))) {
            directories.push(version.join("bin"));
        }
    }

    if let Some(root) =
        variable("MISE_DATA_DIR").or_else(|| home.map(|home| home.join(".local/share/mise")))
    {
        directories.push(root.join("shims"));
        for version in newest_first(directory_entries(&root.join("installs/node"))) {
            directories.push(version.join("bin"));
        }
    }

    if let Some(prefix) = variable("N_PREFIX") {
        directories.push(prefix.join("bin"));
    }

    if let Some(home) = home {
        directories.push(home.join(".nix-profile/bin"));
    }
    directories.extend(
        [
            "/nix/var/nix/profiles/default/bin",
            "/run/current-system/sw/bin",
            "/opt/local/bin",
        ]
        .into_iter()
        .map(PathBuf::from),
    );
    directories
}

/// Resolves `alias/default` the way nvm does: a version or version prefix
/// selects the newest matching install, and an alias name such as `lts/jod`
/// is followed through `alias/<name>` for a bounded number of hops.
#[cfg(any(not(windows), test))]
fn nvm_default_version(
    root: &Path,
    versions: &[PathBuf],
    read_text: &impl Fn(&Path) -> Option<String>,
) -> Option<usize> {
    let mut alias = read_text(&root.join("alias/default"))?;
    for _ in 0..4 {
        let target = alias.trim().trim_start_matches('v').to_owned();
        let matched = versions.iter().position(|version| {
            let name = version
                .file_name()
                .and_then(OsStr::to_str)
                .unwrap_or_default()
                .trim_start_matches('v');
            name == target || name.starts_with(&format!("{target}."))
        });
        if matched.is_some() {
            return matched;
        }
        alias = read_text(&root.join("alias").join(target))?;
    }
    None
}

#[cfg(any(not(windows), test))]
fn newest_first(mut directories: Vec<PathBuf>) -> Vec<PathBuf> {
    directories.sort_by(|left, right| {
        version_key(right)
            .cmp(&version_key(left))
            .then_with(|| right.cmp(left))
    });
    directories
}

/// Numeric components of a directory name such as `node@24` or `v22.10.0`,
/// so `v22.10.0` sorts above `v22.9.0`.
#[cfg(any(not(windows), test))]
fn version_key(directory: &Path) -> Vec<u64> {
    directory
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .split(|character: char| !character.is_ascii_digit())
        .filter_map(|component| component.parse().ok())
        .collect()
}

#[cfg(test)]
pub(crate) fn assert_cli_environment_contract() {
    let root = Path::new("/fixture/home");
    let directories = windows_cli_runtime_directories(Some(root), |key| match key {
        "NVM_SYMLINK" => Some(OsString::from("/fixture/nvm-link")),
        "VOLTA_HOME" => Some(OsString::from("/fixture/volta")),
        "ProgramFiles" => Some(OsString::from("/fixture/program-files")),
        _ => None,
    });
    assert!(directories.contains(&root.join(".volta/bin")));
    assert!(directories.contains(&root.join("AppData/Local/Programs/nodejs")));
    assert!(directories.contains(&PathBuf::from("/fixture/nvm-link")));
    assert!(directories.contains(&PathBuf::from("/fixture/volta/bin")));
    assert!(directories.contains(&PathBuf::from("/fixture/program-files/nodejs")));

    let children = |directory: &Path| -> Vec<PathBuf> {
        let names: &[&str] = match directory.to_str() {
            Some("/opt/homebrew/opt") => &["node@22", "openssl@3", "node@24", "node"],
            Some("/fixture/home/.nvm/versions/node") => &["v22.9.0", "v20.19.0", "v22.10.0"],
            Some("/fixture/asdf/installs/nodejs") => &["20.11.0", "22.2.0"],
            _ => &[],
        };
        names.iter().map(|name| directory.join(name)).collect()
    };
    let read_text = |file: &Path| match file.to_str() {
        Some("/fixture/home/.nvm/alias/default") => Some("lts/jod\n".to_owned()),
        Some("/fixture/home/.nvm/alias/lts/jod") => Some("22.9\n".to_owned()),
        _ => None,
    };
    let directories = unix_node_runtime_directories(
        Some(root),
        |key| match key {
            "ASDF_DATA_DIR" => Some(OsString::from("/fixture/asdf")),
            "VOLTA_HOME" => Some(OsString::from("/fixture/volta")),
            "N_PREFIX" => Some(OsString::from("/fixture/n")),
            _ => None,
        },
        children,
        read_text,
    );
    let position = |path: &str| {
        directories
            .iter()
            .position(|directory| directory == Path::new(path))
            .unwrap_or_else(|| panic!("{path} missing from {directories:?}"))
    };
    assert!(position("/opt/homebrew/opt/node/bin") < position("/opt/homebrew/opt/node@24/bin"));
    assert!(position("/opt/homebrew/opt/node@24/bin") < position("/opt/homebrew/opt/node@22/bin"));
    assert!(!directories
        .iter()
        .any(|directory| directory.starts_with("/opt/homebrew/opt/openssl@3")));
    assert!(
        position("/fixture/home/.nvm/versions/node/v22.9.0/bin")
            < position("/fixture/home/.nvm/versions/node/v22.10.0/bin")
    );
    assert!(
        position("/fixture/home/.nvm/versions/node/v22.10.0/bin")
            < position("/fixture/home/.nvm/versions/node/v20.19.0/bin")
    );
    assert!(position("/fixture/asdf/shims") < position("/fixture/asdf/installs/nodejs/22.2.0/bin"));
    assert!(
        position("/fixture/asdf/installs/nodejs/22.2.0/bin")
            < position("/fixture/asdf/installs/nodejs/20.11.0/bin")
    );
    assert!(directories.contains(&PathBuf::from("/fixture/volta/bin")));
    assert!(directories.contains(&PathBuf::from("/fixture/n/bin")));
    assert!(directories.contains(&root.join(".local/share/mise/shims")));
    assert!(directories.contains(&root.join("Library/Application Support/fnm/aliases/default/bin")));
    assert!(directories.contains(&root.join(".nix-profile/bin")));
    assert!(directories.contains(&PathBuf::from("/opt/local/bin")));
    assert_eq!(version_key(Path::new("/x/v22.10.0")), vec![22, 10, 0]);
}
