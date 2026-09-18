import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "src");
const diagnostics = [];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return [path];
    }),
  );
  return nested.flat();
}

const files = (await sourceFiles(sourceRoot)).filter((file) =>
  [".css", ".ts", ".tsx"].includes(extname(file)),
);
const documents = new Map(
  await Promise.all(
    files.map(async (file) => [
      relative(root, file).split(sep).join("/"),
      await readFile(file, "utf8"),
    ]),
  ),
);

const scopedContracts = [
  {
    prefix: "--ds-terminal-",
    owners: new Set([
      "src/design-system/scoped-palettes.css",
      "src/features/terminals/ptyTheme.ts",
    ]),
  },
  {
    prefix: "--ds-syntax-",
    owners: new Set([
      "src/design-system/scoped-palettes.css",
      "src/design-system/agentSyntax.ts",
    ]),
  },
];

for (const contract of scopedContracts) {
  for (const [file, source] of documents) {
    if (source.includes(contract.prefix) && !contract.owners.has(file)) {
      diagnostics.push(
        `${contract.prefix} escaped its closed consumer boundary in ${file}`,
      );
    }
  }
}

const coreTokens = documents.get("src/design-system/tokens.css") ?? "";
for (const { prefix } of scopedContracts) {
  if (coreTokens.includes(prefix)) {
    diagnostics.push(`${prefix} must not be defined in core tokens.css`);
  }
}

const scopedPalette =
  documents.get("src/design-system/scoped-palettes.css") ?? "";
const scopedDefinitions = [
  ...scopedPalette.matchAll(/(--ds-[a-z0-9-]+)\s*:/g),
].map((match) => match[1]);
for (const token of scopedDefinitions) {
  if (!scopedContracts.some(({ prefix }) => token.startsWith(prefix))) {
    diagnostics.push(
      `${token} is not a chart, terminal, or syntax role in scoped-palettes.css`,
    );
  }
}

const rawColorPattern = /#[0-9a-f]{3,8}\b|\brgba?\s*\(/i;
const rawColorOwners = new Set([
  "src/design-system/scoped-palettes.css",
  "src/design-system/tokens.css",
  "src/design-system/workspace.css",
  "src/design-system/artifactPalettes.ts",
]);
for (const [file, source] of documents) {
  if (!file.endsWith(".tsx") && !file.endsWith(".css")) continue;
  if (rawColorOwners.has(file)) continue;
  if (rawColorPattern.test(source)) {
    diagnostics.push(`raw UI color found outside a palette owner: ${file}`);
  }
}

const artifactPaletteConsumers = [...documents.entries()]
  .filter(([, source]) => source.includes("ERD_EXPORT_PALETTE"))
  .map(([file]) => file)
  .sort();
const expectedArtifactConsumers = [
  "src/design-system/artifactPalettes.ts",
  "src/lib/erdExport.ts",
];
if (
  artifactPaletteConsumers.length !== expectedArtifactConsumers.length ||
  artifactPaletteConsumers.some(
    (file, index) => file !== expectedArtifactConsumers[index],
  )
) {
  diagnostics.push(
    `ERD export palette boundary changed: ${artifactPaletteConsumers.join(", ")}`,
  );
}

if (diagnostics.length > 0) {
  console.error("UI palette contract failed:\n");
  for (const diagnostic of diagnostics) console.error(`- ${diagnostic}`);
  process.exit(1);
}

console.log(
  `UI palette contract ok: ${scopedDefinitions.length} scoped CSS roles, ${artifactPaletteConsumers.length - 1} artifact consumer`,
);
