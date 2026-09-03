export function checkKnowledgeArchitecture(harness) {
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

  const knowledgeAdapterDirectory =
    "src-tauri/src/features/knowledge/adapters";
  const knowledgeCompositionPath = "src-tauri/src/features/knowledge/mod.rs";
  const knowledgeComposition = read(knowledgeCompositionPath);
  for (const moduleName of ["adapters", "ports", "runtime_adapter"]) {
    const declarations = [...knowledgeComposition.matchAll(
      new RegExp(`^(?<visibility>\\s*pub(?:\\([^)]*\\))?\\s+)?mod\\s+${moduleName}\\s*;`, "gm"),
    )];
    if (declarations.length !== 1 || declarations[0].groups?.visibility) {
      failures.push(
        `${knowledgeCompositionPath}: ${moduleName} must remain a private production module`,
      );
    }
  }
  if (!knowledgeComposition.includes(
    "pub(crate) use adapters::local::LocalFolderAdapter;",
  )) {
    failures.push(
      `${knowledgeCompositionPath}: AppState may receive LocalFolderAdapter only through its narrow root re-export`,
    );
  }
  if (
    !/pub\(crate\) fn compose\(store: crate::store::Store\) -> KnowledgeFeature/.test(
      knowledgeComposition,
    )
    || !knowledgeComposition.includes(
      "adapters::SqliteKnowledgeRepository::new(store)",
    )
  ) {
    failures.push(
      `${knowledgeCompositionPath}: production composition must construct concrete Knowledge adapters behind compose(store)`,
    );
  }
  if (!/#\[cfg\(test\)\]\s*pub\(crate\) mod test_support/.test(knowledgeComposition)) {
    failures.push(
      `${knowledgeCompositionPath}: concrete Knowledge test access must remain cfg(test)-only`,
    );
  }
  function rustArchitectureTokens(source) {
    const tokens = [];
    let cursor = 0;
    const push = (value) => tokens.push({ start: cursor, value });
    while (cursor < source.length) {
      if (/\s/.test(source[cursor])) {
        cursor += 1;
        continue;
      }
      if (source.startsWith("//", cursor)) {
        cursor += 2;
        while (cursor < source.length && !/[\r\n]/.test(source[cursor])) cursor += 1;
        continue;
      }
      if (source.startsWith("/*", cursor)) {
        cursor += 2;
        let depth = 1;
        while (cursor < source.length && depth > 0) {
          if (source.startsWith("/*", cursor)) {
            depth += 1;
            cursor += 2;
          } else if (source.startsWith("*/", cursor)) {
            depth -= 1;
            cursor += 2;
          } else {
            cursor += 1;
          }
        }
        continue;
      }
      const rawString = source.slice(cursor).match(/^(?:b|c)?r(#{0,255})"/);
      if (rawString) {
        const terminator = `"${rawString[1]}`;
        cursor += rawString[0].length;
        const close = source.indexOf(terminator, cursor);
        cursor = close < 0 ? source.length : close + terminator.length;
        continue;
      }
      const quoteOffset = (
        ["b", "c"].includes(source[cursor])
        && ["\"", "'"].includes(source[cursor + 1])
      ) ? 1 : 0;
      const quote = source[cursor + quoteOffset];
      if (quote === "\"" || (
        quote === "'"
        && source.slice(cursor + quoteOffset + 1).match(/^(?:\\.|[^'\r\n])'/)
      )) {
        cursor += quoteOffset + 1;
        while (cursor < source.length) {
          if (source[cursor] === "\\") {
            cursor += 2;
          } else if (source[cursor] === quote) {
            cursor += 1;
            break;
          } else {
            cursor += 1;
          }
        }
        continue;
      }
      if (/[A-Za-z_]/.test(source[cursor])) {
        const start = cursor;
        cursor += 1;
        while (/[A-Za-z0-9_]/.test(source[cursor] ?? "")) cursor += 1;
        tokens.push({ start, value: source.slice(start, cursor) });
        continue;
      }
      if (source.startsWith("::", cursor)) {
        push("::");
        cursor += 2;
        continue;
      }
      push(source[cursor]);
      cursor += 1;
    }
    return tokens;
  }

  function matchingRustToken(tokens, openIndex, open, close) {
    let depth = 0;
    for (let index = openIndex; index < tokens.length; index += 1) {
      if (tokens[index].value === open) depth += 1;
      if (tokens[index].value === close) depth -= 1;
      if (depth === 0) return index;
    }
    return -1;
  }

  function rustFunctionSource(source, functionName) {
    const tokens = rustArchitectureTokens(source);
    const matches = [];
    for (let index = 0; index < tokens.length - 1; index += 1) {
      if (
        tokens[index].value !== "fn"
        || tokens[index + 1].value !== functionName
      ) {
        continue;
      }
      const openIndex = tokens.findIndex(
        (token, tokenIndex) => tokenIndex > index + 1 && token.value === "{",
      );
      if (openIndex < 0) continue;
      const closeIndex = matchingRustToken(tokens, openIndex, "{", "}");
      if (closeIndex >= 0) {
        matches.push(source.slice(tokens[index].start, tokens[closeIndex].start + 1));
      }
    }
    return matches.length === 1 ? matches[0] : "";
  }

  function knowledgeStoreMethods(source) {
    const tokens = rustArchitectureTokens(source);
    const methods = [];
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].value !== "impl") continue;
      const openIndex = tokens.findIndex(
        (token, tokenIndex) => tokenIndex > index && token.value === "{",
      );
      if (openIndex < 0) break;
      const header = tokens.slice(index + 1, openIndex)
        .map((token) => token.value)
        .join("");
      const closeIndex = matchingRustToken(tokens, openIndex, "{", "}");
      if (closeIndex < 0) break;
      if (/^(?:crate::store::)?Store(?:where.*)?$/.test(header)) {
        let braceDepth = 0;
        for (let cursor = openIndex + 1; cursor < closeIndex; cursor += 1) {
          if (tokens[cursor].value === "{") {
            braceDepth += 1;
            continue;
          }
          if (tokens[cursor].value === "}") {
            braceDepth -= 1;
            continue;
          }
          if (braceDepth !== 0 || tokens[cursor].value !== "pub") continue;
          let qualifier = "public";
          let declaration = cursor + 1;
          if (tokens[declaration]?.value === "(") {
            const qualifierClose = matchingRustToken(tokens, declaration, "(", ")");
            if (qualifierClose < 0) continue;
            qualifier = tokens.slice(declaration + 1, qualifierClose)
              .map((token) => token.value)
              .join("");
            declaration = qualifierClose + 1;
          }
          while ([
            "default", "const", "async", "safe", "unsafe", "extern",
          ].includes(tokens[declaration]?.value)) {
            declaration += 1;
          }
          if (
            tokens[declaration]?.value === "fn"
            && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tokens[declaration + 1]?.value ?? "")
          ) {
            methods.push({ name: tokens[declaration + 1].value, qualifier });
          }
        }
      }
      index = closeIndex;
    }
    return methods;
  }

  const knowledgeStoreVisibilityProbe = knowledgeStoreMethods(`
  impl Store {
    pub(crate) fn leaked_sync() {}
    pub(in crate::features::knowledge) async fn leaked_scoped() {}
    pub async fn leaked_public() {}
    pub(crate) unsafe fn leaked_unsafe() {}
    pub(in crate::features::knowledge) const fn leaked_const() {}
    pub async unsafe fn leaked_async_unsafe() {}
    pub(crate) extern "C" fn leaked_extern() {}
    pub(crate) const unsafe extern "C-unwind" fn leaked_all_modifiers() {}
    pub(crate) safe extern "C" fn leaked_safe_extern() {}
    pub(crate) default fn leaked_default() {}
    pub(super) async unsafe fn adapter_owned_async() {}
    pub(super) const unsafe extern "C" fn adapter_owned_const() {}
    fn private_helper() {}
    const TEXT: &str = "pub(crate) unsafe fn string_decoy() {}";
    /* pub(crate) const fn comment_decoy() {} */
  }
  impl Repository for Store {
    pub(crate) fn trait_impl_decoy() {}
  }
  `);
  if (
    knowledgeStoreVisibilityProbe
      .map(({ name, qualifier }) => `${qualifier}:${name}`)
      .join(",")
      !== "crate:leaked_sync,incrate::features::knowledge:leaked_scoped,public:leaked_public,crate:leaked_unsafe,incrate::features::knowledge:leaked_const,public:leaked_async_unsafe,crate:leaked_extern,crate:leaked_all_modifiers,crate:leaked_safe_extern,crate:leaked_default,super:adapter_owned_async,super:adapter_owned_const"
  ) {
    failures.push("Knowledge SQLite Store visibility guard self-test failed");
  }
  const knowledgeSqliteStoreSources = walk(knowledgeAdapterDirectory)
    .map(relative)
    .filter((filePath) => (
      filePath.endsWith(".rs")
      && filePath.startsWith(`${knowledgeAdapterDirectory}/sqlite`)
    ))
    .map((filePath) => [filePath, knowledgeStoreMethods(read(filePath))])
    .filter(([, methods]) => methods.length > 0);
  if (knowledgeSqliteStoreSources.length === 0) {
    failures.push("Knowledge SQLite adapter must retain an inherent Store implementation");
  }
  for (const [filePath, methods] of knowledgeSqliteStoreSources) {
    const nestedStoreModule = filePath.startsWith(
      `${knowledgeAdapterDirectory}/sqlite_store/`,
    );
    for (const { name, qualifier } of methods) {
      const adapterOwned = qualifier === "super" || (
        nestedStoreModule
        && qualifier === "incrate::features::knowledge::adapters"
      );
      if (!adapterOwned) {
        failures.push(
          `${filePath}: Knowledge Store method must remain visible only inside its adapter (${name})`,
        );
      }
    }
  }
  const knowledgeRust = walk("src-tauri/src/features/knowledge")
    .map(relative)
    .filter((filePath) => filePath.endsWith(".rs"));
  for (const filePath of knowledgeRust) {
    const source = read(filePath);
    if (
      /\b(?:crate::)?features::workspaces::adapters::control_plane\b|\bcrate::features::workspaces::adapters\b/.test(source)
    ) {
      failures.push(`${filePath}: Knowledge must use its feature-owned hosted authority adapter`);
    }
    if (
      /\bcrate::store::Store\b|\buse\s+crate::store::\{[^}]*\bStore\b/s.test(source)
      && !filePath.startsWith("src-tauri/src/features/knowledge/adapters/sqlite")
      && filePath !== knowledgeCompositionPath
    ) {
      failures.push(`${filePath}: raw Store access is allowed only in the Knowledge SQLite adapter`);
    }
  }
  if (exists("src-tauri/src/features/knowledge/remote.rs")) {
    failures.push("src-tauri/src/features/knowledge/remote.rs: hosted Knowledge HTTP must remain inside adapters/hosted.rs");
  }
  for (const [filePath, rules] of [
    ["src-tauri/src/features/knowledge/facade.rs", [
      [/(?:super|crate::features::knowledge)::adapters|\bSqliteKnowledgeRepository\b|\bHostedKnowledgeAuthority\b/, "Knowledge facade must depend on repository and hosted-authority ports"],
      [/\breqwest\b|\bhosted_control_plane\b/, "Knowledge facade must not own hosted HTTP"],
      [/\bcrate::store\b/, "Knowledge facade must use kernel access contracts rather than Store-owned types"],
    ]],
    ["src-tauri/src/features/knowledge/transport.rs", [
      [/(?:super|crate::features::knowledge)::adapters|\breqwest\b|\bhosted_control_plane\b/, "Knowledge transport must consume the facade rather than concrete adapters"],
    ]],
    ["src-tauri/src/features/knowledge/ports.rs", [
      [/\breqwest\b|\bhosted_control_plane\b|\bSqliteKnowledgeRepository\b|\bHostedKnowledgeAuthority\b/, "Knowledge ports must remain adapter-neutral"],
      [/\bcrate::store\b/, "Knowledge ports must use kernel access contracts rather than persistence-owned types"],
      [/\bfeatures::agents\b/, "Knowledge ports must own their read models rather than import Agent projections"],
    ]],
  ]) {
    const source = read(filePath);
    for (const [pattern, reason] of rules) {
      if (pattern.test(source)) failures.push(`${filePath}: ${reason}`);
    }
  }
  if (!read("src-tauri/src/features/knowledge/adapters/hosted.rs").includes("impl HostedKnowledgeAuthorityPort for HostedKnowledgeAuthority")) {
    failures.push("Knowledge hosted adapter must implement HostedKnowledgeAuthorityPort");
  }
  if (!read("src-tauri/src/features/knowledge/adapters/sqlite.rs").includes("impl KnowledgeRepositoryPort for SqliteKnowledgeRepository")) {
    failures.push("Knowledge SQLite adapter must implement KnowledgeRepositoryPort");
  }
  if (exists("src-tauri/src/store/repositories/knowledge.rs")) {
    failures.push("Knowledge SQLite statements must remain owned by the feature adapter, not Store repositories");
  }
  if (/features::knowledge::transport/.test(read("src-tauri/src/features/agents/transport.rs"))) {
    failures.push("Agent transport must call the Knowledge application facade, not Knowledge transport helpers");
  }
  const knowledgeTransport = [
    "src-tauri/src/features/knowledge/transport.rs",
    "src-tauri/src/features/knowledge/transport_projects.rs",
    "src-tauri/src/features/knowledge/transport_sources.rs",
    "src-tauri/src/features/knowledge/transport_graph.rs",
  ].map(read).join("\n");
  const projectListQuery = rustFunctionSource(
    knowledgeTransport,
    "list_knowledge_projects_command",
  );
  const fetchActiveProjectInventory = rustFunctionSource(
    knowledgeTransport,
    "fetch_active_project_inventory",
  );
  const persistTeamProjectInventory = rustFunctionSource(
    knowledgeTransport,
    "persist_team_project_inventory",
  );
  const activeProjectInventory = rustFunctionSource(
    knowledgeTransport,
    "active_project_inventory",
  );
  if ([
    projectListQuery,
    fetchActiveProjectInventory,
    persistTeamProjectInventory,
    activeProjectInventory,
  ].some((source) => !source)) {
    failures.push("Knowledge Project inventory query/cache helpers must remain inspectable");
  }
  const compactProjectListQuery = projectListQuery.replace(/\s+/g, "");
  if (
    !compactProjectListQuery.includes(
      "letprojects=fetch_active_project_inventory(&state,&scope).await?;",
    )
    || !compactProjectListQuery.includes(
      "ifletErr(error)=persist_team_project_inventory(&state,&scope,&projects).await{",
    )
    || !compactProjectListQuery.includes("tracing::warn!(")
    || !compactProjectListQuery.includes("Ok(projects)")
  ) {
    failures.push(
      "Knowledge Project listing must return fetched inventory while isolating cache-write failures",
    );
  }
  const compactStrictProjectInventory = activeProjectInventory.replace(/\s+/g, "");
  if (
    !compactStrictProjectInventory.includes(
      "letprojects=fetch_active_project_inventory(state,scope).await?;",
    )
    || !compactStrictProjectInventory.includes(
      "persist_team_project_inventory(state,scope,&projects).await?;",
    )
    || !compactStrictProjectInventory.includes("Ok(projects)")
  ) {
    failures.push(
      "Knowledge mutation/source workflows must strictly persist fetched Project inventory",
    );
  }
  for (const functionName of [
    "active_remote_scope",
    "create_knowledge_environment_command",
    "connect_knowledge_local_folder",
  ]) {
    const caller = rustFunctionSource(knowledgeTransport, functionName);
    if (!caller || !/active_project_inventory\s*\(/.test(caller)) {
      failures.push(
        `${functionName} must use the strict Knowledge Project inventory path`,
      );
    }
  }
  // A Team Project list may refresh its bounded local remote-inventory cache, and
  // cache failure must not hide a successful fetch. Neither phase may reconcile
  // access authority or mutate grants/Environment bindings; those workflows stay
  // explicit commands. Mutation/source callers use the strict wrapper instead.
  if (
    /reconcile_current_access|bind_environment_connection|revoke_environment_connection/.test(
      [
        projectListQuery,
        fetchActiveProjectInventory,
        persistTeamProjectInventory,
        activeProjectInventory,
      ].join("\n"),
    )
  ) {
    failures.push(
      "Knowledge Project listing may cache remote inventory but must not reconcile access or bind/revoke Environment connections",
    );
  }
  const environmentConnectionQuery = knowledgeTransport.match(
    /pub\(crate\) async fn list_knowledge_environment_connections[\s\S]*?\n}\n\n#\[tauri::command]/,
  )?.[0] ?? "";
  if (/bind_environment_connection/.test(environmentConnectionQuery)) {
    failures.push("Knowledge Environment connection listing must remain a side-effect-free query");
  }
  if (/pub\(crate\) struct (?:AccountScope|ActiveResourceScope|PinnedConnection|CatalogCachePolicy)/.test(read("src-tauri/src/store/mod.rs"))) {
    failures.push("exact access authority must remain owned by kernel/access.rs, not Store");
  }
  for (const directory of ["src-tauri/src/features/analysis_articles", "src-tauri/src/broker"]) {
    for (const filePath of walk(directory).map(relative).filter((candidate) => candidate.endsWith(".rs"))) {
      if (/features::knowledge::adapters|features::knowledge::remote/.test(read(filePath))) {
        failures.push(`${filePath}: cross-feature Knowledge consumers must use KnowledgeFeature ports`);
      }
    }
  }
  for (const directory of ["src-tauri/src/features/analysis_articles", "src-tauri/src/broker"]) {
    for (const filePath of walk(directory).map(relative).filter((candidate) => candidate.endsWith(".rs"))) {
      if (
        /\b(?:crate::)?features::workspaces::adapters::control_plane\b|\bcrate::features::workspaces::adapters\b/.test(read(filePath))
      ) {
        failures.push(`${filePath}: feature must not import the concrete Workspace control-plane adapter`);
      }
    }
  }
  if (/\bknowledge_store\s*\(/.test(rustSource)) {
    failures.push("removed raw AppState::knowledge_store accessor returned");
  }
  if (!read("src-tauri/src/services/mod.rs").includes("pub(crate) knowledge: KnowledgeFeature")) {
    failures.push("ApplicationServices must expose the KnowledgeFeature facade, not a raw Store");
  }
  const applicationServicesSource = read("src-tauri/src/services/mod.rs");
  if (
    !applicationServicesSource.includes("let knowledge = knowledge::compose(store.clone());")
    || /knowledge::(?:adapters|ports|runtime_adapter)/.test(applicationServicesSource)
  ) {
    failures.push(
      "ApplicationServices must construct Knowledge only through knowledge::compose(store)",
    );
  }

  // Long-lived Knowledge work receives dependencies at composition time. Tauri
  // must never become a global AppState service locator or a path back into a
  // feature transport helper.
  for (const [filePath, rules] of [
    ["src-tauri/src/features/knowledge/runtime.rs", [
      [/\bAppState\b|\.state\s*::\s*</, "Knowledge watcher runtime must use injected dependencies rather than AppHandle state lookup"],
      [/\btauri(?:::|\b)/, "Knowledge watcher runtime must emit through its desktop event port"],
      [/\b(?:super::transport|crate::features::[A-Za-z0-9_]+::transport)\b/, "Knowledge watcher runtime must not call a feature transport helper"],
    ]],
    ["src-tauri/src/features/knowledge/source_sync.rs", [
      [/\bAppState\b|\.state\s*::\s*</, "Knowledge source synchronization must use its injected feature facade"],
      [/\b(?:super::transport|crate::features::[A-Za-z0-9_]+::transport)\b/, "Knowledge source synchronization must not depend on a feature transport"],
    ]],
  ]) {
    const source = read(filePath);
    for (const [pattern, reason] of rules) {
      if (pattern.test(source)) failures.push(`${filePath}: ${reason}`);
    }
  }

  // The ACP session actor remains singular, while platform responsibilities live
  // behind small sibling ports. Keep Tauri and process/persistence details from
  // accreting back into the actor module.
  const acpActorPath = "src-tauri/src/features/agents/acp.rs";
  const acpActor = read(acpActorPath);
  if (lineCount(acpActor) > 1_850) {
    failures.push(`${acpActorPath}: ACP session actor has ${lineCount(acpActor)} lines; keep boundary work in acp/* ports`);
  }
  if (/\btauri(?:::|\b)/.test(acpActor)) {
    failures.push(`${acpActorPath}: ACP session actor must emit and launch through owned ports`);
  }
  for (const [filePath, contract] of [
    ["src-tauri/src/features/agents/acp/persistence.rs", "trait AcpSessionPersistencePort"],
    ["src-tauri/src/features/agents/acp/process.rs", "trait AcpProcessLaunchPort"],
    ["src-tauri/src/features/agents/acp/event_sink.rs", "trait AcpSessionEventSink"],
    ["src-tauri/src/features/agents/acp/knowledge_scope.rs", "trait AcpKnowledgeScopePort"],
  ]) {
    if (!exists(filePath) || !read(filePath).includes(contract)) {
      failures.push(`${filePath}: ACP boundary must retain ${contract}`);
    }
  }
}
