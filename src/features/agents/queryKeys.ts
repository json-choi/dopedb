export const agentQueryKeys = {
  pluginStatus: () => ["agentAcpPlugins"] as const,
  cliStatus: () => ["agentClis"] as const,
  /** One exact proposal: a different payload hash is never served from cache. */
  sqlProposalReview: (operationId: string, payloadHash: string) =>
    ["agentSqlProposalReview", operationId, payloadHash] as const,
};
