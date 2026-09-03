// Extracts language-light structural signals. The values are review evidence,
// never an instruction to split at an arbitrary line number.
import path from "node:path";

import { parse } from "@babel/parser";

const JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const CATEGORY_THRESHOLDS = Object.freeze({
  declarative: { review: 1_200, strong: 3_000 },
  generated: { review: Number.POSITIVE_INFINITY, strong: Number.POSITIVE_INFINITY },
  production: { review: 300, strong: 800 },
  test: { review: 800, strong: 1_600 },
  tooling: { review: 500, strong: 1_000 },
});

const RESPONSIBILITY_PATTERNS = Object.freeze({
  persistence: /\b(?:sqlx|rusqlite|sqlite|postgres|migration|repository|localStorage|readFile|writeFile|fs::)\b/i,
  policy: /\b(?:authoriz|permission|policy|validate|sanitize|capabilit|grant|safety)\w*\b/i,
  presentation: /\b(?:React|JSX|useLayoutEffect|createPortal|aria-|className)\b|<\/?[A-Z][A-Za-z0-9.]*/,
  process: /\b(?:spawn|child_process|Command::new|process ancestry|runtime manager|worker thread)\b/i,
  state: /\b(?:useState|useReducer|useSyncExternalStore|createStore|Mutex|RwLock|OnceLock|state store|cache)\b/,
  transport: /\b(?:fetch\s*\(|reqwest|invoke\s*\(|tauri::command|axum|http::|WebSocket|IPC)\b/i,
});

function lineMetrics(source) {
  const lines = source ? source.split("\n") : [];
  const loc = source.endsWith("\n") ? Math.max(0, lines.length - 1) : lines.length;
  let blockComment = false;
  let substantive = 0;
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    if (blockComment) {
      const end = line.indexOf("*/");
      if (end < 0) continue;
      blockComment = false;
      line = line.slice(end + 2).trim();
      if (!line) continue;
    }
    if (line.startsWith("/*")) {
      const end = line.indexOf("*/", 2);
      if (end < 0) {
        blockComment = true;
        continue;
      }
      line = line.slice(end + 2).trim();
    }
    if (!line || line.startsWith("//") || line.startsWith("# ")) continue;
    substantive += 1;
  }
  return { loc, substantive };
}

function parserPlugins(extension) {
  const plugins = ["decorators-legacy", "importAttributes"];
  if (extension === ".ts" || extension === ".tsx") plugins.push("typescript");
  if (extension === ".jsx" || extension === ".tsx") plugins.push("jsx");
  return plugins;
}

function unwrapDeclaration(node) {
  if (node.type === "ExportDefaultDeclaration" || node.type === "ExportNamedDeclaration") {
    return node.declaration;
  }
  return node;
}

function javascriptStructure(source, extension) {
  const result = {
    importSpecifiers: [],
    parseError: null,
    runtimeDeclarations: 0,
    topLevelDeclarations: 0,
    typeDeclarations: 0,
  };
  try {
    const program = parse(source, {
      errorRecovery: true,
      plugins: parserPlugins(extension),
      sourceType: "unambiguous",
    }).program;
    for (const statement of program.body) {
      if (
        statement.type === "ImportDeclaration"
        || statement.type === "ExportAllDeclaration"
        || (statement.type === "ExportNamedDeclaration" && statement.source)
      ) {
        if (statement.source?.value) result.importSpecifiers.push(statement.source.value);
      }
      const declaration = unwrapDeclaration(statement);
      if (!declaration) continue;
      if (declaration.type === "VariableDeclaration") {
        result.topLevelDeclarations += declaration.declarations.length;
        result.runtimeDeclarations += declaration.declarations.length;
      } else if (/^(?:Function|Class)Declaration$/.test(declaration.type)) {
        result.topLevelDeclarations += 1;
        result.runtimeDeclarations += 1;
      } else if (/^(?:TSInterface|TSTypeAlias|TSEnum|TSModule)Declaration$/.test(declaration.type)) {
        result.topLevelDeclarations += 1;
        result.typeDeclarations += 1;
      }
    }
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error);
  }
  return result;
}

function rustProductionSource(source) {
  const testModule = source.search(/\n#\[cfg\(test\)\]\s*\n(?:pub\([^)]*\)\s+)?mod\s+tests\s*\{/);
  return testModule < 0 ? source : source.slice(0, testModule);
}

function rustStructure(source) {
  const production = rustProductionSource(source);
  const declarationPattern = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|type|const|static|mod)\s+[A-Za-z_][A-Za-z0-9_]*|^impl(?:<[^\n>]*>)?\s+/gm;
  const declarations = [...production.matchAll(declarationPattern)];
  const importSpecifiers = [...production.matchAll(/^use\s+([^;]+);/gm)]
    .map((match) => match[1].trim());
  return {
    importSpecifiers,
    parseError: null,
    runtimeDeclarations: declarations.filter((match) => !/\b(?:type|trait)\b/.test(match[0])).length,
    topLevelDeclarations: declarations.length,
    typeDeclarations: declarations.filter((match) => /\b(?:struct|enum|trait|type)\b/.test(match[0])).length,
  };
}

function genericStructure(source) {
  const declarations = [...source.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|class|def)\s+[A-Za-z_][A-Za-z0-9_]*/gm)];
  return {
    importSpecifiers: [],
    parseError: null,
    runtimeDeclarations: declarations.length,
    topLevelDeclarations: declarations.length,
    typeDeclarations: 0,
  };
}

function responsibilitySignals(source, extension) {
  const signalSource = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  return Object.entries(RESPONSIBILITY_PATTERNS)
    .filter(([name]) => name !== "presentation" || extension === ".tsx" || extension === ".jsx")
    .filter(([, pattern]) => pattern.test(signalSource))
    .map(([name]) => name)
    .sort();
}

function riskScore({ importSpecifiers, loc, responsibilities, thresholds, topLevelDeclarations }) {
  let score = 0;
  if (loc > thresholds.review) score += 1;
  if (loc > thresholds.review * 2) score += 1;
  if (loc > thresholds.strong) score += 2;
  if (responsibilities.length >= 3) score += responsibilities.length - 2;
  if (topLevelDeclarations >= 12) score += 1;
  if (topLevelDeclarations >= 24) score += 1;
  if (importSpecifiers.length >= 20) score += 1;
  return score;
}

export function measureModule(record) {
  const lines = lineMetrics(record.source);
  let structure;
  if (JAVASCRIPT_EXTENSIONS.has(record.extension)) {
    structure = javascriptStructure(record.source, record.extension);
  } else if (record.extension === ".rs") {
    structure = rustStructure(record.source);
  } else {
    structure = genericStructure(record.source);
  }
  const thresholds = CATEGORY_THRESHOLDS[record.category];
  const responsibilities = responsibilitySignals(record.source, record.extension);
  const declarativeRatio = structure.topLevelDeclarations === 0
    ? 0
    : structure.typeDeclarations / structure.topLevelDeclarations;
  return {
    ...record,
    ...lines,
    ...structure,
    declarativeRatio,
    directory: path.posix.dirname(record.relativePath),
    localImportCount: structure.importSpecifiers.filter((specifier) => specifier.startsWith(".")).length,
    responsibilities,
    reviewThreshold: thresholds.review,
    riskScore: riskScore({
      ...lines,
      ...structure,
      responsibilities,
      thresholds,
    }),
    strongThreshold: thresholds.strong,
  };
}
