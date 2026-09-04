export function checkAnalysisArchitecture(harness) {
  const {
    root,
    failures,
    relative,
    readTextFile,
    read,
    exists,
    walk,
    lineCount,
    sourceFiles,
    frontendSource,
    frontendProductionSource,
    rustSource,
    context,
    buildRuntimeDependencyGraph,
    collectDependencyParserSelfDiagnostics,
    findDependencyPath,
    collectConnectionEditorDiagnostics,
    collectFrontendDependencyCycleDiagnostics,
    collectI18nOwnershipDiagnostics,
    collectProviderOwnershipDiagnostics,
    collectQueryCentralIpcDiagnostics,
    collectQueryFrontendOwnershipDiagnostics,
    collectReleaseWorkflowDiagnostics,
    collectRepositoryIdentityDiagnostics,
    collectTerminalSecurityDiagnostics,
    collectUpdaterOwnershipDiagnostics,
    collectQueryCentralCommandDiagnostics,
    collectQueryProductionModuleDiagnostics,
    collectQueryRuntimeOwnershipDiagnostics,
    collectQuerySharedCoreDiagnostics,
    collectQueryTestModuleDiagnostics,
    collectQueryTauriCommandDiagnostics,
    collectRemovedQueryRuntimeDiagnostics,
    collectRuntimeIdDiagnostics,
    collectPoisonMutexDiagnostics,
    collectWorkspaceCloudHttpDiagnostics,
  } = harness;

  // Analysis Articles owns explicit local-repository, exact-read-execution, and
  // hosted-authority ports. The generic facade and business runner must remain
  // independent of SQLite, connection pools, HTTP, Tauri, and global AppState.
  const analysisRoot = "src-tauri/src/features/analysis_articles";
  const analysisAdapters = `${analysisRoot}/adapters`;
  const knowledgeTableReferencePattern =
    /\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\s+["`\[]?(knowledge_[a-z0-9_]+)/i;
  const knowledgeAdapterReferencePattern =
    /\bfeatures(?:::|\/)knowledge(?:::|\/)adapters\b/;
  if (
    !knowledgeTableReferencePattern.test("SELECT * FROM knowledge_mapping_proposals")
    || !knowledgeAdapterReferencePattern.test("crate::features::knowledge::adapters")
    || knowledgeAdapterReferencePattern.test("crate::features::knowledge::KnowledgeFeature")
  ) {
    failures.push("Analysis-to-Knowledge boundary guard self-test failed");
  }
  for (const filePath of walk(analysisRoot).map(relative).filter((candidate) => candidate.endsWith(".rs"))) {
    const source = read(filePath);
    const adapter = filePath.startsWith(`${analysisAdapters}/`);
    const hostedAdapter = filePath === `${analysisAdapters}/hosted.rs`
      || filePath.startsWith(`${analysisAdapters}/hosted_`);
    const knowledgeTable = source.match(knowledgeTableReferencePattern)?.[1];
    if (knowledgeTable) {
      failures.push(
        `${filePath}: Analysis must read Knowledge data through KnowledgeFeature (${knowledgeTable})`,
      );
    }
    if (knowledgeAdapterReferencePattern.test(source)) {
      failures.push(
        `${filePath}: Analysis must depend on the Knowledge facade, not Knowledge adapters`,
      );
    }
    if (
      /\bcrate::store::Store\b|\buse\s+crate::store::\{[^}]*\bStore\b/s.test(source)
      && !adapter
      && filePath !== `${analysisRoot}/mod.rs`
    ) {
      failures.push(`${filePath}: raw Store access is allowed only in Analysis adapters and composition`);
    }
    if (
      /\bConnectionManager\b|\bConnectionAccess\b|\bDbPool\b/.test(source)
      && !adapter
      && filePath !== `${analysisRoot}/mod.rs`
    ) {
      failures.push(`${filePath}: connection runtime access is allowed only in the Analysis read adapter and composition`);
    }
    if (/\breqwest\b|\bhosted_control_plane\b/.test(source) && !hostedAdapter) {
      failures.push(`${filePath}: Analysis hosted HTTP is allowed only in the hosted adapter family`);
    }
  }
  for (const [filePath, rules] of [
    [`${analysisRoot}/facade.rs`, [
      [/\bcrate::(?:store|connection|state|hosted_control_plane)(?:::|\b)|\breqwest(?:::|\b)|\bsqlx(?:::|\b)|\btauri(?:::|\b)/, "Analysis facade must depend only on feature ports"],
      [/(?:super|crate::features::analysis_articles)::adapters|\b(?:SqliteAnalysisLocalRepository|DesktopAnalysisReadExecution|HostedAnalysisAuthority)\b/, "Analysis facade must not name concrete adapters"],
    ]],
    [`${analysisRoot}/runner.rs`, [
      [/\bcrate::(?:store|connection|state|hosted_control_plane|audit)(?:::|\b)|\breqwest(?:::|\b)|\bsqlx(?:::|\b)|\btauri(?:::|\b)/, "Analysis runner must delegate platform execution through its read port"],
    ]],
    [`${analysisRoot}/ports.rs`, [
      [/\bcrate::(?:store|connection|state|hosted_control_plane)(?:::|\b)|\breqwest(?:::|\b)|\bsqlx(?:::|\b)|\btauri(?:::|\b)/, "Analysis ports must remain adapter-neutral"],
    ]],
  ]) {
    const source = read(filePath);
    for (const [pattern, reason] of rules) {
      if (pattern.test(source)) failures.push(`${filePath}: ${reason}`);
    }
  }
  if (exists(`${analysisRoot}/remote.rs`)) {
    failures.push(`${analysisRoot}/remote.rs: Analysis hosted HTTP must remain inside adapters/hosted.rs`);
  }
  if (!read(`${analysisAdapters}/hosted.rs`).includes("impl AnalysisHostedAuthorityPort for HostedAnalysisAuthority")) {
    failures.push("Analysis hosted adapter must implement AnalysisHostedAuthorityPort");
  }
  if (!read(`${analysisAdapters}/sqlite.rs`).includes("impl AnalysisLocalRepositoryPort for SqliteAnalysisLocalRepository")) {
    failures.push("Analysis SQLite adapter must implement AnalysisLocalRepositoryPort");
  }
  if (!read(`${analysisAdapters}/desktop_read.rs`).includes("impl AnalysisReadExecutionPort for DesktopAnalysisReadExecution")) {
    failures.push("Analysis Desktop read adapter must implement AnalysisReadExecutionPort");
  }

  // Shared protocol validation owns the compact cross-runtime safety and
  // authority invariants. It must not regain retired automation configuration
  // or acquire transport/storage dependencies.
  const analysisValidationPath =
    "dopedb-protocol/src/analysis_article_validation.rs";
  const analysisSqlValidationPath =
    "dopedb-protocol/src/analysis_article_sql.rs";
  const controlPlaneProtocolPath = "dopedb-protocol/src/control_plane.rs";
  for (const [filePath, limit] of [
    [analysisValidationPath, 550],
    [analysisSqlValidationPath, 150],
  ]) {
    const lines = lineCount(read(filePath));
    if (lines > limit) {
      failures.push(
        `${filePath}: shared protocol validator has ${lines} lines; keep it below ${limit}`,
      );
    }
  }
  const analysisValidation = read(analysisValidationPath);
  if (!analysisValidation.includes("definition.version == 3")) {
    failures.push(
      `${analysisValidationPath}: validator must enforce the current compact definition version`,
    );
  }
  const currentAnalysisContractPaths = [
    "dopedb-protocol/src/analysis_article.rs",
    "dopedb-cli/src/agent_mcp_tools.rs",
    "src/features/analysisArticles/domain.ts",
    `${analysisRoot}/domain.rs`,
    "workspace-cloud/lib/workspace-analysis-article-contracts.ts",
    "workspace-cloud/lib/workspace-analysis-runs.ts",
  ];
  const retiredAnalysisFieldPattern =
    /\b(?:AnalysisArticleConnection|sourceKnowledgeGrantId|source_knowledge_grant_id|graphRevisionIds|graph_revision_ids|connectionRole|connection_role|parameterIds|parameter_ids|parameterValues|parameter_values|cacheTtlSeconds|cache_ttl_seconds|backgroundAllowed|background_allowed|fragmentManifest|fragment_manifest|fragments|blockId|block_id|AnalysisArticleState|analysisArticleStates|liveRevision|live_revision|liveRunId|live_run_id)\b/;
  for (const filePath of currentAnalysisContractPaths) {
    if (retiredAnalysisFieldPattern.test(read(filePath))) {
      failures.push(
        `${filePath}: current Analysis contracts must not regain retired automation, parameter, or result-fragment fields`,
      );
    }
  }
  const retiredAnalysisRoutes = [
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/analyses/leases/route.ts",
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/analyses/members/route.ts",
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/analyses/migration-failures/route.ts",
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/analyses/notifications/route.ts",
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/analyses/[articleId]/runs/[runId]/fragments/route.ts",
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/analyses/[articleId]/runs/[runId]/results/route.ts",
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/analyses/[articleId]/signals/route.ts",
  ];
  for (const filePath of retiredAnalysisRoutes) {
    if (exists(filePath)) {
      failures.push(`${filePath}: retired Analysis API must not be restored`);
    }
  }
  const retiredDesktopCommands =
    /\b(?:transition_analysis_article_command|transfer_analysis_article_command|restore_analysis_article_revision_command|list_analysis_runners_command|revoke_analysis_runner_command|list_analysis_collaborators_command|list_analysis_signals_command|create_analysis_signal_command|update_analysis_signal_command|set_analysis_signal_enabled_command|delete_analysis_signal_command|list_analysis_signal_receipts_command|list_analysis_notifications_command|mark_analysis_notifications_read_command|get_analysis_article_result_command|automation_runner_settings|set_automation_runner_background_allowed)\b/;
  for (const filePath of ["src-tauri/src/lib.rs", "src/features/analysisArticles/tauriAdapter.ts"]) {
    if (retiredDesktopCommands.test(read(filePath))) {
      failures.push(`${filePath}: retired Analysis Desktop command must not be registered`);
    }
  }
  const retiredAgentArticleSurface =
    /\b(?:AnalysisArticleDraftDefinition|AnalysisArticleDraftRunArguments|AnalysisArticleDraftRunCommand|AnalysisArticleUpdateDraftArguments|AnalysisArticleUpdateDraftCommand|AnalysisArticleDraftRun|AnalysisArticleUpdateDraft|analysis_article_draft_run|analysis_article_update_draft)\b|analysis_article\.(?:draft_run|update_draft)/;
  for (const filePath of [
    "dopedb-protocol/src/analysis_article.rs",
    "dopedb-protocol/src/analysis_article_command.rs",
    "dopedb-protocol/src/request.rs",
    "dopedb-cli/src/agent_mcp.rs",
    "dopedb-cli/src/agent_mcp_dispatch.rs",
    "dopedb-cli/src/agent_mcp_tools.rs",
    "src-tauri/src/broker/dispatch/analysis_article_operation.rs",
  ]) {
    if (retiredAgentArticleSurface.test(read(filePath))) {
      failures.push(`${filePath}: retired Analysis draft command surface must not return`);
    }
  }
  const hostedAnalysisAdapter = read(`${analysisAdapters}/hosted.rs`);
  if (!hostedAnalysisAdapter.includes("article.definition.version != 3")) {
    failures.push(
      `${analysisAdapters}/hosted.rs: hosted Article responses must enforce the current v3 definition`,
    );
  }
  const analysisArticleStore = read(
    "workspace-cloud/lib/workspace-analysis-article-store.ts",
  );
  if (/\b(?:live_revision|live_run_id|next_refresh_at)\b/.test(analysisArticleStore)) {
    failures.push(
      "workspace-cloud/lib/workspace-analysis-article-store.ts: removed Analysis lifecycle columns must not return",
    );
  }
  const analysisSchema = read("workspace-cloud/lib/schema.ts");
  if (
    /\b(?:workspaceAnalysisArticleConnection|workspaceAnalysisArticleGraph|workspaceAnalysisRefreshLease|workspaceAnalysisResultFragment|workspaceAnalysisSignal|workspaceAnalysisSignalRevision|workspaceAnalysisSignalReceipt|workspaceAnalysisNotificationAttempt|workspaceAnalysisMigrationFailure|sourceKnowledgeGrantId|liveRevision|liveRunId|nextRefreshAt|backgroundAllowed|leaseId|parameterValues|parameterHash)\b/.test(
      analysisSchema,
    )
  ) {
    failures.push(
      "workspace-cloud/lib/schema.ts: pre-MVP Analysis automation, result, and migration storage must not return",
    );
  }
  const analysisArticleHttp = read(
    "workspace-cloud/lib/workspace-analysis-article-http.ts",
  );
  if (/\bincludeWorking\b|\bliveRevision\b|\bliveRunId\b/.test(analysisArticleHttp)) {
    failures.push(
      "workspace-cloud/lib/workspace-analysis-article-http.ts: current Article reads must not branch on the retired lifecycle",
    );
  }
  for (const filePath of [
    "src/screens/Connections/DatabaseExplorerToolbar.tsx",
    "src/screens/Connections/KnowledgeProjectTree.tsx",
    "src/screens/Connections/useDatabaseExplorerKnowledge.ts",
  ]) {
    if (/\banalysisStateFilter\b|analysis\.state(?:FilterLabel|Draft|Review|Live|Archived)/.test(read(filePath))) {
      failures.push(`${filePath}: retired Analysis lifecycle controls must not return`);
    }
  }
  if (
    /\bchrono_tz\b|\bcron(?:_parser)?::|\bCronExpressionParser\b|\bcron-parser\b|\bparameter_ids\b|\bcache_ttl_seconds\b/.test(
      analysisValidation,
    )
  ) {
    failures.push(
      `${analysisValidationPath}: current validation must not restore retired automation or parameter fields`,
    );
  }
  for (const filePath of [
    analysisValidationPath,
    analysisSqlValidationPath,
    controlPlaneProtocolPath,
  ]) {
    if (/\b(?:reqwest|sqlx|tauri)(?:::|\b)/.test(read(filePath))) {
      failures.push(
        `${filePath}: shared protocol validation must remain transport and storage neutral`,
      );
    }
  }

  // Hosted workspace responses are untrusted network input. Request serialization
  // may use `.json(&value)`, but response bodies must pass through the shared
  // content-type and byte-cap reader before deserialization.
  for (const filePath of [
    "src-tauri/src/features/workspaces/adapters/control_plane/authentication.rs",
    "src-tauri/src/features/workspaces/adapters/control_plane/connections.rs",
    "src-tauri/src/features/workspaces/adapters/control_plane/sync.rs",
  ]) {
    const source = read(filePath);
    if (/\.json\s*(?:::\s*<[^>]+>)?\s*\(\s*\)\s*\.await/s.test(source)) {
      failures.push(`${filePath}: hosted response JSON must use bounded_json_response`);
    }
    if (!source.includes("hosted_control_plane::bounded_json_response")) {
      failures.push(`${filePath}: hosted response parser must use the shared bounded reader`);
    }
  }

  // Rust's Knowledge wire contract rejects every Unicode control character. Keep
  // cloud ingestion from accepting C1 controls (U+0080-U+009F) that would survive
  // until Desktop validation and make an otherwise activated graph unusable.
  for (const directory of [
    "workspace-cloud/lib/knowledge",
    "workspace-cloud/app/api/v1/knowledge",
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/knowledge",
  ]) {
    for (const filePath of walk(directory).map(relative).filter((candidate) => candidate.endsWith(".ts"))) {
      if (/\\u0000-\\u001f\\u007f\]/.test(read(filePath))) {
        failures.push(`${filePath}: Knowledge text validation must reject C1 controls through \\u009f`);
      }
    }
  }
}
