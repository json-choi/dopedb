import { queryOptions } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "../../ipc/core";
import { installDiagnosticCapture } from "./client";
import type { DiagnosticSnapshot } from "./domain";

export const diagnosticQueryKey = ["localDiagnostics"] as const;

export function diagnosticSnapshotQuery() {
  return queryOptions({
    queryKey: diagnosticQueryKey,
    queryFn: () => invoke<DiagnosticSnapshot>("diagnostics_snapshot"),
    retry: false,
  });
}

export function setDiagnosticEnabled(enabled: boolean) {
  return invoke<DiagnosticSnapshot>("diagnostics_set_enabled", { enabled });
}

export function clearDiagnostics() {
  return invoke<DiagnosticSnapshot>("diagnostics_clear");
}

export function initializeLocalDiagnostics() {
  return installDiagnosticCapture((generation, entries) =>
    invoke<void>("diagnostics_append", { generation, entries }));
}

export function openDiagnosticIssue() {
  // Logs are never embedded in the URL or submitted on the user's behalf.
  return openUrl("https://github.com/json-choi/dopedb/issues/new");
}
