export function createBenchmarkAggregates(harness) {
  const {
    connections,
    requiredActionsByScenario,
    nonVisualNativeActions,
    workloadScenarios,
  } = harness;

  function aggregateStartupSamples(allSamples) {
    const startup = allSamples.filter((sample) => sample.scenario.startsWith("connections-"));
    const baseline = {};
    for (const connectionCount of connections) {
      for (const state of ["cold", "warm"]) {
        const selected = startup.filter((sample) =>
          sample.connectionCount === connectionCount
          && sample.scenario.includes(`-${state}-`)
          && !sample.scenario.includes("-recovery-")
        );
        baseline[`${connectionCount}-${state}`] = aggregateGroup(selected);
      }
    }
    const recovery = {};
    for (const state of ["cold", "warm"]) {
      recovery[`20-${state}`] = aggregateGroup(startup.filter((sample) =>
        sample.scenario.includes(`-recovery-${state}-`)
      ));
    }
    return { baseline, recovery };
  }

  function aggregateGroup(group) {
    return {
      samples: group.length,
      firstShellCommitP50Ms: percentile(group.map(firstShellCommit), 0.5),
      firstShellCommitP95Ms: percentile(group.map(firstShellCommit), 0.95),
      selectedConnectionRestoreP95Ms: percentile(
        group.map(selectedConnectionRestore).filter(Number.isFinite),
        0.95,
      ),
      storeReadyP95Ms: percentile(group.map((sample) => stageEnd(sample, "store_ready")), 0.95),
      maxFrameGapP95Ms: percentile(group.map((sample) => sample.renderer.maxFrameGapMs), 0.95),
      reactCommitDurationP95Ms: percentile(
        group.map((sample) => sample.renderer.maxReactCommitDurationMs),
        0.95,
      ),
      startupIpcCallsP50: percentile(group.map((sample) => sample.renderer.ipcCallCount), 0.5),
      startupIpcCallsP95: percentile(group.map((sample) => sample.renderer.ipcCallCount), 0.95),
      maxProcessTreeRssP95Bytes: percentile(
        group.map((sample) => sample.maxProcessTreeRssBytes),
        0.95,
      ),
    };
  }

  function actionMetricSamples(group, samplesKey) {
    return group.flatMap((action) => {
      const samples = action[samplesKey];
      return Array.isArray(samples) ? samples.filter(Number.isFinite) : [];
    });
  }

  function aggregateActions(allSamples) {
    const grouped = new Map();
    for (const sample of allSamples) {
      for (const action of sample.renderer.actions) {
        const group = grouped.get(action.name) ?? [];
        group.push(action);
        grouped.set(action.name, group);
      }
    }
    return Object.fromEntries([...grouped.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    ).map(([name, group]) => {
      const timings = group.flatMap((action) => action.samplesMs);
      const elapsedMs = sum(timings);
      const ipcCalls = sum(group.map((action) => action.ipcCallCount));
      const ipcPayloadBytes = sum(group.map((action) => action.ipcPayloadBytes));
      const sqliteTransactions = sum(
        group.map((action) => action.sqliteTransactionCount),
      );
      const backendRequestToFirstRow = actionMetricSamples(
        group,
        "backendRequestToFirstRowSamplesMs",
      );
      const backendFirstRowToIpcBatch = actionMetricSamples(
        group,
        "backendFirstRowToIpcBatchSamplesMs",
      );
      const ipcBatchToReactCommit = actionMetricSamples(
        group,
        "ipcBatchToReactCommitSamplesMs",
      );
      const operationClaim = actionMetricSamples(
        group,
        "operationClaimSamplesMs",
      );
      const poolConnectStart = actionMetricSamples(
        group,
        "poolConnectStartSamplesMs",
      );
      const poolConnectReady = actionMetricSamples(
        group,
        "poolConnectReadySamplesMs",
      );
      const backendExecuteStart = actionMetricSamples(
        group,
        "backendExecuteStartSamplesMs",
      );
      const firstRow = actionMetricSamples(
        group,
        "firstRowSamplesMs",
      );
      const firstIpcBatch = actionMetricSamples(
        group,
        "firstIpcBatchSamplesMs",
      );
      return [name, {
        runs: group.length,
        samples: timings.length,
        actionToPaintP50Ms: percentile(timings, 0.5),
        actionToPaintP95Ms: percentile(timings, 0.95),
        reactCommitCount: sum(group.map((action) => action.reactCommitCount)),
        reactCommitDurationP95Ms: percentile(
          group.map((action) => action.reactCommitDurationMs),
          0.95,
        ),
        maxFrameGapP95Ms: percentile(
          group.map((action) => action.maxFrameGapMs),
          0.95,
        ),
        frameSampleCount: sum(group.map((action) => action.frameSampleCount)),
        droppedFrameCount: sum(group.map((action) => action.droppedFrameCount)),
        ipcCallCount: ipcCalls,
        ipcCallsPerSecond: rate(ipcCalls, elapsedMs),
        ipcDurationP95Ms: percentile(group.map((action) => action.ipcDurationMs), 0.95),
        ipcPayloadBytesMax: maximum(group.map((action) => action.ipcPayloadBytes)),
        ipcPayloadBytesPerSecond: rate(ipcPayloadBytes, elapsedMs),
        sqliteTransactionCount: sqliteTransactions,
        sqliteTransactionsPerSecond: rate(sqliteTransactions, elapsedMs),
        retainedBytesMax: maximum(group.map((action) => action.retainedBytes)),
        backendRequestToFirstRowP50Ms: percentile(
          backendRequestToFirstRow,
          0.5,
        ),
        backendRequestToFirstRowP95Ms: percentile(
          backendRequestToFirstRow,
          0.95,
        ),
        backendFirstRowToIpcBatchP50Ms: percentile(
          backendFirstRowToIpcBatch,
          0.5,
        ),
        backendFirstRowToIpcBatchP95Ms: percentile(
          backendFirstRowToIpcBatch,
          0.95,
        ),
        ipcBatchToReactCommitP50Ms: percentile(
          ipcBatchToReactCommit,
          0.5,
        ),
        ipcBatchToReactCommitP95Ms: percentile(
          ipcBatchToReactCommit,
          0.95,
        ),
        operationClaimP50Ms: percentile(
          operationClaim,
          0.5,
        ),
        operationClaimP95Ms: percentile(
          operationClaim,
          0.95,
        ),
        poolConnectStartP50Ms: percentile(
          poolConnectStart,
          0.5,
        ),
        poolConnectStartP95Ms: percentile(
          poolConnectStart,
          0.95,
        ),
        poolConnectReadyP50Ms: percentile(
          poolConnectReady,
          0.5,
        ),
        poolConnectReadyP95Ms: percentile(
          poolConnectReady,
          0.95,
        ),
        backendExecuteStartP50Ms: percentile(
          backendExecuteStart,
          0.5,
        ),
        backendExecuteStartP95Ms: percentile(
          backendExecuteStart,
          0.95,
        ),
        firstRowP50Ms: percentile(
          firstRow,
          0.5,
        ),
        firstRowP95Ms: percentile(
          firstRow,
          0.95,
        ),
        firstIpcBatchP50Ms: percentile(
          firstIpcBatch,
          0.5,
        ),
        firstIpcBatchP95Ms: percentile(
          firstIpcBatch,
          0.95,
        ),
      }];
    }));
  }

  function aggregateScenarioResources(allSamples) {
    return Object.fromEntries(workloadScenarios.map((scenario) => {
      const selected = allSamples.filter((sample) => sample.scenario === scenario);
      return [scenario, {
        runs: selected.length,
        maxProcessTreeRssP95Bytes: percentile(
          selected.map((sample) => sample.maxProcessTreeRssBytes),
          0.95,
        ),
        webviewHeapP95Bytes: percentile(
          selected.map((sample) => sample.renderer.webviewHeapBytes),
          0.95,
        ),
        maxFrameGapP95Ms: percentile(
          selected.map((sample) => sample.renderer.maxFrameGapMs),
          0.95,
        ),
        reactCommitDurationP95Ms: percentile(
          selected.map((sample) => sample.renderer.maxReactCommitDurationMs),
          0.95,
        ),
        ipcCallsPerSecondP95: percentile(
          selected.map((sample) => rate(
            sample.renderer.ipcCallCount,
            sample.renderer.rendererElapsedMs,
          )),
          0.95,
        ),
        idleIpcCallsPerMinuteP95: percentile(
          selected.map(idleIpcCallsPerMinute),
          0.95,
        ),
      }];
    }));
  }

  function evaluateBudgets(
    allSamples,
    limits,
    explicitActionLimits,
    expectedActions,
  ) {
    const startup = allSamples.filter((sample) => sample.scenario.startsWith("connections-"));
    const firstShell = percentile(startup.map(firstShellCommit), 0.95);
    const selectedRestore = percentile(
      startup.map(selectedConnectionRestore).filter(Number.isFinite),
      0.95,
    );
    const supportedLongTasks = allSamples.filter(
      (sample) => sample.renderer.longTaskSupported,
    );
    const actionAggregates = aggregateActions(allSamples);
    const actionChecks = {};
    for (const expected of expectedActions) {
      const aggregate = actionAggregates[expected];
      const budget = explicitActionLimits[expected] ?? limits.interactionP95Ms;
      actionChecks[expected] = aggregate
        ? verdict(aggregate.actionToPaintP95Ms, budget)
        : { status: "missing", measured: null, budget };
    }
    const requiredActionCount = Object.keys(actionChecks).length;
    const measuredActionCount = Object.values(actionChecks).filter(
      (check) => check.status !== "missing",
    ).length;
    const idleRate = percentile(
      allSamples
        .filter((sample) => sample.renderer.idleObservationMs > 0)
        .map(idleIpcCallsPerMinute),
      0.95,
    );
    const heapSamples = allSamples
      .map((sample) => sample.renderer.webviewHeapBytes)
      .filter(Number.isFinite);
    const activeFrameGaps = expectedActions
      .filter((action) => !nonVisualNativeActions.has(action))
      .map((action) => actionAggregates[action]?.maxFrameGapP95Ms)
      .filter(Number.isFinite);
    const startupFrameGaps = startup.map(
      (sample) => sample.renderer.maxFrameGapMs,
    );
    const checks = {
      firstShellCommitP95Ms: verdict(firstShell, limits.firstShellCommitP95Ms),
      selectedConnectionRestoreP95Ms: verdict(
        selectedRestore,
        limits.selectedConnectionRestoreP95Ms,
      ),
      maxMainThreadLongTaskMs: supportedLongTasks.length === allSamples.length
        ? verdict(
            Math.max(...supportedLongTasks.map((sample) => sample.renderer.maxLongTaskMs)),
            limits.maxMainThreadLongTaskMs,
          )
        : { status: "unsupported", measured: null, budget: limits.maxMainThreadLongTaskMs },
      maxFrameGapP95Ms: verdict(
        maximum([...startupFrameGaps, ...activeFrameGaps]),
        limits.maxFrameGapP95Ms,
      ),
      maxReactCommitDurationP95Ms: verdict(
        percentile(
          allSamples.map((sample) => sample.renderer.maxReactCommitDurationMs),
          0.95,
        ),
        limits.maxReactCommitDurationP95Ms,
      ),
      maxProcessRssP95Bytes: verdict(
        percentile(allSamples.map((sample) => sample.maxProcessTreeRssBytes), 0.95),
        limits.maxProcessRssP95Bytes,
      ),
      maxWebviewHeapBytes: heapSamples.length === allSamples.length
        ? verdict(maximum(heapSamples), limits.maxWebviewHeapBytes)
        : { status: "unsupported", measured: null, budget: limits.maxWebviewHeapBytes },
      requiredActionCoverage: {
        status: measuredActionCount === requiredActionCount ? "passed" : "failed",
        measured: measuredActionCount,
        budget: requiredActionCount,
      },
      idleIpcCallsPerMinute: verdict(idleRate, limits.idleIpcCallsPerMinute),
    };
    const statuses = [
      ...Object.values(checks).map((check) => check.status),
      ...Object.values(actionChecks).map((check) => check.status),
    ];
    return {
      overall: statuses.includes("failed")
        ? "failed"
        : statuses.every((status) => status === "passed")
          ? "passed"
          : "incomplete",
      checks,
      actionChecks,
    };
  }

  function selectedActionNames(only) {
    if (only === "startup") return [];
    if (only !== null) return requiredActionsByScenario[only];
    return Object.values(requiredActionsByScenario).flat();
  }

  function idleIpcCallsPerMinute(sample) {
    const elapsed = sample.renderer.idleObservationMs;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return Number.NaN;
    return (sample.renderer.idleIpcCallCount * 60_000) / elapsed;
  }

  function sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  function maximum(values) {
    const finite = values.filter(Number.isFinite);
    return finite.length > 0 ? Math.max(...finite) : null;
  }

  function rate(count, elapsedMs) {
    if (!Number.isFinite(count) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return null;
    }
    return round((count * 1_000) / elapsedMs);
  }

  function verdict(measured, budget) {
    if (!Number.isFinite(measured)) return { status: "missing", measured: null, budget };
    return { status: measured <= budget ? "passed" : "failed", measured, budget };
  }

  function firstShellCommit(sample) {
    return stageEnd(sample, "first_shell_commit");
  }

  function selectedConnectionRestore(sample) {
    return stageEnd(sample, "selected_connection_restored");
  }

  function stageEnd(sample, name) {
    const stage = sample.startup.stages.find((candidate) => candidate.name === name);
    return stage ? stage.startedMs + stage.durationMs : Number.NaN;
  }

  function percentile(values, fraction) {
    const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (finite.length === 0) return null;
    return round(finite[Math.max(0, Math.ceil(finite.length * fraction) - 1)]);
  }

  function uniqueWebviews(allSamples) {
    return [...new Map(allSamples.map((sample) => {
      const identity = {
        engine: sample.renderer.webviewEngine,
        version: sample.renderer.webviewVersion,
      };
      return [`${identity.engine}:${identity.version}`, identity];
    })).values()];
  }

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  return {
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
  };
}
