import type { ConnectionId } from "../connections/domain";
import type { AgentResourceScopeSelection } from "./domain";
import type { AgentSqlProposalReference } from "./sqlProposal";

export type ExternalAgentProvider = "codex" | "claude";

export interface ExternalAgentConfig {
  schemaVersion: 1;
  provider: ExternalAgentProvider;
  projectId: string;
  anchorConnectionId: ConnectionId;
  resourceScopes: AgentResourceScopeSelection[];
  writeConnectionId?: ConnectionId;
}

/**
 * `proposal` entries are SQL changes proposed by an approved external Agent
 * process. They are decided only through the exact operation approval card.
 */
export interface ExternalAgentRequestSummary {
  id: string;
  kind: "configure" | "start" | "proposal";
  provider: ExternalAgentProvider;
  workingDirectory: string;
  config?: ExternalAgentConfig;
  proposal?: AgentSqlProposalReference;
}

