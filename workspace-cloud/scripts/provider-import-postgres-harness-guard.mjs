import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceCloudDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

export const PROVIDER_IMPORT_POSTGRES_HARNESS_SOURCE_LIMITS = Object.freeze({
  "lib/provider-import-postgres.harness.ts": 70,
  "lib/knowledge/graph-activation-postgres.harness.ts": 800,
  "lib/provider-import-postgres-harness/fixture.ts": 380,
  "lib/provider-import-postgres-harness/assertions.ts": 200,
  "lib/provider-import-postgres-harness/authority-provider-scenarios.ts": 380,
  "lib/provider-import-postgres-harness/connection-versioning-scenarios.ts": 54,
  "lib/provider-import-postgres-harness/analysis-lifecycle-scenarios.ts": 380,
  "lib/provider-import-postgres-harness/analysis-member-removal-scenarios.ts": 210,
  "lib/provider-import-postgres-harness/sync-scenarios.ts": 200,
  "lib/provider-import-postgres-harness/provider-operation-scenarios.ts": 600,
  "lib/provider-import-postgres-harness/personal-knowledge-scenarios.ts": 80,
  "lib/provider-import-postgres-harness/workspace-lifecycle-scenarios.ts": 320,
});

export const PROVIDER_IMPORT_POSTGRES_HARNESS_TOTAL_LINE_LIMIT = 3_500;
export const PROVIDER_POSTGRES_HARNESS_CONFIG_PATH =
  "vitest.provider-harness.config.ts";

const POSTGRES_HARNESS_ROOT_MANIFEST = Object.freeze({
  "lib/provider-import-postgres.harness.ts": Object.freeze({
    cleanupRequirements: Object.freeze([
      Object.freeze({
        marker: "await database.cleanup();",
        tokens: Object.freeze(["await", "database", ".", "cleanup", "(", ")"]),
      }),
    ]),
    finallyMarkers: Object.freeze([]),
    sourceMarkers: Object.freeze([
      "openProviderImportPostgresHarness(",
    ]),
  }),
  "lib/knowledge/graph-activation-postgres.harness.ts": Object.freeze({
    cleanupRequirements: Object.freeze([
      Object.freeze({
        marker: "queueHarness.query = null;",
        tokens: Object.freeze(["queueHarness", ".", "query", "=", "null"]),
      }),
      Object.freeze({
        marker: 'DELETE FROM "workspace_control"."organization"',
        tokens: Object.freeze(["await", "client"]),
      }),
      Object.freeze({
        marker: "await client.end({ timeout: 5 });",
        tokens: Object.freeze(["await", "client", ".", "end", "("]),
      }),
    ]),
    finallyMarkers: Object.freeze([]),
    sourceMarkers: Object.freeze([
      '"provider_harness"."isolated_database_sentinel"',
      "expect(sentinel[0]?.confirmed).toBe(true)",
    ]),
  }),
});

export const DEFAULT_DATABASE_URL_ENV_NAMES = Object.freeze([
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DATABASE_URL_POOLED",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NO_SSL",
  "NEON_DATABASE_URL",
  "NEON_DATABASE_URL_UNPOOLED",
]);

function decoded(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid percent encoding in ${field}`);
  }
}

// Credentials and pooling host aliases do not make a database isolated. Compare
// the logical host/port/database tuple against every normal application URL.
export function canonicalLogicalDatabaseTarget(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Harness database URL must use PostgreSQL");
  }
  let hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  if (labels[0]?.endsWith("-pooler")) {
    labels[0] = labels[0].slice(0, -"-pooler".length);
    hostname = labels.join(".");
  }
  const username = decoded(url.username, "username");
  const database = decoded(url.pathname.replace(/^\//, ""), "database");
  if (!hostname || !username || !database) {
    throw new Error("Harness database URL must identify host, user, and database");
  }
  return JSON.stringify({ hostname, port: url.port || "5432", database });
}

export function validateHarnessEnvironment(environment) {
  const dedicatedUrl =
    environment.PROVIDER_IMPORT_TEST_DATABASE_URL?.trim() ?? "";
  const isolated =
    environment.PROVIDER_IMPORT_TEST_DATABASE_ISOLATED === "1";
  const sentinel =
    environment.PROVIDER_IMPORT_TEST_DATABASE_SENTINEL?.trim() ?? "";
  if (!dedicatedUrl || !isolated || sentinel.length < 16 || sentinel.length > 256) {
    throw new Error(
      "A dedicated URL, isolation confirmation, and sentinel are required",
    );
  }
  const dedicatedTarget = canonicalLogicalDatabaseTarget(dedicatedUrl);
  for (const name of DEFAULT_DATABASE_URL_ENV_NAMES) {
    const candidate = environment[name]?.trim();
    if (!candidate) continue;
    if (canonicalLogicalDatabaseTarget(candidate) === dedicatedTarget) {
      throw new Error(
        "The harness database resolves to a default application database",
      );
    }
  }
  return { dedicatedUrl, sentinel };
}

function lineCount(source) {
  const withoutTrailingNewline = source.replace(/\r?\n$/, "");
  return withoutTrailingNewline ? withoutTrailingNewline.split(/\r?\n/).length : 0;
}

function requireSourceMarker(source, relativePath, marker) {
  if (!source.includes(marker)) {
    throw new Error(`PostgreSQL harness source guard lost ${marker} in ${relativePath}`);
  }
}

function harnessSourceTokens(source) {
  const tokens = [];
  let cursor = 0;

  function push(value, start = cursor, kind = "punctuator") {
    tokens.push({ kind, start, value });
  }

  function skipQuoted(quote) {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
      } else if (source[cursor] === quote) {
        cursor += 1;
        push(source.slice(start + 1, cursor - 1), start, "string");
        return;
      } else {
        cursor += 1;
      }
    }
  }

  function regexCanStart() {
    const previous = tokens.at(-1)?.value;
    return previous === undefined || [
      "(", "[", "{", ",", ";", ":", "=", "=>", "!", "?", "&&", "||",
      "return", "case", "throw", "await", "yield",
    ].includes(previous);
  }

  function skipRegex() {
    cursor += 1;
    let inCharacterClass = false;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === "\\") {
        cursor += 2;
      } else if (character === "[") {
        inCharacterClass = true;
        cursor += 1;
      } else if (character === "]") {
        inCharacterClass = false;
        cursor += 1;
      } else if (character === "/" && !inCharacterClass) {
        cursor += 1;
        while (/[a-z]/i.test(source[cursor] ?? "")) cursor += 1;
        return;
      } else {
        cursor += 1;
      }
    }
  }

  function scanTemplate() {
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
      } else if (source[cursor] === "`") {
        cursor += 1;
        return;
      } else if (source[cursor] === "$" && source[cursor + 1] === "{") {
        cursor += 2;
        scanCode(true);
      } else {
        cursor += 1;
      }
    }
  }

  function scanCode(stopAtTemplateBrace) {
    let templateBraceDepth = 0;
    while (cursor < source.length) {
      const character = source[cursor];
      const next = source[cursor + 1];
      if (/\s/.test(character)) {
        cursor += 1;
        continue;
      }
      if (character === "/" && next === "/") {
        cursor += 2;
        while (cursor < source.length && !/[\r\n]/.test(source[cursor])) cursor += 1;
        continue;
      }
      if (character === "/" && next === "*") {
        cursor += 2;
        while (
          cursor < source.length
          && !(source[cursor] === "*" && source[cursor + 1] === "/")
        ) {
          cursor += 1;
        }
        cursor = Math.min(cursor + 2, source.length);
        continue;
      }
      if (character === "'" || character === '"') {
        skipQuoted(character);
        continue;
      }
      if (character === "`") {
        scanTemplate();
        continue;
      }
      if (character === "/" && regexCanStart()) {
        skipRegex();
        continue;
      }
      if (/[A-Za-z_$]/.test(character)) {
        const start = cursor;
        cursor += 1;
        while (/[A-Za-z0-9_$]/.test(source[cursor] ?? "")) cursor += 1;
        push(source.slice(start, cursor), start, "identifier");
        continue;
      }
      if (stopAtTemplateBrace && character === "}" && templateBraceDepth === 0) {
        cursor += 1;
        return;
      }
      if (character === "{") templateBraceDepth += 1;
      if (character === "}") templateBraceDepth -= 1;
      const start = cursor;
      const pair = source.slice(cursor, cursor + 2);
      if (["=>", "?.", "&&", "||", "??"].includes(pair)) {
        push(pair, start);
        cursor += 2;
      } else {
        push(character, start);
        cursor += 1;
      }
    }
  }

  scanCode(false);
  return tokens;
}

function matchingTokenIndex(tokens, openIndex, open, close) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    if (tokens[index].value === close) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function configuredPostgresHarnessRoots(source) {
  const tokens = harnessSourceTokens(source);
  const declarations = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index].kind === "identifier"
      && tokens[index].value === "include"
      && tokens[index + 1]?.value === ":"
      && tokens[index + 2]?.value === "["
    ) {
      declarations.push(index + 2);
    }
  }
  if (declarations.length !== 1) {
    throw new Error("PostgreSQL harness config must retain one explicit include manifest");
  }
  const openIndex = declarations[0];
  const closeIndex = matchingTokenIndex(tokens, openIndex, "[", "]");
  if (closeIndex < 0) {
    throw new Error("PostgreSQL harness config include manifest is malformed");
  }
  const roots = [];
  for (const token of tokens.slice(openIndex + 1, closeIndex)) {
    if (token.value === ",") continue;
    if (token.kind !== "string") {
      throw new Error("PostgreSQL harness config includes must be explicit paths");
    }
    roots.push(token.value);
  }
  if (roots.length !== new Set(roots).size) {
    throw new Error("PostgreSQL harness config includes duplicate roots");
  }
  return roots;
}

const VITEST_CALL_NAMES = new Set(["describe", "it", "test"]);

function memberAt(tokens, index) {
  if (
    [".", "?."].includes(tokens[index]?.value)
    && tokens[index + 1]?.kind === "identifier"
  ) {
    return {
      label: `.${tokens[index + 1].value}`,
      name: tokens[index + 1].value,
      nextIndex: index + 2,
    };
  }
  if (
    tokens[index]?.value === "["
    && tokens[index + 1]?.kind === "string"
    && tokens[index + 2]?.value === "]"
  ) {
    return {
      label: `[${JSON.stringify(tokens[index + 1].value)}]`,
      name: tokens[index + 1].value,
      nextIndex: index + 3,
    };
  }
  return null;
}

function vitestReference(tokens, index, bindings) {
  if (tokens[index]?.kind !== "identifier") return null;
  let reference;
  const direct = bindings.direct.get(tokens[index].value);
  if (
    direct
    && ![".", "?."].includes(tokens[index - 1]?.value)
  ) {
    reference = {
      base: direct.base,
      callee: tokens[index].value,
      modifiers: [...direct.modifiers],
      nextIndex: index + 1,
    };
  } else if (bindings.namespaces.has(tokens[index].value)) {
    const member = memberAt(tokens, index + 1);
    if (!member || !VITEST_CALL_NAMES.has(member.name)) return null;
    reference = {
      base: member.name,
      callee: `${tokens[index].value}${member.label}`,
      modifiers: [],
      nextIndex: member.nextIndex,
    };
  } else {
    return null;
  }
  while (true) {
    const member = memberAt(tokens, reference.nextIndex);
    if (!member) break;
    reference.modifiers.push(member.name);
    reference.nextIndex = member.nextIndex;
  }
  return reference;
}

function vitestBindings(tokens) {
  const direct = new Map([
    ["describe", { base: "describe", modifiers: [] }],
    ["it", { base: "it", modifiers: [] }],
    ["test", { base: "test", modifiers: [] }],
  ]);
  const namespaces = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "import" || tokens[index].kind !== "identifier") continue;
    let cursor = index + 1;
    const named = [];
    let namespace = null;
    if (tokens[cursor]?.value === "{") {
      cursor += 1;
      while (cursor < tokens.length && tokens[cursor]?.value !== "}") {
        if (tokens[cursor]?.value === ",") {
          cursor += 1;
          continue;
        }
        if (tokens[cursor]?.value === "type") cursor += 1;
        const imported = tokens[cursor]?.value;
        if (tokens[cursor]?.kind !== "identifier") break;
        cursor += 1;
        let local = imported;
        if (tokens[cursor]?.value === "as") {
          local = tokens[cursor + 1]?.value;
          cursor += 2;
        }
        named.push([imported, local]);
      }
      if (tokens[cursor]?.value !== "}") continue;
      cursor += 1;
    } else if (
      tokens[cursor]?.value === "*"
      && tokens[cursor + 1]?.value === "as"
      && tokens[cursor + 2]?.kind === "identifier"
    ) {
      namespace = tokens[cursor + 2].value;
      cursor += 3;
    } else {
      continue;
    }
    if (
      tokens[cursor]?.value !== "from"
      || tokens[cursor + 1]?.kind !== "string"
      || tokens[cursor + 1].value !== "vitest"
    ) {
      continue;
    }
    for (const [imported, local] of named) {
      if (VITEST_CALL_NAMES.has(imported)) {
        direct.set(local, { base: imported, modifiers: [] });
      }
    }
    if (namespace) namespaces.add(namespace);
  }
  const bindings = { direct, namespaces };
  let addedAlias = true;
  while (addedAlias) {
    addedAlias = false;
    for (let index = 0; index < tokens.length - 3; index += 1) {
      if (
        !["const", "let", "var"].includes(tokens[index].value)
        || tokens[index + 1]?.kind !== "identifier"
        || tokens[index + 2]?.value !== "="
      ) {
        continue;
      }
      const local = tokens[index + 1].value;
      const reference = vitestReference(tokens, index + 3, bindings);
      if (!reference || direct.has(local)) continue;
      direct.set(local, {
        base: reference.base,
        modifiers: reference.modifiers,
      });
      addedAlias = true;
    }
  }
  return bindings;
}

function vitestCalls(tokens, names) {
  const calls = [];
  const bindings = vitestBindings(tokens);
  for (let index = 0; index < tokens.length; index += 1) {
    const reference = vitestReference(tokens, index, bindings);
    if (!reference || !names.has(reference.base)) continue;
    if (tokens[reference.nextIndex]?.value === "(") {
      calls.push({
        base: reference.base,
        callee: reference.callee,
        callIndex: reference.nextIndex,
        modifiers: reference.modifiers,
      });
    }
  }
  return calls;
}

function rootFinallyRange(tokens, testCall) {
  const callClose = matchingTokenIndex(tokens, testCall.callIndex, "(", ")");
  if (callClose < 0) return null;
  let callbackOpen = -1;
  for (let index = testCall.callIndex + 1; index < callClose; index += 1) {
    if (tokens[index].value === "=>" && tokens[index + 1]?.value === "{") {
      callbackOpen = index + 1;
      break;
    }
  }
  if (callbackOpen < 0) return null;
  const callbackClose = matchingTokenIndex(tokens, callbackOpen, "{", "}");
  if (callbackClose < 0) return null;

  const rootTries = [];
  let braceDepth = 0;
  for (let index = callbackOpen + 1; index < callbackClose; index += 1) {
    if (tokens[index].value === "{") {
      braceDepth += 1;
      continue;
    }
    if (tokens[index].value === "}") {
      braceDepth -= 1;
      continue;
    }
    if (tokens[index].value !== "try" || braceDepth !== 0) continue;
    const tryOpen = index + 1;
    if (tokens[tryOpen]?.value !== "{") return null;
    const tryClose = matchingTokenIndex(tokens, tryOpen, "{", "}");
    if (tryClose < 0) return null;
    let nextIndex = tryClose + 1;
    if (tokens[nextIndex]?.value === "catch") {
      nextIndex += 1;
      if (tokens[nextIndex]?.value === "(") {
        nextIndex = matchingTokenIndex(tokens, nextIndex, "(", ")") + 1;
      }
      if (tokens[nextIndex]?.value !== "{") return null;
      nextIndex = matchingTokenIndex(tokens, nextIndex, "{", "}") + 1;
    }
    if (tokens[nextIndex]?.value !== "finally" || tokens[nextIndex + 1]?.value !== "{") {
      rootTries.push(null);
      continue;
    }
    const finallyOpen = nextIndex + 1;
    const finallyClose = matchingTokenIndex(tokens, finallyOpen, "{", "}");
    rootTries.push(finallyClose < 0 ? null : { finallyClose, finallyOpen });
  }
  return rootTries.length === 1 ? rootTries[0] : null;
}

function tokenSequenceIndices(tokens, sequence) {
  const indices = [];
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((value, offset) => tokens[index + offset]?.value === value)) {
      indices.push(index);
    }
  }
  return indices;
}

function sourceMarkerPositions(source, marker) {
  const positions = [];
  let cursor = 0;
  while (cursor <= source.length - marker.length) {
    const position = source.indexOf(marker, cursor);
    if (position < 0) break;
    positions.push(position);
    cursor = position + marker.length;
  }
  return positions;
}

function cleanupRequirementIndex(tokens, source, requirement) {
  const markerPositions = sourceMarkerPositions(source, requirement.marker);
  if (markerPositions.length !== 1) return -1;
  const markerPosition = markerPositions[0];
  const candidates = tokenSequenceIndices(tokens, requirement.tokens)
    .filter((index) => tokens[index].start <= markerPosition)
    .filter((index) => {
      const sequenceEnd = index + requirement.tokens.length;
      return !tokens.slice(sequenceEnd).some((token) => (
        token.start < markerPosition && token.value === ";"
      ));
    });
  return candidates.at(-1) ?? -1;
}

function markerIsInsideFinally(source, tokens, finallyRange, marker) {
  const positions = sourceMarkerPositions(source, marker);
  return positions.length === 1
    && positions[0] > tokens[finallyRange.finallyOpen].start
    && positions[0] < tokens[finallyRange.finallyClose].start;
}

function cleanupIsUnconditional(tokens, finallyRange, cleanupIndex) {
  let braceDepth = 0;
  let canBeBypassed = false;
  for (let index = finallyRange.finallyOpen + 1; index < cleanupIndex; index += 1) {
    if (tokens[index].value === "{") braceDepth += 1;
    if (tokens[index].value === "}") braceDepth -= 1;
    if (["return", "throw", "break", "continue"].includes(tokens[index].value)) {
      canBeBypassed = true;
    }
  }
  return cleanupIndex > finallyRange.finallyOpen
    && cleanupIndex < finallyRange.finallyClose
    && braceDepth === 0
    && !canBeBypassed
    && ["{", ";", "}"].includes(tokens[cleanupIndex - 1]?.value);
}

function validateHarnessTestStructure(relativePath, rootSource, manifest) {
  const rootTokens = harnessSourceTokens(rootSource);
  const rootTests = vitestCalls(rootTokens, new Set(["it", "test"]));
  const rootDescribes = vitestCalls(rootTokens, new Set(["describe"]));
  if (
    rootTests.length !== 1
    || rootTests[0].base !== "it"
    || rootTests[0].callee !== "it"
    || rootTests[0].modifiers.length !== 0
    || rootDescribes.length !== 1
    || rootDescribes[0].callee !== "describe"
    || rootDescribes[0].modifiers.join(".") !== "runIf"
  ) {
    throw new Error(
      `PostgreSQL harness must retain exactly one unmodified root test declaration in ${relativePath}`,
    );
  }
  const runIfClose = matchingTokenIndex(
    rootTokens,
    rootDescribes[0].callIndex,
    "(",
    ")",
  );
  if (
    rootTokens[rootDescribes[0].callIndex + 1]?.value !== "enabled"
    || rootTokens[rootDescribes[0].callIndex + 2]?.value !== ")"
    || rootTokens[runIfClose + 1]?.value !== "("
  ) {
    throw new Error(
      `PostgreSQL harness root describe must remain gated by runIf(enabled) in ${relativePath}`,
    );
  }

  const finallyRange = rootFinallyRange(rootTokens, rootTests[0]);
  if (!finallyRange) {
    throw new Error(
      `PostgreSQL harness must retain one root try/finally in ${relativePath}`,
    );
  }
  const cleanupIndices = [];
  for (const requirement of manifest.cleanupRequirements) {
    const cleanupIndex = cleanupRequirementIndex(
      rootTokens,
      rootSource,
      requirement,
    );
    if (
      cleanupIndex < 0
      || !markerIsInsideFinally(
        rootSource,
        rootTokens,
        finallyRange,
        requirement.marker,
      )
      || !cleanupIsUnconditional(rootTokens, finallyRange, cleanupIndex)
    ) {
      throw new Error(
        `PostgreSQL harness cleanup must be unconditional inside the root finally in ${relativePath}`,
      );
    }
    cleanupIndices.push(cleanupIndex);
  }
  if (
    cleanupIndices.some((index, position) => (
      position > 0 && index <= cleanupIndices[position - 1]
    ))
    || manifest.finallyMarkers.some((marker) => (
      !markerIsInsideFinally(rootSource, rootTokens, finallyRange, marker)
    ))
  ) {
    throw new Error(
      `PostgreSQL harness cleanup must be ordered inside the root finally in ${relativePath}`,
    );
  }
}

export function validateHarnessSourceTree(rootDirectory = workspaceCloudDirectory) {
  const sources = new Map();
  const lineCounts = {};
  let totalLines = 0;

  for (const [relativePath, maximumLines] of Object.entries(
    PROVIDER_IMPORT_POSTGRES_HARNESS_SOURCE_LIMITS,
  )) {
    const source = readFileSync(resolve(rootDirectory, relativePath), "utf8");
    const lines = lineCount(source);
    if (lines > maximumLines) {
      throw new Error(
        `PostgreSQL harness source ratchet exceeded for ${relativePath}: ${lines} > ${maximumLines}`,
      );
    }
    sources.set(relativePath, source);
    lineCounts[relativePath] = lines;
    totalLines += lines;
  }
  if (totalLines > PROVIDER_IMPORT_POSTGRES_HARNESS_TOTAL_LINE_LIMIT) {
    throw new Error(
      `PostgreSQL harness total source ratchet exceeded: ${totalLines} > ${PROVIDER_IMPORT_POSTGRES_HARNESS_TOTAL_LINE_LIMIT}`,
    );
  }

  const supportDirectory = resolve(rootDirectory, "lib/provider-import-postgres-harness");
  const expectedSupportFiles = new Set(
    Object.keys(PROVIDER_IMPORT_POSTGRES_HARNESS_SOURCE_LIMITS)
      .filter((relativePath) => relativePath.startsWith("lib/provider-import-postgres-harness/"))
      .map((relativePath) => relativePath.slice("lib/provider-import-postgres-harness/".length)),
  );
  const actualSupportFiles = readdirSync(supportDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name);
  if (
    actualSupportFiles.length !== expectedSupportFiles.size
    || actualSupportFiles.some((file) => !expectedSupportFiles.has(file))
  ) {
    throw new Error("PostgreSQL harness source manifest is incomplete");
  }

  const configuredRoots = configuredPostgresHarnessRoots(readFileSync(
    resolve(rootDirectory, PROVIDER_POSTGRES_HARNESS_CONFIG_PATH),
    "utf8",
  ));
  const expectedRoots = Object.keys(POSTGRES_HARNESS_ROOT_MANIFEST);
  const configuredRootSet = new Set(configuredRoots);
  if (
    configuredRoots.length !== expectedRoots.length
    || expectedRoots.some((rootPath) => !configuredRootSet.has(rootPath))
  ) {
    throw new Error(
      "PostgreSQL harness config and guarded root manifest must match exactly",
    );
  }

  const supportSource = [...sources.entries()]
    .filter(([relativePath]) => (
      relativePath.startsWith("lib/provider-import-postgres-harness/")
    ))
    .map(([, source]) => source)
    .join("\n");
  if (
    vitestCalls(
      harnessSourceTokens(supportSource),
      VITEST_CALL_NAMES,
    ).length !== 0
  ) {
    throw new Error(
      "PostgreSQL harness must retain exactly one unmodified root test declaration",
    );
  }

  for (const [rootPath, manifest] of Object.entries(
    POSTGRES_HARNESS_ROOT_MANIFEST,
  )) {
    const rootSource = sources.get(rootPath) ?? "";
    validateHarnessTestStructure(rootPath, rootSource, manifest);
    for (const marker of [
      "PROVIDER_IMPORT_TEST_DATABASE_URL",
      "PROVIDER_IMPORT_TEST_DATABASE_ISOLATED",
      "PROVIDER_IMPORT_TEST_DATABASE_SENTINEL",
      "WORKSPACE_CLOUD_RUN_POSTGRES_IMPORT_HARNESS",
      "describe.runIf(enabled)",
      ...manifest.sourceMarkers,
    ]) {
      requireSourceMarker(rootSource, rootPath, marker);
    }
  }

  const fixturePath = "lib/provider-import-postgres-harness/fixture.ts";
  const fixtureSource = sources.get(fixturePath) ?? "";
  for (const marker of [
    '"provider_harness"."isolated_database_sentinel"',
    "Dedicated PostgreSQL harness sentinel was not confirmed",
    "Dedicated PostgreSQL harness database is not pre-migrated",
    'DELETE FROM "workspace_control"."organization"',
    'DELETE FROM "workspace_control"."user"',
    "await sql.end({ timeout: 5 })",
    'vi.doUnmock("../db")',
    'vi.doUnmock("../workspace-kms")',
    "registerCleanupTargets",
  ]) {
    requireSourceMarker(fixtureSource, fixturePath, marker);
  }

  return { lineCounts, totalLines };
}
