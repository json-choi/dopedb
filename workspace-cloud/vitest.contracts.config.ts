import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Next replaces this marker at build time; contract tests run in Node and
    // alias the side-effect-only import without weakening production modules.
    alias: { "server-only": "node:fs" },
  },
  test: {
    include: [
      "lib/control-plane-contracts.harness.ts",
    ],
  },
});
