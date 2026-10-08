export function checkFrontendArchitecture(harness) {
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

  const stateOwnershipPath = "docs/architecture/state-ownership.json";
  const stateOwnership = JSON.parse(read(stateOwnershipPath));
  const stateOwnershipSource = [
    ...sourceFiles.map(relative),
    ...walk("workspace-cloud/app").map(relative),
    ...walk("workspace-cloud/features").map(relative),
    ...walk("workspace-cloud/lib").map(relative),
  ]
    .filter((filePath, index, files) => (
      /\.(?:rs|ts|tsx)$/.test(filePath)
      && !/\.(?:test|spec)\.[^.]+$/.test(filePath)
      && files.indexOf(filePath) === index
    ))
    .map((filePath) => [filePath, read(filePath)]);

  // Literal enum boundaries must never coerce arrays or objects into an accepted
  // string. The only reviewed String-to-membership conversions normalize GCP's
  // loosely typed database flag values into a boolean and never return authority.
  const reviewedBooleanStringMembership = new Map([
    [
      "workspace-cloud/lib/providers/gcp-cloud-oauth.ts",
      '["on", "true", "1"].includes(String(item.value).toLowerCase())',
    ],
    [
      "workspace-cloud/lib/providers/gcp-cloud-sql.ts",
      '["on", "true", "1"].includes(String(flag.value).toLowerCase())',
    ],
  ]);
  for (const [filePath, source] of stateOwnershipSource.filter(
    ([candidate]) => candidate.startsWith("workspace-cloud/"),
  )) {
    let unreviewedSource = source;
    const reviewedExpression = reviewedBooleanStringMembership.get(filePath);
    if (reviewedExpression && unreviewedSource.includes(reviewedExpression)) {
      unreviewedSource = unreviewedSource.replace(reviewedExpression, "");
    }
    if (/\.includes\s*\(\s*String\s*\(/.test(unreviewedSource)) {
      failures.push(
        `${filePath}: literal membership must reject non-strings before comparison; String coercion is reserved for the reviewed GCP boolean flag normalization`,
      );
    }
  }
  const ownershipNames = new Set();
  for (const state of [...stateOwnership.states, ...stateOwnership.runtimeStates]) {
    if (ownershipNames.has(state.name)) {
      failures.push(`${stateOwnershipPath}: duplicate state owner name (${state.name})`);
    }
    ownershipNames.add(state.name);
    if (!exists(state.owner)) {
      failures.push(`${stateOwnershipPath}: ${state.name} owner is missing (${state.owner})`);
    }
    if (state.dispatcher && !exists(state.dispatcher)) {
      failures.push(
        `${stateOwnershipPath}: ${state.name} dispatcher is missing (${state.dispatcher})`,
      );
    }
    const ownerSource = exists(state.owner) ? read(state.owner) : "";
    for (const token of state.writerTokens ?? []) {
      if (!ownerSource.includes(token)) {
        failures.push(
          `${stateOwnershipPath}: ${state.name} owner writer marker is stale (${token})`,
        );
      }
    }
    for (const token of state.forbiddenWriterTokens ?? []) {
      const offender = stateOwnershipSource.find(([, source]) => source.includes(token));
      if (offender) {
        failures.push(`${offender[0]}: competing ${state.name} state writer returned (${token})`);
      }
    }
  }

  for (const workflow of walk(".github/workflows").filter((file) => /\.ya?ml$/.test(file))) {
    const filePath = relative(workflow);
    for (const match of read(filePath).matchAll(/\buses:\s+([^\s#]+)/g)) {
      const action = match[1];
      if (!action.startsWith("./") && !/@[0-9a-f]{40}$/.test(action)) {
        failures.push(`${filePath}: third-party action must use an immutable full commit SHA (${action})`);
      }
    }
  }

  failures.push(...collectDependencyParserSelfDiagnostics());
  for (const collect of [
    collectConnectionEditorDiagnostics,
    collectProviderOwnershipDiagnostics,
    collectI18nOwnershipDiagnostics,
    collectReleaseWorkflowDiagnostics,
    collectRepositoryIdentityDiagnostics,
    collectQueryProductionModuleDiagnostics,
    collectQueryTestModuleDiagnostics,
    collectQuerySharedCoreDiagnostics,
    collectRuntimeIdDiagnostics,
    collectQueryCentralCommandDiagnostics,
    collectQueryTauriCommandDiagnostics,
    collectQueryRuntimeOwnershipDiagnostics,
    collectPoisonMutexDiagnostics,
    collectTerminalSecurityDiagnostics,
    collectUpdaterOwnershipDiagnostics,
    collectWorkspaceCloudHttpDiagnostics,
  ]) failures.push(...collect(context));
  failures.push(...collectRemovedQueryRuntimeDiagnostics(rustSource));
  failures.push(...collectQueryCentralIpcDiagnostics(frontendSource));
  failures.push(...collectQueryFrontendOwnershipDiagnostics({
    frontendProductionSource,
    frontendSource,
  }));
  failures.push(...collectFrontendDependencyCycleDiagnostics(context));

  const {
    graph: frontendRuntimeDependencyGraph,
    specifiers: frontendRuntimeSpecifiers,
  } = buildRuntimeDependencyGraph(frontendProductionSource, {
    includeDynamic: true,
  });

  // Screens are composition leaves. Feature code may not reach back into a
  // screen-owned implementation. Only these reviewed AppShell files compose them.
  const screenCompositionRoots = new Set([
    "src/features/appShell/ShellLayout.tsx",
    "src/features/appShell/WorkbenchContent.tsx",
  ]);
  const appShellCompositionRoot = "src/features/appShell/AppShell.tsx";
  for (const [importer, dependencies] of frontendRuntimeDependencyGraph) {
    if (importer === appShellCompositionRoot) continue;
    for (const compositionRoot of screenCompositionRoots) {
      if (dependencies.includes(compositionRoot)) {
        failures.push(
          `${importer}: only ${appShellCompositionRoot} may import the reviewed screen composition root (${compositionRoot})`,
        );
      }
    }
  }
  const screenOwnershipDependencyGraph = new Map(frontendRuntimeDependencyGraph);
  for (const compositionRoot of screenCompositionRoots) {
    // The boundary is allowed to compose screens; callers depend on that boundary,
    // not on its screen implementation details.
    screenOwnershipDependencyGraph.set(compositionRoot, []);
  }
  for (const [filePath] of frontendProductionSource) {
    if (!filePath.startsWith("src/features/") || screenCompositionRoots.has(filePath)) {
      continue;
    }
    const screenPath = findDependencyPath(
      screenOwnershipDependencyGraph,
      filePath,
      (dependency) => dependency.startsWith("src/screens/"),
    );
    if (screenPath) {
      failures.push(
        `${filePath}: feature code must not reach a screen-owned module (${screenPath.join(" -> ")})`,
      );
    }
  }

  // Generic presentation layers stay runtime-agnostic. Domain-aware data hooks
  // and Tauri command adapters belong to feature-owned modules composed above them.
  // Walk every local runtime edge so an intermediate helper cannot hide ownership.
  const genericRuntimeProbe = buildRuntimeDependencyGraph([
    [
      "src/components/probe.ts",
      'export { probe } from "./probe-helper"',
    ],
    [
      "src/components/probe-helper.ts",
      'export const probe = () => import("@tauri-apps/api/core")',
    ],
    [
      "src/components/probe-negative.ts",
      'import type { invoke } from "@tauri-apps/api/core"',
    ],
  ], { includeDynamic: true });
  const genericTauriProbePath = findDependencyPath(
    genericRuntimeProbe.graph,
    "src/components/probe.ts",
    (dependency) => (genericRuntimeProbe.specifiers.get(dependency) ?? []).some(
      (specifier) => /^@tauri-apps(?:\/|$)/.test(specifier),
    ),
  );
  if (
    genericTauriProbePath?.join(" -> ")
      !== "src/components/probe.ts -> src/components/probe-helper.ts"
    || findDependencyPath(
      genericRuntimeProbe.graph,
      "src/components/probe-negative.ts",
      (dependency) => (genericRuntimeProbe.specifiers.get(dependency) ?? []).some(
        (specifier) => /^@tauri-apps(?:\/|$)/.test(specifier),
      ),
    ) !== null
  ) {
    failures.push("generic presentation Tauri runtime guard self-test failed");
  }
  for (const [filePath] of frontendProductionSource) {
    if (
      !filePath.startsWith("src/components/")
      && !filePath.startsWith("src/design-system/")
    ) {
      continue;
    }
    const tanstackPath = findDependencyPath(
      frontendRuntimeDependencyGraph,
      filePath,
      (dependency) => (frontendRuntimeSpecifiers.get(dependency) ?? []).some(
        (specifier) => (
          specifier === "@tanstack/react-query"
          || specifier.startsWith("@tanstack/react-query/")
        ),
      ),
    );
    if (tanstackPath) {
      failures.push(
        `${filePath}: generic presentation runtime must not reach @tanstack/react-query (${[
          ...tanstackPath,
          "@tanstack/react-query",
        ].join(" -> ")})`,
      );
    }
    const tauriRuntimePath = findDependencyPath(
      frontendRuntimeDependencyGraph,
      filePath,
      (dependency) => (frontendRuntimeSpecifiers.get(dependency) ?? []).some(
        (specifier) => /^@tauri-apps(?:\/|$)/.test(specifier),
      ),
    );
    if (tauriRuntimePath) {
      failures.push(
        `${filePath}: generic presentation runtime must not reach @tauri-apps (${[
          ...tauriRuntimePath,
          "@tauri-apps/*",
        ].join(" -> ")})`,
      );
    }
    const tauriAdapterPath = findDependencyPath(
      frontendRuntimeDependencyGraph,
      filePath,
      (dependency) => (
        dependency.startsWith("src/features/")
        && /\/tauriAdapter(?:\.[^/]+|\/)/.test(dependency)
      ),
    );
    if (tauriAdapterPath) {
      failures.push(
        `${filePath}: generic presentation runtime must not reach a feature Tauri adapter (${tauriAdapterPath.join(" -> ")})`,
      );
    }
  }

  const workbenchContent = read("src/features/appShell/WorkbenchContent.tsx");
  const coldWorkbenchScreens = [
    "Activity",
    "Connections/ConnectionForm",
    "Documents",
    "Knowledge",
    "Schema",
    "SchemaDiff",
    "Settings",
    "Sql",
    "Tables",
  ];
  for (const screen of coldWorkbenchScreens) {
    if (new RegExp(`^import\\s+[^;]+["']\\.\\.\\/\\.\\.\\/screens\\/${screen}["']`, "m").test(workbenchContent)) {
      failures.push(
        `src/features/appShell/WorkbenchContent.tsx: cold screen ${screen} must load through React.lazy`,
      );
    }
  }
  if (!/\blazy\s*\(/.test(workbenchContent) || !/\bSuspense\b/.test(workbenchContent)) {
    failures.push(
      "src/features/appShell/WorkbenchContent.tsx: cold workbench screens need one Suspense loading boundary",
    );
  }

  // AppShell is a composition root, not the owner of connection/query workflows
  // or Action Search catalog assembly. Its two large presentation children
  // receive grouped model/command contracts rather than rebuilding scalar bags.
  const appShellPath = "src/features/appShell/AppShell.tsx";
  const shellLayoutPath = "src/features/appShell/ShellLayout.tsx";
  const workbenchControllerPath =
    "src/features/appShell/useAppShellWorkbenchController.ts";
  const searchItemsPath =
    "src/features/actionSearch/useActionSearchItems.ts";
  const appShellSource = read(appShellPath);
  for (const [filePath, limit] of [
    [appShellPath, 520],
    [workbenchControllerPath, 550],
    [searchItemsPath, 260],
  ]) {
    const lines = lineCount(read(filePath));
    if (lines > limit) {
      failures.push(
        `${filePath}: AppShell boundary has ${lines} lines; keep it below ${limit}`,
      );
    }
  }
  for (const [pattern, responsibility] of [
    [/@tanstack\/react-query/, "TanStack Query ownership"],
    [/tauriAdapter/, "direct Tauri adapter ownership"],
    [/\bdatabaseCatalogQuery\b|\bdriversQuery\b/, "catalog query assembly"],
    [/\buseConnectionProfiles\b|\buseWorkbenchDocuments\b|\buseSafetySettings\b/, "connection/workbench state ownership"],
    [/\buseCachedCatalogOverviews\b|\bfilterCatalogOverview\b/, "Action Search catalog ownership"],
  ]) {
    if (pattern.test(appShellSource)) {
      failures.push(`${appShellPath}: composition root regained ${responsibility}`);
    }
  }
  for (const [component, source, filePath] of [
    ["ShellLayout", read(shellLayoutPath), shellLayoutPath],
    ["WorkbenchContent", workbenchContent, "src/features/appShell/WorkbenchContent.tsx"],
  ]) {
    const propsBlock = source.match(/type Props = \{(?<body>[\s\S]*?)\n\};/)?.groups?.body ?? "";
    const topLevelProps = [...propsBlock.matchAll(/^  ([A-Za-z][A-Za-z0-9]*):/gm)]
      .map((match) => match[1]);
    if (topLevelProps.join(",") !== "model,commands") {
      failures.push(
        `${filePath}: ${component} must expose only grouped model and commands props`,
      );
    }
    if (/@tanstack\/react-query|tauriAdapter/.test(source)) {
      failures.push(
        `${filePath}: grouped AppShell presentation must not own query or adapter effects`,
      );
    }
  }
  for (const component of ["ShellLayout", "WorkbenchContent"]) {
    const opening = appShellSource.match(
      new RegExp(`<${component}\\n(?<body>[\\s\\S]*?)\\n\\s*/>`),
    )?.groups?.body ?? "";
    const indentation = component === "ShellLayout" ? 8 : 6;
    const attributes = [...opening.matchAll(
      new RegExp(`^ {${indentation}}([A-Za-z][A-Za-z0-9]*)=`, "gm"),
    )].map((match) => match[1]);
    if (attributes.join(",") !== "model,commands") {
      failures.push(
        `${appShellPath}: ${component} call must pass only grouped model and commands (${attributes.join(", ") || "none"})`,
      );
    }
  }
  for (const token of [
    "useAppShellWorkbenchController",
    "useActionSearchItems",
    "useActionSearchDialog",
  ]) {
    if (!appShellSource.includes(token)) {
      failures.push(`${appShellPath}: bounded shell controller marker lost (${token})`);
    }
  }
  for (const token of [
    "<RenderRecoveryBoundary",
    "resetKeys={[focus.requestId]}",
    "<KnowledgeRecovery onRetry={retry}",
  ]) {
    if (!workbenchContent.includes(token)) {
      failures.push(
        `src/features/appShell/WorkbenchContent.tsx: Knowledge surface recovery boundary lost (${token})`,
      );
    }
  }

  // These screens are presentation leaves. Their feature controllers own
  // server cache, IPC commands, streaming, and mutation workflows; keep both sides
  // below the reviewed size ratchet so responsibility cannot silently flow back.
  for (const boundary of [
    {
      view: "src/screens/Connections/ConnectionForm.tsx",
      viewLimit: 180,
      controller: "src/features/connections/useConnectionEditorController.ts",
      controllerLimit: 120,
    },
    {
      view: "src/screens/Sql/index.tsx",
      viewLimit: 500,
      controller: "src/features/queries/useSqlWorkbenchController.ts",
      controllerLimit: 950,
    },
    {
      view: "src/screens/Knowledge/AnalysisArticles.tsx",
      viewLimit: 900,
      controller: "src/features/analysisArticles/useAnalysisArticlesController.ts",
      controllerLimit: 500,
    },
  ]) {
    for (const [filePath, limit] of [
      [boundary.view, boundary.viewLimit],
      [boundary.controller, boundary.controllerLimit],
    ]) {
      const lines = lineCount(read(filePath));
      if (lines > limit) {
        failures.push(`${filePath}: workflow boundary has ${lines} lines; keep it below ${limit}`);
      }
    }
    const viewSource = read(boundary.view);
    for (const [pattern, responsibility] of [
      [/@tanstack\/react-query/, "TanStack Query ownership"],
      [/tauriAdapter/, "direct IPC adapter ownership"],
      [/\buseSqlResultStream\b/, "query stream ownership"],
    ]) {
      if (pattern.test(viewSource)) {
        failures.push(`${boundary.view}: presentation regained ${responsibility}`);
      }
    }
  }

  // Connection editing keeps catalog, profile lifecycle, and schema discovery in
  // separate feature controllers. The screen root and its presentation leaves
  // consume only the grouped projection; they never regain cache or IPC ownership.
  const connectionEditorBoundaries = [
    ["src/screens/Connections/ConnectionAdvancedTab.tsx", 150],
    ["src/screens/Connections/ConnectionCatalogCompactSelector.tsx", 120],
    ["src/screens/Connections/ConnectionCatalogDetail.tsx", 220],
    ["src/screens/Connections/ConnectionCatalogNavigation.tsx", 600],
    ["src/screens/Connections/ConnectionEditorDialogs.tsx", 80],
    ["src/screens/Connections/ConnectionEditorFooter.tsx", 100],
    ["src/screens/Connections/ConnectionGeneralTab.tsx", 450],
    ["src/screens/Connections/ConnectionOptionsTab.tsx", 350],
    ["src/screens/Connections/ConnectionProfilePanel.tsx", 180],
    ["src/screens/Connections/ConnectionSchemaTab.tsx", 220],
    ["src/screens/Connections/ConnectionSecurityTab.tsx", 260],
    ["src/features/connections/connectionEditorModel.ts", 300],
    ["src/features/connections/useConnectionCatalogController.ts", 450],
    ["src/features/connections/useConnectionEditorDialogs.ts", 100],
    ["src/features/connections/useConnectionProfileController.ts", 500],
    ["src/features/connections/useConnectionProfileState.ts", 400],
    ["src/features/connections/useConnectionSchemaController.ts", 150],
  ];
  for (const [filePath, limit] of connectionEditorBoundaries) {
    const lines = lineCount(read(filePath));
    if (lines > limit) {
      failures.push(
        `${filePath}: Connection editor boundary has ${lines} lines; keep it below ${limit}`,
      );
    }
  }
  for (const [filePath] of connectionEditorBoundaries.filter(
    ([candidate]) => candidate.startsWith("src/screens/Connections/"),
  )) {
    const source = read(filePath);
    for (const [pattern, responsibility] of [
      [/@tanstack\/react-query|\.\.\/\.\.\/lib\/queries/, "TanStack Query ownership"],
      [/tauriAdapter|@tauri-apps(?:\/|\b)/, "Tauri adapter ownership"],
      [/\.(?:query|discovery)\b/, "raw async-result shape"],
    ]) {
      if (pattern.test(source)) {
        failures.push(
          `${filePath}: Connection presentation regained ${responsibility}`,
        );
      }
    }
  }
  const connectionEditorController = read(
    "src/features/connections/useConnectionEditorController.ts",
  );
  for (const token of [
    "profile: profileController.view",
    "catalog: catalog.view",
    "schema,",
    "dialogs:",
    "commands: profileController.commands",
  ]) {
    if (!connectionEditorController.includes(token)) {
      failures.push(
        `src/features/connections/useConnectionEditorController.ts: grouped Connection editor contract lost ${token}`,
      );
    }
  }
  for (const token of ["driverCatalog", "discovery"]) {
    if (connectionEditorController.includes(token)) {
      failures.push(
        `src/features/connections/useConnectionEditorController.ts: raw controller state escaped the grouped projection (${token})`,
      );
    }
  }

  // AI Chat keeps protocol/session state in one feature controller, while the
  // panel, transcript, and composer remain bounded presentation leaves. The
  // grouped controller contract also keeps stale focus generations beside the
  // commands that can race them rather than leaking adapter calls into JSX.
  const acpChatBoundaries = [
    ["src/features/agents/AcpChatPanel.tsx", 400],
    ["src/features/agents/AcpChatTranscript.tsx", 700],
    ["src/features/agents/AcpChatComposer.tsx", 350],
    ["src/features/agents/useAcpChatController.ts", 850],
    ["src/features/agents/acpTranscriptPresentation.ts", 350],
    ["src/features/agents/acpActivityLabels.ts", 160],
    ["src/features/agents/acpPromptContext.ts", 150],
  ];
  for (const [filePath, limit] of acpChatBoundaries) {
    const lines = lineCount(read(filePath));
    if (lines > limit) {
      failures.push(
        `${filePath}: ACP Chat boundary has ${lines} lines; keep it below ${limit}`,
      );
    }
  }
  for (const filePath of [
    "src/features/agents/AcpChatPanel.tsx",
    "src/features/agents/AcpChatTranscript.tsx",
    "src/features/agents/AcpChatComposer.tsx",
    "src/features/agents/acpTranscriptPresentation.ts",
    "src/features/agents/acpActivityLabels.ts",
    "src/features/agents/acpPromptContext.ts",
  ]) {
    const source = read(filePath);
    for (const [pattern, responsibility] of [
      [/@tanstack\/react-query|\buseQuery\b/, "TanStack Query ownership"],
      [/tauriAdapter/, "direct IPC adapter ownership"],
      [/sessionStore|sessionFocus/, "ACP session/focus store ownership"],
      [/@tauri-apps(?:\/|\b)/, "Tauri runtime effect ownership"],
    ]) {
      if (pattern.test(source)) {
        failures.push(`${filePath}: ACP presentation regained ${responsibility}`);
      }
    }
  }
  const acpChatPanel = read("src/features/agents/AcpChatPanel.tsx");
  for (const token of [
    "useAcpChatController",
    "<AcpChatTranscript",
    "<AcpChatComposer",
  ]) {
    if (!acpChatPanel.includes(token)) {
      failures.push(
        `src/features/agents/AcpChatPanel.tsx: ACP composition boundary lost ${token}`,
      );
    }
  }
  const acpChatController = read(
    "src/features/agents/useAcpChatController.ts",
  );
  for (const token of [
    "selectionGenerationRef",
    "focusRequestIdRef",
    "isCurrentAcpFocusRequest",
    "useAcpSessionSnapshot",
    "visibleAcpTranscriptItems",
    "viewport,",
    "session:",
    "setup:",
    "composer:",
    "commands:",
  ]) {
    if (!acpChatController.includes(token)) {
      failures.push(
        `src/features/agents/useAcpChatController.ts: ACP controller lost owned boundary marker (${token})`,
      );
    }
  }
  const acpChatViewport = read(
    "src/features/agents/useAcpChatViewport.ts",
  );
  for (const token of ["createFrameCoalescer", "transcriptRef", "beginResize"]) {
    if (!acpChatViewport.includes(token)) {
      failures.push(
        `src/features/agents/useAcpChatViewport.ts: ACP viewport lost owned boundary marker (${token})`,
      );
    }
  }
  const acpTranscriptPresentation = read(
    "src/features/agents/acpTranscriptPresentation.ts",
  );
  for (const token of [
    "selectRichTranscriptKeys",
    "findAnalysisArticle",
  ]) {
    if (!acpTranscriptPresentation.includes(token)) {
      failures.push(
        `src/features/agents/acpTranscriptPresentation.ts: transcript presentation lost ${token}`,
      );
    }
  }
  const acpActivityLabels = read("src/features/agents/acpActivityLabels.ts");
  if (!acpActivityLabels.includes("toolActivityLabel")) {
    failures.push("src/features/agents/acpActivityLabels.ts: activity presentation lost toolActivityLabel");
  }

  for (const [filePath, limit] of [
    ["site/app/page.tsx", 200],
  ]) {
    const lines = lineCount(read(filePath));
    if (lines > limit) {
      failures.push(`${filePath}: presentation boundary has ${lines} lines; keep it below ${limit}`);
    }
  }

  // Workspace provider administration lives in Desktop Settings → Providers. The
  // Neon branch manager and the shared-database flow stay split into views,
  // controllers and parsers instead of regrowing one module per workflow.
  const providerAdminRoot = "src/features/workspaceAdmin/providers";
  const providerAdminModules = (area) => walk(`${providerAdminRoot}/${area}`)
    .map(relative)
    .filter((filePath) => /\.(?:ts|tsx)$/.test(filePath));
  for (const [area, limit] of [["neonBranches", 750], ["databases", 600]]) {
    const modules = providerAdminModules(area);
    if (modules.length === 0) {
      failures.push(`${providerAdminRoot}/${area}: provider administration modules are missing`);
    }
    for (const filePath of modules) {
      const lines = lineCount(read(filePath));
      if (lines > limit) {
        failures.push(`${filePath}: provider administration module has ${lines} lines; keep it below ${limit}`);
      }
    }
  }
  // Neon branch views render their controller's state; only the controller and its
  // query module issue administration commands.
  for (const filePath of providerAdminModules("neonBranches").filter((path) => path.endsWith(".tsx"))) {
    if (/\b(?:runWorkspaceAdmin|workspaceAdminRequest)\s*\(/.test(read(filePath))) {
      failures.push(`${filePath}: presentation must call its feature controller rather than run administration commands directly`);
    }
  }

  // Provider accounts and shared databases are separate Desktop workflows. A
  // managed-inventory or import failure must not take the accounts view down, and
  // account authorization, connect or disconnect never flows into the database flow.
  for (const [area, forbiddenTokens] of [
    ["accounts", [
      "../databases/",
      "sharedConnectionsQuery",
      '"deleteSharedConnection"',
      '"claimProviderResource"',
      '"importProviderResource"',
      '"preflightNeonBootstrap"',
      '"applyNeonBootstrap"',
    ]],
    ["databases", [
      "../gcp/",
      "useProviderAuthorization",
      "startWorkspaceProviderAuthorization",
      '"connectNeon"',
      '"connectVault"',
      '"saveGcpIntegration"',
      '"disconnectProviderIntegration"',
    ]],
  ]) {
    for (const filePath of providerAdminModules(area)) {
      const source = read(filePath);
      for (const token of forbiddenTokens) {
        if (source.includes(token)) {
          failures.push(`${filePath}: provider workflow crossed the account/database boundary (${token})`);
        }
      }
    }
  }

  // The core provider read and the managed-connection inventory stay two requests,
  // from the Desktop query options through the Rust route to the server GET.
  const providerQueriesPath = `${providerAdminRoot}/queries.ts`;
  const providerQueries = read(providerQueriesPath);
  for (const token of [
    "export function providerAccountsQuery(",
    "includeManagedConnections: false,",
    "export function providerInventoryQuery(",
    "includeManagedConnections: true,",
  ]) {
    if (!providerQueries.includes(token)) {
      failures.push(
        `${providerQueriesPath}: provider core and managed-inventory requests lost their explicit split (${token})`,
      );
    }
  }
  const workspaceAdminRoutesPath = "src-tauri/src/features/workspace_admin/domain/routes.rs";
  if (
    !read(workspaceAdminRoutesPath).includes(
      'route.with_query("includeManagedConnections", "1".to_string())',
    )
  ) {
    failures.push(
      `${workspaceAdminRoutesPath}: managed connection inventory must stay an explicit opt-in query`,
    );
  }
  const providerIntegrationRoutePath =
    "workspace-cloud/app/api/v1/workspaces/[workspaceId]/provider-integrations/route.ts";
  const providerIntegrationRoute = read(providerIntegrationRoutePath);
  const providerIntegrationGet = providerIntegrationRoute.match(
    /export async function GET[\s\S]*?\n}\n\nexport async function POST/,
  )?.[0] ?? "";
  for (const token of [
    'searchParams.get(\n    "includeManagedConnections",\n  ) === "1"',
    "const managedRows = includeManagedConnections\n    ? await db.select({",
    "...(includeManagedConnections ? { managedConnections } : {}),",
  ]) {
    if (!providerIntegrationGet.includes(token)) {
      failures.push(
        `${providerIntegrationRoutePath}: core provider GET must gate managed connection inventory (${token})`,
      );
    }
  }
  if (providerIntegrationGet.includes("Promise.all([")) {
    failures.push(
      `${providerIntegrationRoutePath}: core provider GET must finish independently of managed connection inventory`,
    );
  }
  // The accounts view renders the core provider read first; the managed inventory
  // only enriches it, and its failure never becomes an accounts failure.
  const providerAccountsViewPath = `${providerAdminRoot}/accounts/ProviderAccountsView.tsx`;
  const providerAccountsView = read(providerAccountsViewPath);
  for (const token of [
    "useQuery(providerAccountsQuery(scope))",
    "enabled: accounts.isSuccess",
    "const accountsError = accounts.isError ?",
    "inventoryFailed={inventory.isError}",
  ]) {
    if (!providerAccountsView.includes(token)) {
      failures.push(
        `${providerAccountsViewPath}: account core must render before optional managed-inventory enrichment (${token})`,
      );
    }
  }
  const sharedDatabasesViewPath = `${providerAdminRoot}/databases/SharedDatabasesView.tsx`;
  if (!read(sharedDatabasesViewPath).includes("useQuery(providerInventoryQuery(scope))")) {
    failures.push(
      `${sharedDatabasesViewPath}: shared databases require the managed connection inventory request`,
    );
  }
  const providerAccountModelPath = `${providerAdminRoot}/accounts/accountModel.ts`;
  const providerAccountRowPath = `${providerAdminRoot}/accounts/ProviderAccountRow.tsx`;
  for (const [filePath, token] of [
    [providerAccountModelPath, "if (!managed) return null;"],
    [providerAccountRowPath, "managedDatabaseCount(managedConnections, integration.id)"],
    [providerAccountRowPath, '"workspaceProviders.accountDatabasesUnavailable"'],
  ]) {
    if (!read(filePath).includes(token)) {
      failures.push(
        `${filePath}: unavailable managed-inventory state must not render as a zero count (${token})`,
      );
    }
  }

  // Knowledge owns feature ports plus SQLite/hosted adapters. The facade and its
  // consumers name only ports; raw Store and reqwest ownership stop at their
  // corresponding adapters.
}
