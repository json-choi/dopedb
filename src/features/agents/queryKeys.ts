export const agentQueryKeys = {
  pluginStatus: () => ["agentAcpPlugins"] as const,
  cliStatus: () => ["agentClis"] as const,
};
