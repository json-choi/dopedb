// IPC boundary for Activity: audit verification and bounded audit/history pages,
// plus one exact record body on demand. Rust owns every value; this only types it.
import { invoke } from "../../ipc/core";
import type {
  AuditEntryDetail,
  AuditPage,
  AuditVerdict,
  HistoryEntryDetail,
  HistoryPage,
  HistoryPageRequest,
} from "../../ipc/types";

/** How the chain compares with the tail anchor that every audit append advances. */
export type AuditAnchorStatus = "matched" | "missing" | "shorter" | "longer" | "tailMismatch";

/**
 * `firstBadRowId` anchors the metadata page that starts at the first broken record.
 * `ok` already requires `anchorStatus === "matched"`; the status says which end failed.
 */
export type AuditVerdictReceipt = AuditVerdict & {
  firstBadRowId: number | null;
  anchorStatus: AuditAnchorStatus;
  anchoredCount: number | null;
};

export function auditVerify(id: string): Promise<AuditVerdictReceipt> {
  return invoke("audit_verify", { connectionId: id });
}

export function listAuditPage(
  connectionId: string,
  cursor: { rowId: number } | null,
): Promise<AuditPage> {
  return invoke("list_audit_page", { request: { connectionId, cursor } });
}

export function getAuditEntry(
  connectionId: string,
  entryId: string,
): Promise<AuditEntryDetail> {
  return invoke("get_audit_entry", { connectionId, entryId });
}

export function listHistoryPage(request: HistoryPageRequest): Promise<HistoryPage> {
  return invoke("list_history_page", { request });
}

export function getHistoryEntry(
  connectionId: string,
  historyId: string,
): Promise<HistoryEntryDetail> {
  return invoke("get_history_entry", { connectionId, historyId });
}
