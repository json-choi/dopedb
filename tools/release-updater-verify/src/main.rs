//! Verifies a completed release updater closure using the same Minisign
//! `verify(data, signature, true)` semantics as `tauri-plugin-updater`.

use std::collections::{BTreeSet, HashMap};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const REPOSITORY: &str = "json-choi/dopedb";
const PLATFORMS: [(&str, &str, &[u8]); 3] = [
    ("darwin-aarch64", "aarch64.app.tar.gz", &[0x1f, 0x8b]),
    ("darwin-x86_64", "x64.app.tar.gz", &[0x1f, 0x8b]),
    ("windows-x86_64", "x64-setup.exe", b"MZ"),
];
const MACOS_DISTRIBUTIONS: [(&str, &str, &str); 2] = [
    ("aarch64-apple-darwin", "arm64", "aarch64"),
    ("x86_64-apple-darwin", "x64", "x64"),
];

struct Arguments {
    assets: PathBuf,
    commit: String,
    downloads: PathBuf,
    manifest: PathBuf,
    macos_distribution: PathBuf,
    root: PathBuf,
    tag: String,
}

struct Asset {
    digest: Option<String>,
    name: String,
    size: u64,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MacosDistributionConfig {
    schema_version: u32,
    distribution_mode: MacosDistributionMode,
    product_name: String,
    bundle_identifier: String,
    team_identifier: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum MacosDistributionMode {
    LegacyUnsigned,
    DeveloperId,
}

impl MacosDistributionConfig {
    fn developer_id_required(&self) -> bool {
        self.distribution_mode == MacosDistributionMode::DeveloperId
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MacosTrustReceipt {
    schema_version: u32,
    tag: String,
    commit: String,
    target: String,
    architecture: String,
    team_identifier: String,
    bundle_identifier: String,
    developer_id_authority: String,
    app_tree_sha256: String,
    artifacts: MacosTrustArtifacts,
    checks: MacosTrustChecks,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MacosTrustArtifacts {
    dmg: MacosTrustArtifact,
    updater: MacosTrustArtifact,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MacosTrustArtifact {
    name: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MacosTrustChecks {
    codesign_strict: bool,
    developer_id: bool,
    hardened_runtime: bool,
    spctl_execute: bool,
    app_staple: bool,
    dmg_staple: bool,
    dmg_integrity: bool,
    same_app_bytes: bool,
}

struct MacosReceiptExpectation<'a> {
    tag: &'a str,
    commit: &'a str,
    target: &'a str,
    architecture: &'a str,
    dmg_name: &'a str,
    updater_name: &'a str,
    dmg_digest: String,
    updater_digest: String,
}

fn fail<T>(message: impl Into<String>) -> Result<T, String> {
    Err(message.into())
}

fn arg(values: &HashMap<String, String>, name: &str) -> Result<String, String> {
    values
        .get(name)
        .cloned()
        .ok_or_else(|| format!("missing {name}"))
}

fn arguments() -> Result<Arguments, String> {
    let mut values = HashMap::new();
    let mut input = std::env::args().skip(1);
    while let Some(name) = input.next() {
        if !name.starts_with("--") {
            return fail(format!("unexpected argument {name}"));
        }
        let value = input
            .next()
            .filter(|value| !value.starts_with("--"))
            .ok_or_else(|| format!("missing value for {name}"))?;
        if values.insert(name.clone(), value).is_some() {
            return fail(format!("duplicate argument {name}"));
        }
    }
    let allowed = [
        "--assets",
        "--commit",
        "--downloads",
        "--macos-distribution",
        "--manifest",
        "--repository",
        "--root",
        "--tag",
    ];
    if values.keys().any(|name| !allowed.contains(&name.as_str())) {
        return fail("unknown verifier argument");
    }
    if arg(&values, "--repository")? != REPOSITORY {
        return fail("stable updater repository does not match the checked-in public endpoint");
    }
    Ok(Arguments {
        assets: arg(&values, "--assets")?.into(),
        commit: arg(&values, "--commit")?,
        downloads: arg(&values, "--downloads")?.into(),
        manifest: arg(&values, "--manifest")?.into(),
        macos_distribution: arg(&values, "--macos-distribution")?.into(),
        root: arg(&values, "--root")?.into(),
        tag: arg(&values, "--tag")?,
    })
}

fn json(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?)
        .map_err(|error| format!("{}: invalid JSON: {error}", path.display()))
}

fn text<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing non-empty string {field}"))
}

fn cargo_version(path: &Path) -> Result<String, String> {
    fs::read_to_string(path)
        .map_err(|error| error.to_string())?
        .lines()
        .find_map(|line| {
            line.strip_prefix("version = \"")
                .and_then(|line| line.strip_suffix('"'))
        })
        .map(str::to_owned)
        .ok_or_else(|| format!("{} has no package version", path.display()))
}

fn lock_version(path: &Path) -> Result<String, String> {
    let lock = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut lines = lock.lines();
    while let Some(line) = lines.next() {
        if line == "name = \"dopedb\"" {
            return lines
                .next()
                .and_then(|line| {
                    line.strip_prefix("version = \"")
                        .and_then(|line| line.strip_suffix('"'))
                })
                .map(str::to_owned)
                .ok_or_else(|| "dopedb package has no lockfile version".to_owned());
        }
    }
    fail("Cargo.lock has no dopedb package")
}

fn version(arguments: &Arguments, manifest: &Value) -> Result<String, String> {
    let version = text(manifest, "version")?.to_owned();
    if arguments.tag != format!("app-v{version}") {
        return fail("manifest version does not match stable release tag");
    }
    let package = json(&arguments.root.join("package.json"))?;
    let tauri = json(&arguments.root.join("src-tauri/tauri.conf.json"))?;
    let versions = [
        text(&package, "version")?.to_owned(),
        text(&tauri, "version")?.to_owned(),
        cargo_version(&arguments.root.join("src-tauri/Cargo.toml"))?,
        lock_version(&arguments.root.join("Cargo.lock"))?,
    ];
    if versions.iter().any(|candidate| candidate != &version) {
        return fail("manifest version does not match every checked-in version source");
    }
    Ok(version)
}

fn public_key(root: &Path) -> Result<PublicKey, String> {
    let tauri = json(&root.join("src-tauri/tauri.conf.json"))?;
    let encoded = text(&tauri["plugins"]["updater"], "pubkey")?;
    let decoded = STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    PublicKey::decode(&String::from_utf8(decoded).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn canonical_url(tag: &str, name: &str) -> String {
    format!("https://github.com/{REPOSITORY}/releases/download/{tag}/{name}")
}

fn strict_digest(digest: &str) -> bool {
    digest.len() == 71
        && digest.starts_with("sha256:")
        && digest[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn digest(bytes: &[u8]) -> String {
    let mut encoded = String::from("sha256:");
    for byte in Sha256::digest(bytes) {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn is_allowed_non_updater(name: &str, version: &str) -> bool {
    matches!(
        name,
        "latest.json"
            | "DopeDB-windows-x64-setup.exe"
            | "DopeDB-macos-arm64.dmg"
            | "DopeDB-macos-x64.dmg"
    ) || name == format!("DopeDB_{version}_aarch64.dmg")
        || name == format!("DopeDB_{version}_x64.dmg")
}

fn looks_like_updater(name: &str) -> bool {
    name.starts_with("DopeDB_")
        && (name.ends_with(".app.tar.gz")
            || name.ends_with(".app.tar.gz.sig")
            || name.ends_with("-setup.exe")
            || name.ends_with("-setup.exe.sig"))
}

fn assets(
    path: &Path,
    version: &str,
    tag: &str,
    macos_distribution: &MacosDistributionConfig,
) -> Result<HashMap<String, Asset>, String> {
    let document = json(path)?;
    let values = document
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| "assets JSON must contain an assets array".to_owned())?;
    let updater_expected = PLATFORMS
        .iter()
        .flat_map(|(_, suffix, _)| {
            let name = format!("DopeDB_{version}_{suffix}");
            [name.clone(), format!("{name}.sig")]
        })
        .collect::<BTreeSet<_>>();
    let macos_expected = if macos_distribution.developer_id_required() {
        MACOS_DISTRIBUTIONS
            .iter()
            .flat_map(|(_, _, suffix)| {
                [
                    format!("DopeDB_{version}_{suffix}.dmg"),
                    format!("DopeDB_{version}_{suffix}.macos-trust.json"),
                ]
            })
            .collect::<BTreeSet<_>>()
    } else {
        BTreeSet::new()
    };
    let expected = updater_expected
        .union(&macos_expected)
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut urls = HashMap::new();
    let mut names = BTreeSet::new();
    for value in values {
        let asset = Asset {
            digest: value
                .get("digest")
                .and_then(Value::as_str)
                .map(str::to_owned),
            name: text(value, "name")?.to_owned(),
            size: value
                .get("size")
                .and_then(Value::as_u64)
                .filter(|size| *size > 0)
                .ok_or_else(|| "asset size must be a positive unsigned integer".to_owned())?,
            url: text(value, "url")?.to_owned(),
        };
        if !names.insert(asset.name.clone()) || urls.contains_key(&asset.url) {
            return fail("duplicate release asset name or public URL");
        }
        if looks_like_updater(&asset.name) && !expected.contains(&asset.name) {
            return fail("release contains a stale or unsupported updater asset");
        }
        if !expected.contains(&asset.name) && !is_allowed_non_updater(&asset.name, version) {
            return fail("release contains an asset outside the stable allowlist");
        }
        if (expected.contains(&asset.name) || asset.name == "latest.json")
            && !asset.digest.as_deref().is_some_and(strict_digest)
        {
            return fail("exact updater assets and latest.json require a strict SHA-256 digest");
        }
        urls.insert(asset.url.clone(), asset);
    }
    for name in expected {
        let url = canonical_url(tag, &name);
        match urls.get(&url) {
            Some(asset) if asset.name == name => {}
            _ => return fail("release is missing an exact canonical updater closure asset"),
        }
    }
    Ok(urls)
}

fn verify_latest(arguments: &Arguments, assets: &HashMap<String, Asset>) -> Result<(), String> {
    let url = canonical_url(&arguments.tag, "latest.json");
    let asset = assets
        .get(&url)
        .ok_or("missing latest.json release asset")?;
    if asset.name != "latest.json" {
        return fail("latest.json URL does not name latest.json");
    }
    let bytes = fs::read(&arguments.manifest)
        .map_err(|error| format!("{}: {error}", arguments.manifest.display()))?;
    let actual_digest = digest(&bytes);
    if u64::try_from(bytes.len()).map_err(|_| "latest.json length overflow")? != asset.size
        || asset.digest.as_deref() != Some(actual_digest.as_str())
    {
        return fail("latest.json bytes do not match refreshed release metadata");
    }
    Ok(())
}

fn downloaded_asset(
    arguments: &Arguments,
    assets: &HashMap<String, Asset>,
    name: &str,
) -> Result<Vec<u8>, String> {
    let url = canonical_url(&arguments.tag, name);
    let asset = assets.get(&url).ok_or("missing release asset")?;
    if asset.name != name {
        return fail("release asset URL does not match its name");
    }
    let path = arguments.downloads.join(name);
    let bytes = fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    if u64::try_from(bytes.len()).map_err(|_| "release asset length overflow")? != asset.size
        || asset.digest.as_deref() != Some(digest(&bytes).as_str())
    {
        return fail("downloaded release asset does not match release metadata");
    }
    Ok(bytes)
}

fn valid_team_identifier(value: &str) -> bool {
    value.len() == 10
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn macos_distribution_config(arguments: &Arguments) -> Result<MacosDistributionConfig, String> {
    let config: MacosDistributionConfig = serde_json::from_slice(
        &fs::read(&arguments.macos_distribution)
            .map_err(|error| format!("{}: {error}", arguments.macos_distribution.display()))?,
    )
    .map_err(|error| format!("invalid macOS distribution config: {error}"))?;
    if config.schema_version != 2
        || config.product_name != "DopeDB"
        || config.bundle_identifier != "dev.dopedb.desktop"
        || !valid_team_identifier(&config.team_identifier)
    {
        return fail("macOS distribution config does not match the stable app identity");
    }
    Ok(config)
}

fn verify_macos_receipt_contract(
    receipt: &MacosTrustReceipt,
    config: &MacosDistributionConfig,
    expected: &MacosReceiptExpectation<'_>,
) -> Result<(), String> {
    if receipt.schema_version != 1
        || receipt.tag != expected.tag
        || receipt.commit != expected.commit
        || receipt.target != expected.target
        || receipt.architecture != expected.architecture
        || receipt.team_identifier != config.team_identifier
        || receipt.bundle_identifier != config.bundle_identifier
    {
        return fail("macOS trust receipt identity does not match the release");
    }
    if expected.commit.len() != 40
        || !expected
            .commit
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return fail("macOS trust receipt commit is invalid");
    }
    if !receipt
        .developer_id_authority
        .starts_with("Developer ID Application: ")
        || !receipt
            .developer_id_authority
            .contains(&format!("({})", config.team_identifier))
        || !strict_digest(&receipt.app_tree_sha256)
    {
        return fail("macOS trust receipt has an invalid Developer ID claim");
    }
    if receipt.artifacts.dmg.name != expected.dmg_name
        || receipt.artifacts.dmg.sha256 != expected.dmg_digest
        || receipt.artifacts.updater.name != expected.updater_name
        || receipt.artifacts.updater.sha256 != expected.updater_digest
    {
        return fail("macOS trust receipt artifact hashes do not match downloaded assets");
    }
    let checks = &receipt.checks;
    if !checks.codesign_strict
        || !checks.developer_id
        || !checks.hardened_runtime
        || !checks.spctl_execute
        || !checks.app_staple
        || !checks.dmg_staple
        || !checks.dmg_integrity
        || !checks.same_app_bytes
    {
        return fail("macOS trust receipt contains an incomplete verification gate");
    }
    Ok(())
}

fn verify_macos_distribution(
    arguments: &Arguments,
    version: &str,
    assets: &HashMap<String, Asset>,
    config: &MacosDistributionConfig,
) -> Result<(), String> {
    if !config.developer_id_required() {
        println!("macOS Developer ID verification is inactive: legacy-unsigned mode");
        return Ok(());
    }
    for (target, architecture, suffix) in MACOS_DISTRIBUTIONS {
        let prefix = format!("DopeDB_{version}_{suffix}");
        let dmg_name = format!("{prefix}.dmg");
        let updater_name = format!("{prefix}.app.tar.gz");
        let receipt_name = format!("{prefix}.macos-trust.json");
        let dmg = downloaded_asset(arguments, assets, &dmg_name)?;
        let updater = downloaded_asset(arguments, assets, &updater_name)?;
        let receipt_bytes = downloaded_asset(arguments, assets, &receipt_name)?;
        let receipt: MacosTrustReceipt = serde_json::from_slice(&receipt_bytes)
            .map_err(|error| format!("{receipt_name}: invalid trust receipt: {error}"))?;
        verify_macos_receipt_contract(
            &receipt,
            config,
            &MacosReceiptExpectation {
                tag: &arguments.tag,
                commit: &arguments.commit,
                target,
                architecture,
                dmg_name: &dmg_name,
                updater_name: &updater_name,
                dmg_digest: digest(&dmg),
                updater_digest: digest(&updater),
            },
        )?;
        println!("verified macOS Developer ID and notarization receipt: {target}");
    }
    Ok(())
}

fn tauri_signature(entry: &Value, asset: &[u8]) -> Result<Signature, String> {
    let encoded = text(entry, "signature")?;
    if asset != encoded.as_bytes() {
        return fail("signature asset does not match manifest");
    }
    let decoded = STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    if STANDARD.encode(&decoded) != encoded {
        return fail("signature must use canonical Base64");
    }
    let signature = String::from_utf8(decoded).map_err(|error| error.to_string())?;
    Signature::decode(&signature).map_err(|error| error.to_string())
}

fn verify(
    arguments: &Arguments,
    manifest: &Value,
    version: &str,
    assets: &HashMap<String, Asset>,
) -> Result<(), String> {
    let platforms = manifest
        .get("platforms")
        .and_then(Value::as_object)
        .ok_or_else(|| "manifest platforms must be an object".to_owned())?;
    let expected = PLATFORMS
        .iter()
        .map(|(name, _, _)| *name)
        .collect::<BTreeSet<_>>();
    if platforms
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>()
        != expected
    {
        return fail("manifest has unsupported, duplicate, or missing updater platform keys");
    }
    let key = public_key(&arguments.root)?;
    for (platform, suffix, header) in PLATFORMS {
        let entry = platforms.get(platform).ok_or("missing platform")?;
        let name = format!("DopeDB_{version}_{suffix}");
        let url = canonical_url(&arguments.tag, &name);
        if text(entry, "url")? != url {
            return fail(format!(
                "{platform} does not use the canonical public archive URL"
            ));
        }
        let archive_asset = assets.get(&url).ok_or("missing archive asset")?;
        let archive = arguments.downloads.join(&name);
        let bytes =
            fs::read(&archive).map_err(|error| format!("{}: {error}", archive.display()))?;
        let archive_digest = digest(&bytes);
        if u64::try_from(bytes.len()).map_err(|_| "archive length overflow")? != archive_asset.size
        {
            return fail(format!(
                "{platform} archive size does not match release metadata"
            ));
        }
        if archive_asset.digest.as_deref() != Some(archive_digest.as_str()) {
            return fail(format!(
                "{platform} archive SHA-256 does not match release metadata"
            ));
        }
        if !bytes.starts_with(header) {
            return fail(format!(
                "{platform} archive header does not match its platform format"
            ));
        }
        let signature_name = format!("{name}.sig");
        let signature_url = canonical_url(&arguments.tag, &signature_name);
        let signature_asset = assets
            .get(&signature_url)
            .ok_or("missing signature asset")?;
        let signature_path = arguments.downloads.join(&signature_name);
        let signature = fs::read(&signature_path)
            .map_err(|error| format!("{}: {error}", signature_path.display()))?;
        let signature_digest = digest(&signature);
        if u64::try_from(signature.len()).map_err(|_| "signature length overflow")?
            != signature_asset.size
        {
            return fail(format!(
                "{platform} signature size does not match release metadata"
            ));
        }
        let parsed =
            tauri_signature(entry, &signature).map_err(|error| format!("{platform}: {error}"))?;
        if signature_asset.digest.as_deref() != Some(signature_digest.as_str()) {
            return fail(format!(
                "{platform} signature SHA-256 does not match release metadata"
            ));
        }
        key.verify(&bytes, &parsed, true)
            .map_err(|error| format!("{platform}: {error}"))?;
        println!(
            "verified updater platform {platform}: {} bytes",
            bytes.len()
        );
    }
    Ok(())
}

fn run() -> Result<(), String> {
    let arguments = arguments()?;
    let manifest = json(&arguments.manifest)?;
    let version = version(&arguments, &manifest)?;
    let macos_distribution = macos_distribution_config(&arguments)?;
    let assets = assets(
        &arguments.assets,
        &version,
        &arguments.tag,
        &macos_distribution,
    )?;
    verify_latest(&arguments, &assets)?;
    verify(&arguments, &manifest, &version, &assets)?;
    verify_macos_distribution(&arguments, &version, &assets, &macos_distribution)
}

fn main() {
    if let Err(error) = run() {
        eprintln!("release updater verification failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use acp_plugin_sign::sign_file;
    use minisign::{KeyPair, SignatureBox};

    use super::*;

    const PUBLIC_KEY: &str = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const SIGNATURE: &str = "untrusted comment: minisign public test vector\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";

    #[test]
    fn tauri_compatible_minisign_rejects_bad_payload_and_key() {
        let key = PublicKey::decode(PUBLIC_KEY).unwrap();
        let signature = Signature::decode(SIGNATURE).unwrap();
        key.verify(b"test", &signature, true).unwrap();
        assert!(key.verify(b"Test", &signature, true).is_err());
        let wrong = PublicKey::decode(
            "untrusted comment: other\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO4",
        )
        .unwrap();
        assert!(wrong.verify(b"test", &signature, true).is_err());
    }

    #[test]
    fn tauri_manifest_signature_is_the_exact_sig_asset_text() {
        let encoded = STANDARD.encode(SIGNATURE);
        let entry = serde_json::json!({ "signature": encoded });
        tauri_signature(&entry, encoded.as_bytes()).unwrap();

        match tauri_signature(&entry, SIGNATURE.as_bytes()) {
            Err(error) => assert_eq!(error, "signature asset does not match manifest"),
            Ok(_) => panic!("raw Minisign text must not match the Tauri .sig asset"),
        }

        let malformed = format!("{encoded}\n");
        let malformed_entry = serde_json::json!({ "signature": malformed });
        assert!(tauri_signature(&malformed_entry, malformed.as_bytes()).is_err());
    }

    #[test]
    fn release_asset_allowlist_and_digest_are_strict() {
        assert!(looks_like_updater("DopeDB_0.1.0_x64-setup.exe.sig"));
        assert!(!is_allowed_non_updater(
            "DopeDB_0.1.0_x64-setup.exe",
            "0.2.0"
        ));
        assert!(is_allowed_non_updater("DopeDB-macos-x64.dmg", "0.2.0"));
        assert!(strict_digest(&digest(b"test")));
        assert!(!strict_digest("sha256:ABC"));
        assert!(!strict_digest(
            "sha512:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ));

        let config = MacosDistributionConfig {
            schema_version: 2,
            distribution_mode: MacosDistributionMode::DeveloperId,
            product_name: "DopeDB".into(),
            bundle_identifier: "dev.dopedb.desktop".into(),
            team_identifier: "B67K525D3B".into(),
        };
        let mut receipt: MacosTrustReceipt = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "tag": "app-v0.2.0",
            "commit": "0123456789abcdef0123456789abcdef01234567",
            "target": "aarch64-apple-darwin",
            "architecture": "arm64",
            "teamIdentifier": "B67K525D3B",
            "bundleIdentifier": "dev.dopedb.desktop",
            "developerIdAuthority": "Developer ID Application: jaesong choi (B67K525D3B)",
            "appTreeSha256": digest(b"app"),
            "artifacts": {
                "dmg": { "name": "DopeDB_0.2.0_aarch64.dmg", "sha256": digest(b"dmg") },
                "updater": { "name": "DopeDB_0.2.0_aarch64.app.tar.gz", "sha256": digest(b"updater") }
            },
            "checks": {
                "codesignStrict": true,
                "developerId": true,
                "hardenedRuntime": true,
                "spctlExecute": true,
                "appStaple": true,
                "dmgStaple": true,
                "dmgIntegrity": true,
                "sameAppBytes": true
            }
        }))
        .unwrap();
        assert!(verify_macos_receipt_contract(
            &receipt,
            &config,
            &MacosReceiptExpectation {
                tag: "app-v0.2.0",
                commit: "0123456789abcdef0123456789abcdef01234567",
                target: "aarch64-apple-darwin",
                architecture: "arm64",
                dmg_name: "DopeDB_0.2.0_aarch64.dmg",
                updater_name: "DopeDB_0.2.0_aarch64.app.tar.gz",
                dmg_digest: digest(b"dmg"),
                updater_digest: digest(b"updater"),
            },
        )
        .is_ok());
        receipt.checks.dmg_staple = false;
        assert!(verify_macos_receipt_contract(
            &receipt,
            &config,
            &MacosReceiptExpectation {
                tag: "app-v0.2.0",
                commit: "0123456789abcdef0123456789abcdef01234567",
                target: "aarch64-apple-darwin",
                architecture: "arm64",
                dmg_name: "DopeDB_0.2.0_aarch64.dmg",
                updater_name: "DopeDB_0.2.0_aarch64.app.tar.gz",
                dmg_digest: digest(b"dmg"),
                updater_digest: digest(b"updater"),
            },
        )
        .is_err());

        let legacy_config: MacosDistributionConfig = serde_json::from_value(serde_json::json!({
            "schemaVersion": 2,
            "distributionMode": "legacy-unsigned",
            "productName": "DopeDB",
            "bundleIdentifier": "dev.dopedb.desktop",
            "teamIdentifier": "B67K525D3B"
        }))
        .unwrap();
        assert!(!legacy_config.developer_id_required());
    }

    #[test]
    fn acp_release_signing_and_immutable_publication_contract_hold() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let secret_key_path = temporary.path().join("test.key");
        let message_path = temporary.path().join("message.txt");
        let signature_path = temporary.path().join("message.txt.minisig");
        let pair = KeyPair::generate_encrypted_keypair(Some(String::new())).expect("key pair");
        fs::write(
            &secret_key_path,
            pair.sk.to_box(None).expect("secret key box").to_string(),
        )
        .expect("secret key file");
        let message = b"signed adapter manifest";
        fs::write(&message_path, message).expect("message file");

        sign_file(
            secret_key_path,
            message_path,
            signature_path.clone(),
            String::new(),
        )
        .expect("non-interactive signature");

        let signature = SignatureBox::from_file(signature_path).expect("signature file");
        minisign::verify(
            &pair.pk,
            &signature,
            Cursor::new(message),
            true,
            false,
            false,
        )
        .expect("valid signature");

        let workflow = fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../.github/workflows/acp-adapter-release.yml"),
        )
        .expect("ACP release workflow");
        assert!(workflow.contains("--draft"));
        assert!(workflow.contains("-F draft=false"));
        assert!(workflow.contains("-candidate"));
        assert!(workflow.contains("Verify stable artifacts match the candidate"));
        assert!(!workflow.contains("acp-bundle-stable"));

        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let availability = std::process::Command::new("node")
            .args(["--input-type=module", "-e", r#"
                import assert from 'node:assert/strict';
                import { createHash } from 'node:crypto';
                import { readFileSync } from 'node:fs';
                import { assertPublishedCompatibility, stableReleaseTags } from './scripts/agent-runtime/verify-published-acp.mjs';
                const read = path => JSON.parse(readFileSync(path, 'utf8'));
                const catalog = read('agent-runtime/plugins/catalog.json');
                const runtime = read('src-tauri/resources/agent-runtime/runtime-catalog.json');
                const app = read('package.json').version;
                const plugin = catalog.plugins[0];
                const tag = 'acp-bundle-v2026.09.05.1';
                const manifest = {
                    schemaVersion: 1, pluginId: plugin.id, provider: plugin.provider,
                    adapterVersion: plugin.adapterVersion, adapterBundleVersion: plugin.adapterBundleVersion,
                    compatibility: {
                        dopedbVersionMin: app, dopedbVersionMax: app,
                        nodeVersionMin: runtime.version, nodeVersionMax: runtime.version,
                        acpProtocolMin: catalog.acpProtocol, acpProtocolMax: catalog.acpProtocol,
                    },
                    artifact: { keyId: catalog.keyId, packedBytes: 100,
                        url: `https://github.com/json-choi/dopedb/releases/download/${tag}/${plugin.provider}.tar.gz` },
                    rolloutBasisPoints: 10000,
                };
                const envelope = value => ({ manifest: value, keyId: catalog.keyId, signature: 'availability-fixture',
                    manifestSha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') });
                const check = value => assertPublishedCompatibility(envelope(value), plugin, catalog, runtime, app, tag);
                check(manifest);
                const old = structuredClone(manifest);
                old.compatibility.dopedbVersionMin = '0.3.33';
                old.compatibility.dopedbVersionMax = '0.3.99';
                assert.throws(() => check(old), /publish a compatible ACP bundle first/);
                assert.throws(() => check({ ...manifest, adapterVersion: '0.0.1' }), /checked-in pins/);
                assert.throws(() => check({ ...manifest, revokedAt: '2026-09-05T00:00:00Z' }), /revoked/);
                assert.throws(() => assertPublishedCompatibility({ ...envelope(manifest), manifestSha256: 'a'.repeat(64) }, plugin, catalog, runtime, app, tag), /digest mismatch/);
                assert.deepEqual(stableReleaseTags([
                    { ref: `refs/tags/${tag}-candidate` },
                    { ref: `refs/tags/${tag}` },
                    { ref: 'refs/tags/acp-bundle-v2026.02.30.1' },
                    { ref: 'refs/tags/acp-bundle-v2026.09.05.10' },
                ]), ['acp-bundle-v2026.09.05.10', tag]);
            "#])
            .current_dir(root)
            .output()
            .expect("Node is available for the release availability gate");
        assert!(availability.status.success(), "{}", String::from_utf8_lossy(&availability.stderr));
    }
}
