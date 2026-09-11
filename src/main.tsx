import React from "react";
import { createRoot } from "./reactDomClient";
import App from "./App";
import { PackagedBenchmarkProfiler } from "./benchmarks/PackagedBenchmarkProfiler";
import { packagedRendererMetrics } from "./benchmarks/packagedMetrics";
import {
  completePackagedBenchmark,
  packagedBenchmarkConfig,
  recordStartupMark,
} from "./features/runtime/tauriAdapter";
import {
  initializeClientMonitoring,
  listenForAgentPluginTelemetry,
} from "./features/monitoring/client";
import { initializeProductAnalytics } from "./features/productAnalytics/client";
import { ProductAnalyticsWorkspaceScopeObserver } from "./features/productAnalytics/WorkspaceScopeObserver";
import { ProductAnalyticsConsentPrompt } from "./features/productAnalytics/ConsentPrompt";
import { AppProviders } from "./lib/appProviders";

void initializeProductAnalytics();

void initializeClientMonitoring()
  .then(() => listenForAgentPluginTelemetry())
  .catch(() => undefined);

const packagedBenchmark =
  import.meta.env.VITE_DOPEDB_PACKAGED_BENCHMARK === "1";
const benchmarkConfig = packagedBenchmark
  ? await packagedBenchmarkConfig()
  : null;
let application: React.ReactNode;
if (benchmarkConfig?.kind === "workload" || benchmarkConfig?.kind === "qa") {
  const { PackagedBenchmarkApplication } = await import(
    "./benchmarks/PackagedBenchmarkApplication"
  );
  application = (
    <AppProviders>
      <PackagedBenchmarkApplication
        scenario={benchmarkConfig.scenario}
        phase={benchmarkConfig.phase}
      />
    </AppProviders>
  );
} else {
  application = (
    <AppProviders>
      {!packagedBenchmark ? <ProductAnalyticsWorkspaceScopeObserver /> : null}
      <App />
      {!packagedBenchmark ? <ProductAnalyticsConsentPrompt /> : null}
    </AppProviders>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {packagedBenchmark ? (
      <PackagedBenchmarkProfiler>{application}</PackagedBenchmarkProfiler>
    ) : application}
  </React.StrictMode>,
);

window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    void recordStartupMark("first_shell_commit")
      .then(() => {
        if (!packagedBenchmark || benchmarkConfig?.kind !== "startup") return;
        window.setTimeout(() => {
          void completePackagedBenchmark(packagedRendererMetrics()).catch(
            () => undefined,
          );
        }, 1_500);
      })
      .catch(() => undefined);
  });
});
