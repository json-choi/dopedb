import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";

const root = process.cwd();
const sourceRoots = ["src", "workspace-cloud/app", "site/app"].map((directory) =>
  path.join(root, directory),
);
const failures = [];
let canonicalIconButtons = 0;
let canonicalConfirmIconButtons = 0;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolute);
      return entry.isFile() && entry.name.endsWith(".tsx") ? [absolute] : [];
    }),
  );
  return nested.flat();
}

function attribute(attributes, name) {
  return attributes.find(
    (property) =>
      property.type === "JSXAttribute" && property.name.name === name,
  );
}

function staticString(attributeNode) {
  if (!attributeNode || attributeNode.type !== "JSXAttribute") return null;
  if (attributeNode.value?.type === "StringLiteral") {
    return attributeNode.value.value;
  }
  return null;
}

function location(file, node) {
  return `${path.relative(root, file)}:${node.loc?.start.line ?? 1}`;
}

function inspectElement(file, opening) {
  if (opening.name.type !== "JSXIdentifier") return;
  const tag = opening.name.name;
  const attributes = opening.attributes;

  if (["input", "select", "textarea"].includes(tag)) {
    const className = staticString(attribute(attributes, "className"));
    const density = className?.match(/(?:^|\s)tw:h-control-(xs|sm|md|lg)(?:\s|$)/)?.[1];
    if (
      density &&
      !className?.split(/\s+/).includes(`tw:min-h-control-${density}`) &&
      !className?.split(/\s+/).includes("tw:min-h-0")
    ) {
      failures.push(
        `${location(file, opening)} ${tag} with h-control-${density} needs matching min height or an explicit min-h-0 escape`,
      );
    }
  }

  if (tag === "button") {
    const className = staticString(attribute(attributes, "className"));
    if (className?.split(/\s+/).includes("icon-only")) {
      failures.push(
        `${location(file, opening)} raw icon-only button bypasses Button/Tooltip`,
      );
    }
    return;
  }

  if (tag !== "Button" && tag !== "ConfirmButton") return;
  const iconOnly = attribute(attributes, "iconOnly");
  if (!iconOnly || iconOnly.type !== "JSXAttribute" || iconOnly.value) return;
  const requiredNames =
    tag === "ConfirmButton" ? ["label"] : ["title", "aria-label"];
  const accessibleNames = requiredNames
    .map((name) => attribute(attributes, name))
    .filter(Boolean);
  if (tag === "ConfirmButton") canonicalConfirmIconButtons += 1;
  else canonicalIconButtons += 1;
  if (accessibleNames.length === 0) {
    failures.push(
      `${location(file, opening)} iconOnly ${tag} needs ${requiredNames.join(" or ")}`,
    );
    return;
  }
  if (accessibleNames.some((name) => staticString(name)?.trim() === "")) {
    failures.push(`${location(file, opening)} iconOnly ${tag} name is empty`);
  }
}

function visit(file, node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "JSXOpeningElement") inspectElement(file, node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end", "extra"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) visit(file, child);
    } else {
      visit(file, value);
    }
  }
}

for (const file of (await Promise.all(sourceRoots.map(sourceFiles))).flat()) {
  const source = await readFile(file, "utf8");
  const parsed = parse(source, {
    sourceFilename: file,
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  visit(file, parsed.program);
}

if (failures.length > 0) {
  console.error("UI primitive ownership check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `UI primitive ownership ok: ${canonicalIconButtons} Button and ${canonicalConfirmIconButtons} ConfirmButton icon actions are statically named`,
);
