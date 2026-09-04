const rustCoreModules = [
  "src-tauri/src/features/providers/domain.rs",
  "src-tauri/src/features/providers/ports.rs",
  "src-tauri/src/features/providers/application.rs",
];

const requiredRustModules = [
  "src-tauri/src/features/providers/mod.rs",
  ...rustCoreModules,
  "src-tauri/src/features/providers/transport.rs",
  "src-tauri/src/features/providers/adapters/mod.rs",
  "src-tauri/src/features/providers/adapters/authority.rs",
  "src-tauri/src/features/providers/adapters/gcp_adc.rs",
  "src-tauri/src/features/providers/adapters/keychain_vault.rs",
  "src-tauri/src/features/providers/adapters/local_connection.rs",
  "src-tauri/src/features/providers/adapters/provisioning_authority.rs",
  "src-tauri/src/features/providers/adapters/receipt_registry.rs",
  "src-tauri/src/features/providers/adapters/sqlite_bindings.rs",
  "src-tauri/src/features/providers/adapters/sqlite_repository.rs",
];

const requiredFrontendModules = [
  "src/features/providers/domain.ts",
  "src/features/providers/queries.ts",
  "src/features/providers/state.ts",
  "src/features/providers/tauriAdapter.ts",
];

const providerCommands = [
  "list_provider_integrations",
  "list_provider_credential_bindings",
  "begin_provider_credential_binding",
  "verify_provider_credential_binding",
  "revoke_provider_credential_binding",
];

const controlPlaneHttpAdapters = new Set([
  "src-tauri/src/features/providers/adapters/authority.rs",
  "src-tauri/src/features/providers/adapters/provisioning_authority.rs",
]);

const hostedProviderJsonAdapters = [
  "workspace-cloud/lib/providers/gcp-cloud-bootstrap-core.ts",
  "workspace-cloud/lib/providers/gcp-cloud-managed-http.ts",
  "workspace-cloud/lib/providers/gcp-cloud-oauth.ts",
  "workspace-cloud/lib/providers/gcp-cloud-sql.ts",
  "workspace-cloud/lib/providers/neon-api.ts",
  "workspace-cloud/lib/providers/neon-branch-api.ts",
  "workspace-cloud/lib/providers/planetscale.ts",
  "workspace-cloud/lib/providers/vercel-oidc.ts",
  "workspace-cloud/lib/workspace-kms.ts",
];

const directProviderHttpRules = [
  [
    /\breqwest(?:::[A-Za-z_][A-Za-z0-9_]*)*::(?:Client|RequestBuilder)\b|\buse\s+reqwest(?:::[A-Za-z_][A-Za-z0-9_]*)*::\{[^;]*\b(?:Client|RequestBuilder)\b/s,
    "Provider production code must not construct an HTTP client; use the official provider CLI or the DopeDB control plane",
  ],
  [
    /(?:console\.neon\.tech|api\.neon\.tech|sqladmin\.googleapis\.com|api\.planetscale\.com)/i,
    "Provider production code must not embed a provider API origin; use the official provider CLI or the DopeDB control plane",
  ],
];

function requireFile({ exists }, diagnostics, filePath) {
  if (!exists(filePath)) {
    diagnostics.push(`required architecture file is missing: ${filePath}`);
  }
}

function isTestModule(filePath) {
  return (
    /\.(?:test|spec)\.[^.]+$/.test(filePath) ||
    /(?:^|\/)(?:tests|[^/]+_tests)\.rs$/.test(filePath)
  );
}

function productionRust(source) {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/\n#\[cfg\(test\)\]\nmod tests \{[\s\S]*$/, "");
}

function containsCommandLiteral(source, command) {
  return new RegExp(`["']${command}["']`).test(source);
}

export function collectProviderOwnershipDiagnostics(context) {
  const { exists, lineCount, ratchet, read, relative, sourceFiles, walk } = context;
  const diagnostics = [];

  for (const filePath of [...requiredRustModules, ...requiredFrontendModules]) {
    requireFile(context, diagnostics, filePath);
  }

  const providerRustFiles = walk("src-tauri/src/features/providers")
    .map(relative)
    .filter((filePath) => filePath.endsWith(".rs"));
  const providerProductionFiles = providerRustFiles.filter((filePath) => !isTestModule(filePath));
  for (const filePath of providerProductionFiles) {
    const source = productionRust(read(filePath));
    const lines = lineCount(source);
    if (lines > ratchet.featureFileLineLimit) {
      diagnostics.push(
        `${filePath}: Provider module has ${lines} lines; keep it below ${ratchet.featureFileLineLimit}`,
      );
    }
    if (!controlPlaneHttpAdapters.has(filePath)) {
      for (const [pattern, reason] of directProviderHttpRules) {
        if (pattern.test(source)) diagnostics.push(`${filePath}: ${reason}`);
      }
    }
  }

  for (const filePath of controlPlaneHttpAdapters) {
    if (!exists(filePath)) continue;
    const source = productionRust(read(filePath));
    if (/crate::features::workspaces::adapters::control_plane/.test(source)) {
      diagnostics.push(
        `${filePath}: Provider hosted adapters must depend on the top-level hosted_control_plane boundary`,
      );
    }
    if (!/crate::hosted_control_plane/.test(source)) {
      diagnostics.push(`${filePath}: Provider hosted adapter bypasses hosted_control_plane`);
    }
  }

  for (const filePath of hostedProviderJsonAdapters) {
    requireFile(context, diagnostics, filePath);
    if (!exists(filePath)) continue;
    const source = read(filePath);
    if (/\bresponse\.json\s*\(/.test(source)) {
      diagnostics.push(`${filePath}: Hosted provider JSON must use the bounded response reader`);
    }
    const usesReviewedResponseBoundary = /boundedJsonResponse/.test(source)
      || (
        filePath === "workspace-cloud/lib/providers/gcp-cloud-sql.ts"
        && /gcpJsonRequest/.test(source)
        && /from "[.]\/gcp-cloud-managed-http";/.test(source)
      );
    if (!usesReviewedResponseBoundary) {
      diagnostics.push(`${filePath}: Hosted provider adapter bypasses boundedJsonResponse`);
    }
  }

  const coreRules = [
    [/\btauri\b/, "Provider core must not depend on Tauri"],
    [/\bsqlx\b/, "Provider core must not depend on SQLx"],
    [/\breqwest\b/, "Provider core must not perform HTTP"],
    [/\bkeyring::/, "Provider core must not access the OS credential store"],
    [/\bstd::(?:fs|env|process)\b/, "Provider core must not perform platform I/O"],
    [/crate::store/, "Provider core must not depend on the SQLite store"],
    [/crate::state/, "Provider core must not depend on global app state"],
    [/crate::services/, "Provider core must not depend on the service facade"],
    [/\badapters::/, "Provider core must depend on ports rather than adapters"],
  ];
  for (const filePath of rustCoreModules) {
    const source = productionRust(read(filePath));
    for (const [pattern, reason] of coreRules) {
      if (pattern.test(source)) diagnostics.push(`${filePath}: ${reason}`);
    }
  }

  const providerPorts = read("src-tauri/src/features/providers/ports.rs");
  const providerComposition = read("src-tauri/src/features/providers/mod.rs");
  const desktopComposition = read("src-tauri/src/state.rs");
  if (/\bOnceLock\b/.test(providerPorts)) {
    diagnostics.push(
      "Provider runtime ports must be supplied by completed composition, not late-bound OnceLock handles",
    );
  }
  if (/\bbind_(?:revocation_port|provisioning_runtime)\b/.test(providerComposition + desktopComposition)) {
    diagnostics.push(
      "Provider facade must not expose a callable partially bound runtime",
    );
  }
  if (
    !/pub\(crate\) struct ProviderComposition\b/.test(providerComposition) ||
    !/pub\(crate\) fn finish\s*\(/.test(providerComposition) ||
    !/provider_composition\s*\.finish\s*\(/s.test(desktopComposition)
  ) {
    diagnostics.push(
      "Provider desktop composition must prepare the local resolver and finish with every runtime port",
    );
  }

  const transportPath = "src-tauri/src/features/providers/transport.rs";
  const transport = productionRust(read(transportPath));
  for (const [pattern, reason] of [
    [/\bsqlx\b|crate::store/, "Provider transport must delegate persistence"],
    [/\breqwest\b/, "Provider transport must delegate hosted requests"],
    [/\bkeyring::/, "Provider transport must delegate credential storage"],
    [/\bstd::(?:fs|env|process)\b/, "Provider transport must delegate platform I/O"],
    [/\badapters::/, "Provider transport must enter through the feature facade"],
  ]) {
    if (pattern.test(transport)) diagnostics.push(`${transportPath}: ${reason}`);
  }

  for (const command of providerCommands) {
    const rustOwners = providerProductionFiles.filter((filePath) =>
      new RegExp(`(?:pub\\(crate\\)\\s+)?async\\s+fn\\s+${command}\\b`).test(
        productionRust(read(filePath)),
      ),
    );
    if (rustOwners.length !== 1 || rustOwners[0] !== transportPath) {
      diagnostics.push(
        `${command}: Rust Tauri command must belong only to ${transportPath}, found ${rustOwners.join(", ") || "none"}`,
      );
    }

    const frontendOwners = sourceFiles
      .map(relative)
      .filter((filePath) => /\.(?:ts|tsx)$/.test(filePath) && !isTestModule(filePath))
      .filter((filePath) => containsCommandLiteral(read(filePath), command));
    if (
      frontendOwners.length !== 1 ||
      frontendOwners[0] !== "src/features/providers/tauriAdapter.ts"
    ) {
      diagnostics.push(
        `${command}: frontend command literal must belong only to src/features/providers/tauriAdapter.ts, found ${frontendOwners.join(", ") || "none"}`,
      );
    }
  }

  for (const filePath of [
    "src/ipc/commands.ts",
    "src/ipc/types.ts",
    "src-tauri/src/commands/mod.rs",
  ]) {
    if (!exists(filePath)) continue;
    const source = read(filePath);
    if (
      providerCommands.some((command) => source.includes(command)) ||
      /\bProvider(?:Credential|Integration|Binding)(?:Status|Summary|Receipt|Request)?\b/.test(
        source,
      )
    ) {
      diagnostics.push(`${filePath}: central facade must not own Provider commands or contracts`);
    }
  }

  for (const [filePath, source] of sourceFiles
    .map((file) => [relative(file), read(relative(file))])
    .filter(([filePath]) => filePath.endsWith(".rs") && !isTestModule(filePath))) {
    if (
      filePath !== "src-tauri/src/store/schema.rs" &&
      !filePath.startsWith("src-tauri/src/features/providers/adapters/") &&
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+workspace_provider_(?:bindings|credential_cleanup)\b/is.test(
        source,
      )
    ) {
      diagnostics.push(
        `${filePath}: Provider binding mutation SQL must stay in the Provider SQLite adapter`,
      );
    }
  }

  const domain = read("src-tauri/src/features/providers/domain.rs");
  const transportSource = read(transportPath);
  for (const [source, typeName] of [
    [domain, "ProviderCredentialMaterial"],
    [transportSource, "BeginCredentialInput"],
  ]) {
    const derive = new RegExp(
      `#\\[derive\\(([^)]*)\\)\\][\\s\\S]{0,160}(?:enum|struct)\\s+${typeName}\\b`,
    ).exec(source)?.[1];
    if (derive && /\b(?:Debug|Serialize|Clone|Copy)\b/.test(derive)) {
      diagnostics.push(
        `${typeName}: secret-bearing input must not derive Debug, Serialize, Clone, or Copy`,
      );
    }
  }

  if (exists("src-tauri/src/store/provider_bindings.rs")) {
    diagnostics.push(
      "removed provider binding path returned: src-tauri/src/store/provider_bindings.rs",
    );
  }

  return diagnostics;
}
