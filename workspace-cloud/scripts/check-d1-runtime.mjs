// Deployment gate for PostgreSQL control-plane SQL that D1 cannot execute.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = fileURLToPath(new URL("../", import.meta.url));
const unsupported = /\bworkspace_control\b|\b(?:pg_advisory\w*|hashtextextended|jsonb_\w+|gen_random_uuid|clock_timestamp|now|to_char|octet_length|generate_series|jsonb_strip_nulls)\s*\(|::\s*[a-zA-Z_][a-zA-Z0-9_]*\b|\bFOR\s+(?:UPDATE|SHARE)\b|\bSKIP\s+LOCKED\b|\bINTERVAL\s*'|\bILIKE\b|\b(?:ANY|ALL)\s*\(|\bAS\s*(?:MATERIALIZED\s*)?\(\s*(?:INSERT|UPDATE|DELETE)\b/i;

async function inspect(directory) {
  const findings = [];
  for (const entry of await readdir(`${root}${directory}`, { withFileTypes: true })) {
    if (entry.name.includes("harness") || entry.name.includes(".test.")) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      findings.push(...await inspect(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      const text = await readFile(`${root}${path}`, "utf8");
      const source = parse(text, { sourceType: "module", plugins: ["typescript", "jsx"] });
      function visit(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "TaggedTemplateExpression" && node.tag.type === "Identifier" && node.tag.name === "sql") {
          const sql = node.quasi.quasis.map((part) => part.value.cooked ?? part.value.raw).join(" ? ");
          if (unsupported.test(sql.replace(/--[^\n]*/g, ""))) {
            findings.push(`${path}:${node.loc.start.line}`);
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === "object" && "type" in value) visit(value);
        }
      }
      visit(source);
    }
  }
  return findings;
}

const db = await readFile(`${root}lib/db.ts`, "utf8");
const findings = [...await inspect("app"), ...await inspect("lib")];
if (/neon-http|@neondatabase\/serverless|databaseUrl/.test(db)) findings.unshift("lib/db.ts: legacy runtime driver");
if (findings.length) {
  console.error(`D1 runtime migration is incomplete (${findings.length} PostgreSQL SQL fragments). Deployment stopped.`);
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("D1 runtime SQL preflight passed.");
}
