import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Next replaces this marker at build time; contract tests run in Node and
    // alias the side-effect-only import without weakening production modules.
    alias: { "server-only": "node:fs", "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: [
      "lib/control-plane-contracts.harness.ts",
      "lib/d1-storage.harness.ts",
    ],
  },
});
