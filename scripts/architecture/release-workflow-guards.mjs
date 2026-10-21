// Keeps the stable macOS release sequence fail-closed: Tauri notarizes the app,
// then the final DMG is separately notarized, stapled, re-uploaded, and only
// afterward captured in the immutable distribution trust receipt.

export function collectReleaseWorkflowDiagnostics({ exists, read }) {
  const diagnostics = [];
  const workflowPath = ".github/workflows/release.yml";
  const notarizeScriptPath = "scripts/release/notarize-macos-dmg.sh";
  const updaterFinalizerPath = "scripts/release/finalize-updater-json.mjs";

  if (!exists(workflowPath) || !exists(notarizeScriptPath) || !exists(updaterFinalizerPath)) {
    diagnostics.push("stable release DMG notarization boundary is missing");
    return diagnostics;
  }

  const workflow = read(workflowPath);
  const notarizeScript = read(notarizeScriptPath);
  const updaterFinalizer = read(updaterFinalizerPath);
  const allowlistStart = updaterFinalizer.indexOf("function allowedNonUpdaterAsset");
  const allowlistEnd = updaterFinalizer.indexOf("function assertExactReleaseClosure", allowlistStart);
  const updaterAssetAllowlist = allowlistStart >= 0 && allowlistEnd > allowlistStart
    ? updaterFinalizer.slice(allowlistStart, allowlistEnd)
    : "";
  const orderedSteps = [
    "- name: Build and upload Tauri release",
    "- name: Notarize and staple macOS DMG",
    "- name: Replace draft DMG with notarized artifact",
    "- name: Verify Developer ID, notarization, and identical app payloads",
  ];
  const stepOffsets = orderedSteps.map((marker) => workflow.indexOf(marker));
  if (
    stepOffsets.some((offset) => offset < 0)
    || stepOffsets.some((offset, index) => index > 0 && offset <= stepOffsets[index - 1])
  ) {
    diagnostics.push(`${workflowPath}: macOS DMG notarization, replacement, and trust capture must remain ordered after the Tauri build`);
  }

  for (const marker of [
    "bash scripts/release/notarize-macos-dmg.sh",
    "--github-output \"$GITHUB_OUTPUT\"",
    "DOPEDB_NOTARIZED_DMG: ${{ steps.notarize_macos_dmg.outputs.dmg }}",
    "gh release upload \"$GITHUB_REF_NAME\"",
    "\"$DOPEDB_NOTARIZED_DMG\"",
    "--clobber",
  ]) {
    if (!workflow.includes(marker)) {
      diagnostics.push(`${workflowPath}: stable DMG replacement marker is missing (${marker})`);
    }
  }

  for (const marker of [
    "hdiutil verify \"$dmg\"",
    "xcrun notarytool submit \"$dmg\"",
    "--key \"$APPLE_API_KEY_PATH\"",
    "--key-id \"$APPLE_API_KEY\"",
    "--issuer \"$APPLE_API_ISSUER\"",
    "--wait",
    "--timeout 20m",
    "--output-format json",
    "notary_status\" != \"Accepted",
    "xcrun stapler staple \"$dmg\"",
    "xcrun stapler validate \"$dmg\"",
  ]) {
    if (!notarizeScript.includes(marker)) {
      diagnostics.push(`${notarizeScriptPath}: fail-closed DMG notarization marker is missing (${marker})`);
    }
  }

  for (const marker of [
    "DopeDB_${version}_aarch64.macos-trust.json",
  ]) {
    if (!updaterAssetAllowlist.includes(marker)) {
      diagnostics.push(`${updaterFinalizerPath}: Developer ID trust receipt allowlist marker is missing (${marker})`);
    }
  }

  if (workflow.includes("target: x86_64-apple-darwin") || updaterFinalizer.includes('"darwin-x86_64"')) {
    diagnostics.push("stable releases must not publish retired macOS Intel installers or updater entries");
  }

  return diagnostics;
}
