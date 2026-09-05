// Executes the split architecture guards as one CI contract. The collectors own
// their domain rules; this file only supplies a deterministic repository view.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRuntimeDependencyGraph,
  collectDependencyParserSelfDiagnostics,
  findDependencyPath,
} from "./architecture/dependency-graph.mjs";
import { collectConnectionEditorDiagnostics } from "./architecture/connection-editor-guards.mjs";
import { collectFrontendDependencyCycleDiagnostics } from "./architecture/frontend-dependency-cycles.mjs";
import { collectI18nOwnershipDiagnostics } from "./architecture/i18n-ownership-guards.mjs";
import { collectProviderOwnershipDiagnostics } from "./architecture/provider-ownership.mjs";
import { collectQueryCentralIpcDiagnostics } from "./architecture/query-central-ipc-ownership.mjs";
import { collectQueryFrontendOwnershipDiagnostics } from "./architecture/query-frontend-ownership.mjs";
import { collectReleaseWorkflowDiagnostics } from "./architecture/release-workflow-guards.mjs";
import { collectRepositoryIdentityDiagnostics } from "./architecture/repository-identity-guards.mjs";
import { collectTerminalSecurityDiagnostics } from "./architecture/terminal-security-guards.mjs";
import { collectUpdaterOwnershipDiagnostics } from "./architecture/updater-ownership-guards.mjs";
import {
  collectQueryCentralCommandDiagnostics,
  collectQueryProductionModuleDiagnostics,
  collectQueryRuntimeOwnershipDiagnostics,
  collectQuerySharedCoreDiagnostics,
  collectQueryTestModuleDiagnostics,
  collectQueryTauriCommandDiagnostics,
  collectRemovedQueryRuntimeDiagnostics,
  collectRuntimeIdDiagnostics,
} from "./architecture/query-rust-runtime-guards.mjs";
import {
  collectApplicationStartupDiagnostics,
  collectPoisonMutexDiagnostics,
} from "./architecture/rust-safety-guards.mjs";
import { collectWorkspaceCloudHttpDiagnostics } from "./architecture/workspace-cloud-http-guards.mjs";
import { checkAnalysisArchitecture } from "./architecture/analysis-architecture-guards.mjs";
import { checkFrontendArchitecture } from "./architecture/frontend-architecture-guards.mjs";
import { checkKnowledgeArchitecture } from "./architecture/knowledge-architecture-guards.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function readTextFile(file) {
  // Architecture markers describe source structure, not checkout line endings.
  return fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

function read(relativePath) {
  return readTextFile(path.join(root, relativePath));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function walk(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(absolute, entry.name);
    return entry.isDirectory() ? walk(relative(child)) : [child];
  });
}

function lineCount(text) {
  if (!text) return 0;
  const lines = text.split(/\r?\n/).length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

const sourceFiles = [...walk("src"), ...walk("src-tauri/src")]
  .filter((file) => /\.(?:rs|ts|tsx)$/.test(file));
const frontendSource = sourceFiles
  .filter((file) => /\.(?:ts|tsx)$/.test(file))
  .map((file) => [relative(file), readTextFile(file)]);
const frontendProductionSource = frontendSource
  .filter(([filePath]) => !/\.(?:test|spec)\.[^.]+$/.test(filePath));
const rustSource = sourceFiles
  .filter((file) => file.endsWith(".rs"))
  .map((file) => readTextFile(file))
  .join("\n");
const context = {
  exists,
  lineCount,
  read,
  relative,
  sourceFiles,
  walk,
  // This retained ceiling catches new monoliths while the Provider modules stay
  // within their separately reviewed ownership boundaries.
  ratchet: { featureFileLineLimit: 2_200 },
};

// The state ownership catalog is an executable architecture contract, not an
// aspirational document. Every owner/dispatcher and reviewed writer marker must
// exist, while retired competing writer shapes stay absent from production.

const harness = {
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
};

checkFrontendArchitecture(harness);
checkKnowledgeArchitecture(harness);
checkAnalysisArchitecture(harness);
failures.push(...collectApplicationStartupDiagnostics(context));

if (failures.length > 0) {
  for (const failure of [...new Set(failures)].sort()) console.error(`architecture: ${failure}`);
  process.exit(1);
}
console.log("architecture ownership guards ok");
