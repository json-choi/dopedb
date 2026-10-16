// The cancellable check owns the probe lifecycle the editor's profile controller composes.
const checkCommandPath = "src/features/connections/useConnectionTestCommand.ts";
const footerPath = "src/screens/Connections/ConnectionEditorFooter.tsx";
const generalTabPath = "src/screens/Connections/ConnectionGeneralTab.tsx";
const transportPath = "src-tauri/src/features/connections/transport.rs";

export function collectConnectionEditorDiagnostics({ exists, read }) {
  const required = [checkCommandPath, footerPath, generalTabPath, transportPath];
  const diagnostics = required
    .filter((filePath) => !exists(filePath))
    .map((filePath) => `required connection editor boundary is missing: ${filePath}`);
  if (diagnostics.length > 0) return diagnostics;

  const checkCommand = read(checkCommandPath);
  if (!checkCommand.includes("if (!mounted.current) return;")) {
    diagnostics.push(`${checkCommandPath}: dismissed probes must not update unmounted editor state`);
  }
  if (!checkCommand.includes("receipt.ok")) {
    diagnostics.push(`${checkCommandPath}: test failures must consume the typed native receipt`);
  }

  const footer = read(footerPath);
  if (/<Button disabled=\{commands\.busy\} size="compact" onClick=\{onCancel\}>/.test(footer)) {
    diagnostics.push(`${footerPath}: Cancel must remain available during a bounded connection probe`);
  }

  const generalTab = read(generalTabPath);
  if (!generalTab.includes("value={profile.port.draft}")) {
    diagnostics.push(`${generalTabPath}: port input must preserve its transient string draft`);
  }
  if (/event\.target\.value\s*!==\s*""/.test(generalTab)) {
    diagnostics.push(`${generalTabPath}: empty port drafts must not be discarded`);
  }

  const transport = read(transportPath);
  if ((transport.match(/AppResult<super::ConnectionTestReceipt>/g) ?? []).length !== 2) {
    diagnostics.push(`${transportPath}: both connection-test commands must return typed receipts`);
  }
  return diagnostics;
}
