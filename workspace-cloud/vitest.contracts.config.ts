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
    // Miniflare/workerd boot plus 7 D1 migrations can exceed vitest's 60s
    // default under runner load even though CPU time is ~10s (issue #194).
    // Set explicit timeouts so slow-runner boot time doesn't read as a
    // regression; both cover the heavy beforeAll/afterAll and the assertions.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
