// Validates operation references extracted from ACP SQL proposal tool payloads.

import type { OperationState } from "../../ipc/generated/protocol-contracts";

export type AgentSqlProposalReference = {
  operationId: string;
  connectionId: string;
  payloadHash: string;
  state: OperationState;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const STATES = new Set<OperationState>([
  "planned", "pending_approval", "ready", "approved", "rejected", "expired",
  "cancelled", "executing", "succeeded", "failed", "outcome_unknown",
]);
const FINAL_STATES = new Set<OperationState>([
  "rejected", "expired", "cancelled", "succeeded", "failed", "outcome_unknown",
]);

/** No further decision or execution can change a proposal in these states. */
export function isFinalOperationState(state: OperationState) {
  return FINAL_STATES.has(state);
}

/** The MCP server each in-app ACP session's bridge registers, and its proposal tool. */
const DESKTOP_MCP_SERVER = "dopedb-desktop-session";
const SQL_PROPOSE_TOOL = "sql_propose";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * True only for this session's own `sql_propose` call, identified by the exact
 * server and tool names each official adapter reports: Claude keeps the
 * qualified tool name in `_meta.claudeCode.toolName`; Codex marks MCP calls in
 * `_meta` and names the server and tool in its raw input. Display titles never
 * decide this.
 */
export function isSqlProposalTool(data: Record<string, unknown>) {
  const meta = record(data._meta);
  if (record(meta?.claudeCode)?.toolName === `mcp__${DESKTOP_MCP_SERVER}__${SQL_PROPOSE_TOOL}`) {
    return true;
  }
  const input = record(data.rawInput);
  return (
    meta?.is_mcp_tool_call === true &&
    input?.server === DESKTOP_MCP_SERVER &&
    input?.tool === SQL_PROPOSE_TOOL
  );
}

/** Finds only the redacted broker receipt; trusted SQL is loaded separately. */
export function findAgentSqlProposal(
  value: unknown,
  depth = 0,
): AgentSqlProposalReference | null {
  if (depth > 5 || value == null) return null;
  if (typeof value === "string") {
    try {
      return findAgentSqlProposal(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findAgentSqlProposal(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.operationId === "string" && UUID.test(record.operationId) &&
    typeof record.connectionId === "string" && UUID.test(record.connectionId) &&
    typeof record.payloadHash === "string" && HASH.test(record.payloadHash) &&
    typeof record.state === "string" && STATES.has(record.state as OperationState)
  ) {
    return {
      operationId: record.operationId,
      connectionId: record.connectionId,
      payloadHash: record.payloadHash,
      state: record.state as OperationState,
    };
  }
  for (const key of ["result", "data", "output", "rawOutput", "content", "text"] as const) {
    const found = findAgentSqlProposal(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}
