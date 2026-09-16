// Recognizes a Broker SQL-proposal receipt anywhere inside an agent tool payload.
// Only the redacted identifiers are accepted, each shape-checked, so the SQL text
// is always fetched from the Broker instead of trusted from the transcript.
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

export function isSqlProposalTool(data: Record<string, unknown>) {
  const title = typeof data.title === "string" ? data.title : "";
  const meta = data._meta && typeof data._meta === "object"
    ? JSON.stringify(data._meta)
    : "";
  return `${title} ${meta}`.includes("sql_propose");
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
