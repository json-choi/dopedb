import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "lib/provider-import-postgres.harness.ts",
    ],
    // The control plane writes through D1, so the suite boots a disposable
    // Miniflare D1 with the production migrations before the scenarios run.
    setupFiles: ["./lib/provider-import-postgres-harness.setup.ts"],
    // Miniflare/workerd boot plus the D1 migrations can exceed vitest's 60s
    // default under runner load, matching vitest.contracts.config.ts.
    hookTimeout: 180_000,
    testTimeout: 180_000,
  },
});
