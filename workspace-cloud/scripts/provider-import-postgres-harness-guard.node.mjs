import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROVIDER_IMPORT_POSTGRES_HARNESS_SOURCE_LIMITS,
  PROVIDER_POSTGRES_HARNESS_CONFIG_PATH,
  canonicalLogicalDatabaseTarget,
  validateHarnessEnvironment,
  validateHarnessSourceTree,
} from "./provider-import-postgres-harness-guard.mjs";

const workspaceCloudDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

function expectMutatedSourceRejection(relativePath, mutate, expected) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "dopedb-provider-harness-guard-"));
  try {
    for (const sourcePath of [
      ...Object.keys(PROVIDER_IMPORT_POSTGRES_HARNESS_SOURCE_LIMITS),
      PROVIDER_POSTGRES_HARNESS_CONFIG_PATH,
    ]) {
      const target = resolve(temporaryRoot, sourcePath);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(resolve(workspaceCloudDirectory, sourcePath), target);
    }
    const target = resolve(temporaryRoot, relativePath);
    writeFileSync(target, mutate(readFileSync(target, "utf8")), "utf8");
    assert.throws(() => validateHarnessSourceTree(temporaryRoot), expected);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

const isolatedUrl = "postgresql://harness:secret@127.0.0.1:55432/dopedb_provider_import_test";
const base = {
  PROVIDER_IMPORT_TEST_DATABASE_URL: isolatedUrl,
  PROVIDER_IMPORT_TEST_DATABASE_ISOLATED: "1",
  PROVIDER_IMPORT_TEST_DATABASE_SENTINEL: "dedicated-fixture-marker",
};

test("canonical target ignores credentials and Neon pooler alias", () => {
  assert.equal(
    canonicalLogicalDatabaseTarget(
      "postgresql://a:first@ep-sample-pooler.example.test:5432/app",
    ),
    canonicalLogicalDatabaseTarget(
      "postgres://b:second@ep-sample.example.test/app?sslmode=require",
    ),
  );
});

test("guard accepts a dedicated confirmed database", () => {
  assert.deepEqual(validateHarnessEnvironment(base), {
    dedicatedUrl: isolatedUrl,
    sentinel: "dedicated-fixture-marker",
  });
  assert.ok(validateHarnessSourceTree().totalLines > 0);

  for (const declaration of [
    'it.each([1])("hidden case", () => {})',
    'it["each"]([1])("hidden computed case", () => {})',
    'test.concurrent("hidden concurrent case", () => {})',
    'test.skipIf(false)("hidden conditional case", () => {})',
  ]) {
    expectMutatedSourceRejection(
      "lib/provider-import-postgres-harness/assertions.ts",
      (source) => `${source}\n${declaration}\n`,
      /exactly one unmodified root test declaration/,
    );
  }
  for (const mutate of [
    (source) => `${source.replace(
      'import { expect, vi } from "vitest";',
      'import { expect, it as scenario, vi } from "vitest";',
    )}\nscenario("hidden aliased case", () => {});\n`,
    (source) => `${source}\nimport * as hiddenVitest from "vitest";\nhiddenVitest.test("hidden namespace case", () => {});\n`,
    (source) => `${source}\nconst scenario = it;\nscenario("hidden assigned alias", () => {});\n`,
    (source) => `${source}\nconst matrix = it["each"];\nmatrix([1])("hidden computed alias", () => {});\n`,
    (source) => `${source}\nimport * as computedVitest from "vitest";\ncomputedVitest["it"]("hidden computed namespace", () => {});\n`,
  ]) {
    expectMutatedSourceRejection(
      "lib/provider-import-postgres-harness/assertions.ts",
      mutate,
      /exactly one unmodified root test declaration/,
    );
  }
  expectMutatedSourceRejection(
    "lib/provider-import-postgres.harness.ts",
    (source) => source.replace("\n  it(", "\n  it.concurrent("),
    /exactly one unmodified root test declaration/,
  );
  expectMutatedSourceRejection(
    "lib/provider-import-postgres.harness.ts",
    (source) => source
      .replace(
        'import { describe, it, vi } from "vitest";',
        'import { describe as suite, it, vi } from "vitest";',
      )
      .replace(
        "describe.runIf(enabled)",
        "suite.runIf(enabled) /* describe.runIf(enabled) */",
      ),
    /exactly one unmodified root test declaration/,
  );
  expectMutatedSourceRejection(
    "lib/provider-import-postgres.harness.ts",
    (source) => source.replace(
      "    } finally {\n      await database.cleanup();\n    }",
      "    } finally {\n      // await database.cleanup();\n    }\n    await database.cleanup();",
    ),
    /cleanup must be unconditional inside the root finally/,
  );
  expectMutatedSourceRejection(
    "lib/provider-import-postgres.harness.ts",
    (source) => source.replace(
      "    } finally {\n      await database.cleanup();",
      "    } finally {\n      return;\n      await database.cleanup();",
    ),
    /cleanup must be unconditional inside the root finally/,
  );
  expectMutatedSourceRejection(
    PROVIDER_POSTGRES_HARNESS_CONFIG_PATH,
    (source) => source.replace(
      '"lib/provider-import-postgres.harness.ts",',
      '"lib/provider-import-postgres.harness.ts",\n      "lib/hidden-postgres.harness.ts",',
    ),
    /config and guarded root manifest must match exactly/,
  );
});

test("guard rejects missing opt-in or short sentinel", () => {
  assert.throws(() => validateHarnessEnvironment({
    ...base,
    PROVIDER_IMPORT_TEST_DATABASE_ISOLATED: "0",
  }));
  assert.throws(() => validateHarnessEnvironment({
    ...base,
    PROVIDER_IMPORT_TEST_DATABASE_SENTINEL: "short",
  }));
});

test("guard rejects every alias of the application database", () => {
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL"]) {
    assert.throws(() => validateHarnessEnvironment({
      ...base,
      [name]: "postgresql://app:other@127.0.0.1:55432/dopedb_provider_import_test",
    }));
  }
});

test("guard rejects non-PostgreSQL and incomplete URLs", () => {
  assert.throws(() => validateHarnessEnvironment({
    ...base,
    PROVIDER_IMPORT_TEST_DATABASE_URL: "mysql://harness@127.0.0.1/app",
  }));
  assert.throws(() => validateHarnessEnvironment({
    ...base,
    PROVIDER_IMPORT_TEST_DATABASE_URL: "postgresql://127.0.0.1/app",
  }));
});
