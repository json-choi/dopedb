export function createBenchmarkRuntime(harness) {
  const {
    root,
    tauriCli,
    marker,
    fixtureMarker,
    failureMarker,
    progressMarker,
    workloadScenarios,
    requiredActionsByScenario,
    round,
    isInterrupted,
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
  } = harness;

  function parseArguments(args) {
    const parsed = {
      skipBuild: false,
      samples: null,
      workloadSamples: null,
      only: null,
      output: null,
    };
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--") {
        continue;
      } else if (argument === "--skip-build") {
        parsed.skipBuild = true;
      } else if (argument === "--samples") {
        const value = Number(args[++index]);
        if (!Number.isInteger(value) || value < 1 || value > 20) {
          throw new Error("--samples must be an integer from 1 to 20");
        }
        parsed.samples = value;
      } else if (argument === "--workload-samples") {
        const value = Number(args[++index]);
        if (!Number.isInteger(value) || value < 1 || value > 10) {
          throw new Error("--workload-samples must be an integer from 1 to 10");
        }
        parsed.workloadSamples = value;
      } else if (argument === "--output") {
        parsed.output = args[++index] ?? "";
        if (!parsed.output) throw new Error("--output requires a path");
      } else if (argument === "--only") {
        const value = args[++index] ?? "";
        if (value !== "startup" && !workloadScenarios.includes(value)) {
          throw new Error("--only must be startup or a workload scenario");
        }
        parsed.only = value;
      } else {
        throw new Error(`unknown argument: ${argument}`);
      }
    }
    parsed.output ??= parsed.only === null
      ? "src-tauri/benchmarks/packaged-release-summary.json"
      : `src-tauri/benchmarks/packaged-release-${parsed.only}-diagnostic.json`;
    return parsed;
  }

  async function buildPackagedBenchmark() {
    const bundle = platform() === "darwin"
      ? "app"
      : platform() === "win32"
        ? "nsis"
        : "appimage";
    await runCommand(process.execPath, [
      tauriCli,
      "build",
      "--features",
      "packaged-benchmark",
      "--config",
      "src-tauri/tauri.benchmark.conf.json",
      "--bundles",
      bundle,
    ], { stdio: "inherit" });
  }

  async function packagedExecutable() {
    const path = platform() === "darwin"
      ? join(
          root,
          "target/release/bundle/macos/DopeDB Benchmark.app/Contents/MacOS/dopedb",
        )
      : platform() === "win32"
        ? join(root, "target/release/dopedb.exe")
        : join(root, "target/release/dopedb");
    if (!(await stat(path)).isFile()) throw new Error(`packaged executable missing: ${path}`);
    return path;
  }

  async function prepareFixture(executable, temporary, connectionCount, fixtureKind) {
    progress("prepare", `${fixtureKind}-${connectionCount}`);
    const fixture = join(temporary, `fixture-${fixtureKind}-${connectionCount}`);
    const data = join(fixture, "data");
    const home = join(fixture, "home");
    await mkdir(data, { recursive: true });
    await mkdir(home, { recursive: true });
    const result = await runApplication(executable, isolatedEnvironment(home, {
      DOPEDB_PACKAGED_BENCHMARK_DATA_DIR: data,
      DOPEDB_PACKAGED_BENCHMARK_HOME_DIR: home,
      DOPEDB_PACKAGED_BENCHMARK_PREPARE_CONNECTIONS: String(connectionCount),
      DOPEDB_PACKAGED_BENCHMARK_FIXTURE_KIND: fixtureKind,
    }), fixtureMarker, false, fixtureKind === "long-lived" ? 180_000 : 60_000);
    if (
      result.connectionCount !== connectionCount
      || result.fixtureKind !== fixtureKind
    ) {
      throw new Error("packaged fixture reported a different connection count");
    }
    return fixture;
  }

  async function cloneFixture(fixture, destination) {
    await mkdir(destination, { recursive: true });
    await cp(join(fixture, "data"), join(destination, "data"), { recursive: true });
    await cp(join(fixture, "home"), join(destination, "home"), { recursive: true });
  }

  async function runMeasuredApp(
    executable,
    runRoot,
    scenario,
    connectionCount,
    phase = null,
  ) {
    progress("run", phase === null ? scenario : `${scenario}-${phase}`);
    const started = performance.now();
    const home = join(runRoot, "home");
    const outcome = await runApplication(executable, isolatedEnvironment(home, {
      DOPEDB_PACKAGED_BENCHMARK_DATA_DIR: join(runRoot, "data"),
      DOPEDB_PACKAGED_BENCHMARK_HOME_DIR: home,
      DOPEDB_PACKAGED_BENCHMARK_SCENARIO: scenario,
      DOPEDB_PACKAGED_BENCHMARK_CONNECTIONS: String(connectionCount),
      ...(phase === null ? {} : { DOPEDB_PACKAGED_BENCHMARK_PHASE: phase }),
    }), marker, true, scenarioTimeoutMs(scenario));
    validateMeasuredOutcome(outcome, scenario, connectionCount, phase);
    const reportedProcessTreeRss = Number(outcome.report.processTreeRssBytes) || 0;
    return {
      scenario,
      ...(phase === null ? {} : { phase }),
      connectionCount,
      wallMs: round(performance.now() - started),
      maxProcessTreeRssBytes: Math.max(
        outcome.maxProcessTreeRssBytes,
        reportedProcessTreeRss,
      ),
      startup: outcome.report.startup,
      renderer: outcome.report.renderer,
    };
  }

  function validateMeasuredOutcome(outcome, scenario, connectionCount, phase = null) {
    const report = outcome?.report;
    const renderer = report?.renderer;
    const expectedActions = scenario === "agent-tools" && phase === "install"
      ? ["agent-skill-install-all"]
      : scenario === "agent-tools" && phase === "restart"
        ? ["agent-skill-reload", "agent-skill-remove-all"]
        : requiredActionsByScenario[scenario] ?? [];
    const reportedActions = renderer?.actions?.map((action) => action.name) ?? [];
    const uniqueActions = new Set(reportedActions);
    const missingActions = expectedActions.filter((action) => !uniqueActions.has(action));
    const hasDuplicateAction = uniqueActions.size !== reportedActions.length;
    const requiredPositiveCounts = [
      renderer?.reactCommitCount,
      renderer?.frameSampleCount,
      renderer?.ipcCallCount,
      Math.max(
        outcome?.maxProcessTreeRssBytes ?? 0,
        Number(report?.processTreeRssBytes) || 0,
      ),
    ];
    if (
      report?.schemaVersion !== 2
      || report?.measurementScope !== "packaged_release_user_journeys"
      || report?.scenario !== scenario
      || report?.connectionCount !== connectionCount
      || !Array.isArray(renderer?.actions)
      || missingActions.length > 0
      || hasDuplicateAction
      || renderer.actions.some(
        (action) => !Array.isArray(action.samplesMs) || action.samplesMs.length === 0,
      )
      || (scenario === "idle-runtime" && renderer.idleObservationMs < 9_000)
      || (scenario === "agent-tools" && renderer.idleObservationMs < 1_400)
      || !requiredPositiveCounts.every(
        (value) => Number.isFinite(value) && value > 0,
      )
    ) {
      throw new Error(
        [
          "packaged benchmark returned incomplete or mismatched instrumentation",
          `react=${renderer?.reactCommitCount ?? "missing"}`,
          `frames=${renderer?.frameSampleCount ?? "missing"}`,
          `ipc=${renderer?.ipcCallCount ?? "missing"}`,
          `rss=${outcome?.maxProcessTreeRssBytes ?? "missing"}`,
          `missingActions=${missingActions.join(",") || "none"}`,
        ].join(" "),
      );
    }
  }

  function isolatedEnvironment(home, values) {
    return {
      ...values,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      LOCALAPPDATA: join(home, "AppData", "Local"),
      APPDATA: join(home, "AppData", "Roaming"),
      USER: "dopedb-benchmark",
      USERNAME: "dopedb-benchmark",
      LOGNAME: "dopedb-benchmark",
      ...(platform() === "win32" ? {} : { SHELL: "/bin/sh" }),
    };
  }

  function inheritedRuntimeEnvironment() {
    const allowed = [
      "PATH",
      "PATHEXT",
      "TMPDIR",
      "TEMP",
      "TMP",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "TZ",
      "SystemRoot",
      "WINDIR",
      "ComSpec",
      "ProgramData",
      "ProgramFiles",
      "ProgramFiles(x86)",
      "ProgramW6432",
      "CommonProgramFiles",
      "CommonProgramFiles(x86)",
      "CommonProgramW6432",
      "PROCESSOR_ARCHITECTURE",
      "NUMBER_OF_PROCESSORS",
      "OS",
      "DISPLAY",
      "WAYLAND_DISPLAY",
      "XDG_RUNTIME_DIR",
    ];
    return Object.fromEntries(
      allowed.flatMap((name) => {
        const value = process.env[name];
        return value === undefined ? [] : [[name, value]];
      }),
    );
  }

  function runApplication(
    executable,
    environment,
    expectedMarker,
    sampleRss,
    timeoutMs,
  ) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(executable, [], {
        cwd: dirname(executable),
        env: {
          ...inheritedRuntimeEnvironment(),
          ...environment,
          RUST_LOG: "dopedb::startup=info,error",
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      activeChildren.add(child);
      let pending = "";
      let report = null;
      let maximumRss = 0;
      let timedOut = false;
      const observedStartupStages = new Set();
      let failureCategory = null;
      let failurePhase = null;
      let failureReason = null;
      const startupStageNames = [
        "store_ready",
        "operation_recovery",
        "provider_recovery",
        "window_shown",
        "first_shell_commit",
        "selected_connection_restored",
        "agent_session_recovery",
        "job_recovery",
        "broker_start",
      ];
      const inspect = (chunk) => {
        pending += chunk.toString("utf8");
        if (pending.length > 256 * 1024) pending = pending.slice(-128 * 1024);
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          for (const stage of startupStageNames) {
            if (line.includes(`stage=${stage}`) || line.includes(`stage=\"${stage}\"`)) {
              observedStartupStages.add(stage);
            }
          }
          if (line.includes("failed to initialize app state")) {
            failureCategory = "state_initialization";
          } else if (line.includes("panicked at")) {
            failureCategory = "runtime_panic";
          }
          const failureOffset = line.indexOf(failureMarker);
          if (failureOffset >= 0) {
            const failure = parseBoundedMarker(
              line.slice(failureOffset + failureMarker.length),
            );
            if (failure === null) {
              failureCategory = "malformed_marker";
              child.kill("SIGTERM");
              continue;
            }
            failurePhase = failure?.phase ?? "unknown";
            failureReason = failure?.reason ?? "unknown";
            continue;
          }
          const progressOffset = line.indexOf(progressMarker);
          if (progressOffset >= 0) {
            const progressReport = parseBoundedMarker(
              line.slice(progressOffset + progressMarker.length),
            );
            if (
              progressReport === null
              || typeof progressReport.action !== "string"
              || !["start", "complete"].includes(progressReport.status)
            ) {
              failureCategory = "malformed_marker";
              child.kill("SIGTERM");
              continue;
            }
            progress("backend", `${progressReport.action}-${progressReport.status}`);
            continue;
          }
          const offset = line.indexOf(expectedMarker);
          if (offset < 0) continue;
          const candidate = parseBoundedMarker(
            line.slice(offset + expectedMarker.length),
          );
          if (candidate === null) {
            failureCategory = "malformed_marker";
            child.kill("SIGTERM");
            continue;
          }
          if (report !== null) {
            failureCategory = "duplicate_report";
            child.kill("SIGTERM");
            continue;
          }
          report = candidate;
        }
      };
      child.stdout.on("data", inspect);
      child.stderr.on("data", inspect);
      let rssSamplePending = false;
      let latestRssSample = Promise.resolve();
      const sampleProcessTreeRss = () => {
        if (rssSamplePending) return;
        rssSamplePending = true;
        latestRssSample = processTreeRssBytes(child.pid)
          .then((rss) => {
            maximumRss = Math.max(maximumRss, rss);
          })
          .catch(() => undefined)
          .finally(() => {
            rssSamplePending = false;
          });
      };
      const usesNativeRssSampler = platform() === "win32" || platform() === "darwin";
      if (sampleRss && !usesNativeRssSampler) sampleProcessTreeRss();
      // macOS and Windows feature builds sample the exact process tree in-process.
      // Spawning `ps`/PowerShell during an interaction perturbs the frame clock the
      // benchmark is meant to measure, so the launcher only provides the fallback
      // sampler on platforms without native instrumentation.
      const sampler = sampleRss && !usesNativeRssSampler
        ? setInterval(sampleProcessTreeRss, 250)
        : null;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
      child.once("error", reject);
      child.once("close", async (code, signal) => {
        activeChildren.delete(child);
        clearTimeout(timeout);
        if (sampler !== null) clearInterval(sampler);
        await latestRssSample;
        if (pending) inspect("\n");
        if (isInterrupted()) {
          reject(new Error("packaged benchmark interrupted"));
        } else if (timedOut) {
          reject(new Error([
            "packaged benchmark timed out",
            `stages=${[...observedStartupStages].join(",") || "none"}`,
            `failure=${failureCategory ?? "none"}`,
          ].join(" ")));
        } else if (failurePhase !== null) {
          reject(new Error(
            `packaged benchmark action failed phase=${failurePhase} reason=${failureReason}`,
          ));
        } else if (
          failureCategory === "malformed_marker"
          || failureCategory === "duplicate_report"
        ) {
          reject(new Error(`packaged benchmark emitted an invalid ${failureCategory}`));
        } else if (code !== 0 || signal !== null) {
          reject(new Error([
            `packaged benchmark exited code=${code} signal=${signal}`,
            `phase=${failurePhase ?? "unknown"}`,
          ].join(" ")));
        } else if (report === null) {
          reject(new Error("packaged benchmark did not emit its bounded report"));
        } else {
          resolvePromise(expectedMarker === marker
            ? { report, maxProcessTreeRssBytes: maximumRss }
            : report);
        }
      });
    });
  }

  function parseBoundedMarker(value) {
    if (value.length === 0 || value.length > 64 * 1024) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  function scenarioTimeoutMs(scenario) {
    if (scenario === "query-result") return 360_000;
    if (scenario === "sql-editor") return 180_000;
    if (scenario === "idle-runtime") return 60_000;
    return 90_000;
  }

  async function processTreeRssBytes(rootPid) {
    if (!Number.isInteger(rootPid) || rootPid <= 0) return 0;
    try {
      if (platform() === "win32") {
        const script = `(Get-Process -Id ${rootPid} -ErrorAction Stop).WorkingSet64`;
        const { stdout } = await execFileAsync(
          "powershell",
          ["-NoProfile", "-NonInteractive", "-Command", script],
          { encoding: "utf8", timeout: 2_000, windowsHide: true },
        );
        return Number(stdout.trim()) || 0;
      }
      const output = execFileSync(
        "ps",
        ["-axo", "pid=,ppid=,rss="],
        { encoding: "utf8", timeout: 2_000 },
      );
      const rows = output.trim().split(/\n+/).map((line) => {
        const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
        return { pid, ppid, rss };
      });
      const ids = new Set([rootPid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of rows) {
          if (ids.has(row.ppid) && !ids.has(row.pid)) {
            ids.add(row.pid);
            changed = true;
          }
        }
      }
      return rows
        .filter((row) => ids.has(row.pid))
        .reduce((total, row) => total + row.rss * 1024, 0);
    } catch {
      return 0;
    }
  }

  return {
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
  };
}
