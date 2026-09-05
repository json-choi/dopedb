import { execFile, execFileSync, spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createBenchmarkAggregates } from "./benchmark/packaged-aggregates.mjs";
import { createBenchmarkRuntime } from "./benchmark/packaged-runtime.mjs";
import { createBenchmarkUtilities } from "./benchmark/packaged-utilities.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const prefix = "dopedb-packaged-benchmark-";
const marker = "DOPEDB_PACKAGED_BENCHMARK:";
const fixtureMarker = "DOPEDB_PACKAGED_BENCHMARK_FIXTURE:";
const failureMarker = "DOPEDB_PACKAGED_BENCHMARK_FAILURE:";
const progressMarker = "DOPEDB_PACKAGED_BENCHMARK_PROGRESS:";
const activeChildren = new Set();
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
  for (const child of activeChildren) child.kill("SIGTERM");
});
const connections = [0, 5, 20];
const workloadScenarios = [
  "sql-editor",
  "explorer-search",
  "query-result",
  "table-first-row",
  "agent-transcript",
  "agent-tools",
  "long-lived-data",
  "interaction-surfaces",
  "idle-runtime",
];
const requiredActionsByScenario = {
  "sql-editor": [
    "sql-editor-10k-type", "sql-editor-10k-cursor", "sql-editor-10k-format", "sql-editor-10k-run",
    "sql-editor-100k-type", "sql-editor-100k-cursor", "sql-editor-100k-format", "sql-editor-100k-run",
    "sql-editor-1m-type", "sql-editor-1m-cursor", "sql-editor-1m-format", "sql-editor-1m-run", "sql-editor-1m-scroll",
  ],
  "explorer-search": ["explorer-first-expand", "explorer-secondary-expand", "search-everywhere"],
  "query-result": ["query-first-batch", "query-grid-scroll-50k", "query-page-store-1m", "query-cancel", "query-export"],
  "table-first-row": ["table-first-page-cold", "table-first-page"],
  "agent-transcript": ["agent-stream-10k", "agent-manual-scroll", "agent-permission", "agent-reconnect"],
  "agent-tools": ["agent-skill-install-all", "agent-skill-reload", "agent-skill-remove-all"],
  "long-lived-data": ["history-10k", "audit-100k", "local-history-50", "analysis-article-local-results"],
  "interaction-surfaces": [
    "erd-drag-1k",
    "grid-and-pane-resize",
    "workbench-scroll-continuity",
  ],
  "idle-runtime": [],
};
const nonVisualNativeActions = new Set([
  "query-page-store-1m",
  "query-cancel",
  "query-export",
  "agent-skill-reload",
  "history-10k",
  "audit-100k",
  "local-history-50",
  "analysis-article-local-results",
]);
const {
  progress,
  commandText,
  runCommand,
  isWithin,
  prepareOutputPath,
  removeOwnedTemporaryRoot,
} = createBenchmarkUtilities({
  root,
  prefix,
  execFileSync,
  spawn,
  lstat,
  mkdir,
  realpath,
  rm,
  tmpdir,
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
});
const {
  parseArguments,
  buildPackagedBenchmark,
  packagedExecutable,
  prepareFixture,
  cloneFixture,
  runMeasuredApp,
  validateMeasuredOutcome,
  isolatedEnvironment,
  inheritedRuntimeEnvironment,
  runApplication,
  parseBoundedMarker,
  scenarioTimeoutMs,
  processTreeRssBytes,
} = createBenchmarkRuntime({
  root,
  tauriCli,
  marker,
  fixtureMarker,
  failureMarker,
  progressMarker,
  workloadScenarios,
  requiredActionsByScenario,
  round: (value) => round(value),
  isInterrupted: () => interrupted,
  activeChildren,
  execFileSync,
  spawn,
  cp,
  mkdir,
  stat,
  platform,
  release,
  dirname,
  join,
  resolve,
  execFileAsync,
  progress,
  runCommand,
});
const {
  aggregateStartupSamples,
  aggregateGroup,
  actionMetricSamples,
  aggregateActions,
  aggregateScenarioResources,
  evaluateBudgets,
  selectedActionNames,
  idleIpcCallsPerMinute,
  sum,
  maximum,
  rate,
  verdict,
  firstShellCommit,
  selectedConnectionRestore,
  stageEnd,
  percentile,
  uniqueWebviews,
  round,
} = createBenchmarkAggregates({
  connections,
  requiredActionsByScenario,
  nonVisualNativeActions,
  workloadScenarios,
});

const options = parseArguments(process.argv.slice(2));
const budgets = JSON.parse(
  await readFile(
    join(root, "src-tauri/benchmarks/packaged-release-budgets.json"),
    "utf8",
  ),
);
if (
  budgets.schemaVersion !== 2
  || budgets.measurementScope !== "packaged_release_user_journeys"
) {
  throw new Error("packaged benchmark budgets use an unsupported schema");
}
const sampleCount = options.samples ?? budgets.sampleCountPerState;
const workloadSampleCount = options.workloadSamples
  ?? budgets.workloadSampleCountPerScenario;

if (!options.skipBuild) await buildPackagedBenchmark();
const executable = await packagedExecutable();
const temporaryRoot = await mkdtemp(join(tmpdir(), prefix));
const samples = [];
const standardFixtures = new Map();

try {
  if (options.only === null || options.only === "startup") {
    for (const connectionCount of connections) {
      const fixture = await prepareFixture(
        executable,
        temporaryRoot,
        connectionCount,
        "standard",
      );
      standardFixtures.set(connectionCount, fixture);
      const warmupRoot = join(temporaryRoot, `warmup-${connectionCount}`);
      await cloneFixture(fixture, warmupRoot);
      await runMeasuredApp(
        executable,
        warmupRoot,
        `connections-${connectionCount}-warmup`,
        connectionCount,
      );

      for (let index = 1; index <= sampleCount; index += 1) {
        const runRoot = join(temporaryRoot, `run-${connectionCount}-${index}`);
        await cloneFixture(fixture, runRoot);
        samples.push(await runMeasuredApp(
          executable,
          runRoot,
          `connections-${connectionCount}-cold-sample-${index}`,
          connectionCount,
        ));
        samples.push(await runMeasuredApp(
          executable,
          runRoot,
          `connections-${connectionCount}-warm-sample-${index}`,
          connectionCount,
        ));
      }
    }

    const recoveryFixture = await prepareFixture(
      executable,
      temporaryRoot,
      20,
      "recovery",
    );
    const recoveryWarmupRoot = join(temporaryRoot, "warmup-recovery");
    await cloneFixture(recoveryFixture, recoveryWarmupRoot);
    await runMeasuredApp(
      executable,
      recoveryWarmupRoot,
      "connections-20-recovery-warmup",
      20,
    );
    for (let index = 1; index <= sampleCount; index += 1) {
      const runRoot = join(temporaryRoot, `run-recovery-${index}`);
      await cloneFixture(recoveryFixture, runRoot);
      samples.push(await runMeasuredApp(
        executable,
        runRoot,
        `connections-20-recovery-cold-sample-${index}`,
        20,
      ));
      samples.push(await runMeasuredApp(
        executable,
        runRoot,
        `connections-20-recovery-warm-sample-${index}`,
        20,
      ));
    }
  }

  const selectedWorkloads = options.only === null
    ? workloadScenarios
    : options.only === "startup"
      ? []
      : [options.only];
  if (selectedWorkloads.length > 0) {
    let workloadFixture = standardFixtures.get(20);
    if (!workloadFixture) {
      workloadFixture = await prepareFixture(
        executable,
        temporaryRoot,
        20,
        "standard",
      );
      standardFixtures.set(20, workloadFixture);
    }
    const longLivedFixture = selectedWorkloads.includes("long-lived-data")
      ? await prepareFixture(
        executable,
        temporaryRoot,
        20,
        "long-lived",
      )
      : null;
    const tableDataFixture = selectedWorkloads.includes("table-first-row")
      ? await prepareFixture(
        executable,
        temporaryRoot,
        20,
        "table-data",
      )
      : null;
    for (const scenario of selectedWorkloads) {
      const fixture = scenario === "long-lived-data"
        ? longLivedFixture
        : scenario === "table-first-row"
          ? tableDataFixture
          : workloadFixture;
      if (!fixture) throw new Error("workload fixture is unavailable");
      const warmupRoot = join(temporaryRoot, `warmup-workload-${scenario}`);
      await cloneFixture(fixture, warmupRoot);
      if (scenario === "agent-tools") {
        await runMeasuredApp(executable, warmupRoot, scenario, 20, "install");
        await runMeasuredApp(executable, warmupRoot, scenario, 20, "restart");
      } else {
        await runMeasuredApp(executable, warmupRoot, scenario, 20);
      }
      for (let index = 1; index <= workloadSampleCount; index += 1) {
        const runRoot = join(temporaryRoot, `run-workload-${scenario}-${index}`);
        await cloneFixture(fixture, runRoot);
        if (scenario === "agent-tools") {
          samples.push(
            await runMeasuredApp(executable, runRoot, scenario, 20, "install"),
          );
          samples.push(
            await runMeasuredApp(executable, runRoot, scenario, 20, "restart"),
          );
        } else {
          samples.push(await runMeasuredApp(executable, runRoot, scenario, 20));
        }
      }
    }
  }

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const summary = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    measurementScope: "packaged_release_user_journeys",
    build: {
      profile: "release",
      application: "DopeDB Benchmark",
      appVersion: packageJson.version,
      commit: commandText("git", ["rev-parse", "HEAD"]),
      dirty: commandText("git", ["status", "--porcelain"]).length > 0,
    },
    environment: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      node: process.version,
      webviews: uniqueWebviews(samples),
    },
    methodology: {
      diagnosticSelection: options.only,
      fixtureConnections: connections,
      sampleCountPerState: sampleCount,
      workloadSampleCountPerScenario: workloadSampleCount,
      warmupRunsPerFixture: budgets.warmupRunsPerFixture,
      fixtureScale: {
        sqlEditorBytes: [10 * 1024, 100 * 1024, 1024 * 1024],
        explorer: { connections: 20, databases: 50, objects: 5_000 },
        queryRows: { visible: 50_000, diskStore: 1_000_000 },
        agent: { elapsedMinutes: 10, events: 10_000 },
        agentTools: {
          targets: 2,
          lifecycle: ["install", "app-exit", "app-restart", "reload", "remove"],
        },
        longLived: { history: 10_000, audit: 100_000, revisions: 50, analysisLocalResults: 8 },
        erdNodes: 1_000,
      },
      coldDefinition:
        "A fresh clone of a sealed current-schema fixture is opened by a new packaged release process.",
      warmDefinition:
        "The same isolated fixture is reopened after the paired cold process exits cleanly.",
      observationWindow:
        "Renderer module load through first shell commit plus 1500 ms of visible post-paint recovery.",
      rss:
        "Maximum resident bytes sampled from the application process and its descendant process tree. Platform WebView helpers outside that tree are not claimed.",
      privacy:
        "Only closed stage names, numeric timings/counts, app/OS/WebView versions, and aggregate RSS are retained. IPC arguments/responses, SQL, rows, prompts, paths, credentials, and raw logs are never written to the artifact.",
    },
    budgets: { ...budgets.budgets, actionP95Ms: budgets.actionP95Ms },
    aggregates: {
      startup: aggregateStartupSamples(samples),
      actions: aggregateActions(samples),
      scenarios: aggregateScenarioResources(samples),
    },
    budgetEvaluation: evaluateBudgets(
      samples,
      budgets.budgets,
      budgets.actionP95Ms,
      selectedActionNames(options.only),
    ),
    samples,
  };
  const output = await prepareOutputPath(options.output);
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: relative(root, output),
    samples: samples.length,
    overall: summary.budgetEvaluation.overall,
    startupAggregates: summary.aggregates.startup,
    actionCount: Object.keys(summary.aggregates.actions).length,
  }, null, 2)}\n`);
  if (summary.budgetEvaluation.overall === "failed") process.exitCode = 1;
} finally {
  await removeOwnedTemporaryRoot(temporaryRoot);
}
