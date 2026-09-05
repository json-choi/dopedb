import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const repository = resolve(import.meta.dirname, "../..");
const catalogPath = join(repository, "agent-runtime/plugins/catalog.json");
const pinsPath = join(repository, "agent-runtime/plugins/package.json");
const runtimeCatalogPath = join(repository, "src-tauri/resources/agent-runtime/runtime-catalog.json");
const acpPublicKeyPath = join(
  repository,
  "src-tauri/resources/agent-runtime/acp-plugin.pub",
);
const tauriConfigPath = join(repository, "src-tauri/tauri.conf.json");
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_PACKED_BYTES = 30 * 1024 * 1024;

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1] ?? "");
}
const checkOnly = process.argv.includes("--check-config");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const pins = JSON.parse(await readFile(pinsPath, "utf8"));
const runtimeCatalog = JSON.parse(await readFile(runtimeCatalogPath, "utf8"));
validateCatalog(catalog, pins, runtimeCatalog);
await validateSigningPublicKey(catalog);
if (checkOnly) {
  console.log(`verified ${catalog.plugins.length} pinned ACP adapter bundles`);
  process.exit(0);
}

const provider = args.get("--plugin");
const output = args.get("--output");
if (!provider || !output) fail("usage: --plugin <claude|codex> --output <directory>");
const plugin = catalog.plugins.find((candidate) => candidate.provider === provider);
if (!plugin) fail(`unknown ACP plugin provider: ${provider}`);
const outputRoot = resolve(output);
const payload = join(outputRoot, "payload");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(payload, { recursive: true, mode: 0o700 });
const temporary = await mkdtemp(join(tmpdir(), `dopedb-acp-${provider}-`));
try {
  if (plugin.installMode === "production-tree") {
    await writeFile(
      join(payload, "package.json"),
      `${JSON.stringify({ private: true, type: "module", dependencies: { [plugin.npmPackage]: plugin.adapterVersion } }, null, 2)}\n`,
    );
    await run("npm", [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ], payload);
    await rm(join(payload, "node_modules/.bin"), { recursive: true, force: true });
    const anthropicScope = join(payload, "node_modules/@anthropic-ai");
    for (const entry of await readdir(anthropicScope, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("claude-agent-sdk-")) {
        await rm(join(anthropicScope, entry.name), { recursive: true, force: true });
      }
    }
  } else if (plugin.installMode === "packed-bundle") {
    const packed = JSON.parse(await capture("npm", [
      "pack",
      `${plugin.npmPackage}@${plugin.adapterVersion}`,
      "--json",
      "--pack-destination",
      temporary,
    ], temporary));
    if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0].filename !== "string") {
      fail("npm returned an invalid ACP adapter pack receipt");
    }
    const unpack = join(temporary, "unpack");
    await mkdir(unpack);
    await run("tar", ["-xzf", join(temporary, packed[0].filename), "-C", unpack], temporary);
    await cp(join(unpack, "package"), join(payload, "adapter"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  } else {
    fail(`unsupported install mode: ${plugin.installMode}`);
  }

  await assertNoProviderNativeBinary(payload);
  const packageInventory = await collectPackages(payload);
  const sbom = buildSbom(plugin, packageInventory);
  await writeFile(join(payload, "sbom.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
  const inventory = await inventoryTree(payload);
  if (!inventory.some((file) => file.path === plugin.entrypoint)) {
    fail(`adapter entrypoint is missing: ${plugin.entrypoint}`);
  }
  if (!inventory.some((file) => file.path === plugin.licensePath)) {
    fail(`adapter license is missing: ${plugin.licensePath}`);
  }
  const sbomEntry = inventory.find((file) => file.path === "sbom.spdx.json");
  const contentSha256 = contentDigest(inventory);
  const artifact = join(outputRoot, `${provider}.tar.gz`);
  const reproducibleTar = process.platform === "linux" ? [
    "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
  ] : [];
  await run("tar", [
    ...reproducibleTar,
    "-czf",
    artifact,
    "-C",
    payload,
    ...inventory.map((file) => file.path),
  ], repository);
  const artifactStat = await stat(artifact);
  if (artifactStat.size === 0 || artifactStat.size > MAX_PACKED_BYTES) {
    fail(`ACP artifact exceeds ${MAX_PACKED_BYTES} packed bytes`);
  }
  const metadata = {
    schemaVersion: 2,
    keyId: catalog.keyId,
    plugin,
    compatibility: {
      acpProtocolMin: catalog.acpProtocol,
      acpProtocolMax: catalog.acpProtocol,
      nodeVersionMin: catalog.nodeVersionMin,
      nodeVersionMax: catalog.nodeVersionMax,
      runtimeContractVersion: catalog.runtimeContractVersion,
    },
    artifact: {
      path: artifact,
      sha256: await sha256File(artifact),
      packedBytes: artifactStat.size,
      unpackedBytes: inventory.reduce((total, file) => total + file.bytes, 0),
    },
    licenses: [{ name: plugin.licenseName, path: plugin.licensePath }],
    sbomSha256: sbomEntry.sha256,
    contentSha256,
    largestFiles: [...inventory]
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 10),
  };
  await writeFile(join(outputRoot, "build-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`${provider}: ${artifactStat.size} packed / ${metadata.artifact.unpackedBytes} unpacked bytes`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function validateCatalog(value, pinPackage, runtimeCatalog) {
  if (value.schemaVersion !== 2 || value.keyId !== "71F10E6488C84C71" || value.plugins?.length !== 2) {
    fail("invalid ACP plugin catalog header");
  }
  if (value.runtimeContractVersion !== 1 || value.acpProtocol !== "2025-11-25"
      || "dopedbVersionMin" in value || "dopedbVersionMax" in value) {
    fail("invalid ACP host contract; compatibility must not depend on the app release number");
  }
  const nodeVersion = parseReleaseVersion(runtimeCatalog.version, "bundled Node");
  const minimumVersion = parseReleaseVersion(value.nodeVersionMin, "minimum Node compatibility");
  const maximumVersion = parseReleaseVersion(value.nodeVersionMax, "maximum Node compatibility");
  if (compareVersions(minimumVersion, maximumVersion) > 0) {
    fail("invalid Node compatibility range");
  }
  if (
    compareVersions(nodeVersion, minimumVersion) < 0
    || compareVersions(nodeVersion, maximumVersion) > 0
  ) {
    fail(`ACP plugin catalog does not support bundled Node ${runtimeCatalog.version}`);
  }
  const ids = new Set();
  for (const plugin of value.plugins) {
    if (!/^dopedb\.acp\.(claude|codex)$/.test(plugin.id) || ids.has(plugin.id)) fail("invalid duplicate ACP plugin ID");
    ids.add(plugin.id);
    if (pinPackage.dependencies?.[plugin.npmPackage] !== plugin.adapterVersion) fail(`package pin differs for ${plugin.provider}`);
    if (plugin.upstreamRepository !== `https://github.com/agentclientprotocol/${plugin.provider === "claude" ? "claude-agent-acp" : "codex-acp"}`) fail("unexpected upstream repository");
    if (plugin.upstreamTag !== `v${plugin.adapterVersion}` || !/^[0-9a-f]{40}$/.test(plugin.upstreamCommit)) fail("invalid upstream pin");
    if (!/^\d+\.\d+\.\d+$/.test(plugin.adapterBundleVersion)) fail("invalid adapter bundle version");
  }
}

function parseReleaseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (!match) fail(`${label} version is invalid`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

async function validateSigningPublicKey(value) {
  const normalizePublicKey = (key) => key.replace(/\r\n?/gu, "\n").trimEnd();
  const acpPublicKey = normalizePublicKey(
    await readFile(acpPublicKeyPath, "utf8"),
  );
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
  const encodedUpdaterPublicKey = tauriConfig.plugins?.updater?.pubkey;
  if (typeof encodedUpdaterPublicKey !== "string" || !encodedUpdaterPublicKey) {
    fail("the Tauri updater public key is missing");
  }
  const updaterPublicKey = normalizePublicKey(
    Buffer.from(encodedUpdaterPublicKey, "base64").toString("utf8"),
  );
  if (acpPublicKey !== updaterPublicKey) {
    fail("the ACP plugin and protected updater signing public keys differ");
  }
  if (!acpPublicKey.split(/\r?\n/u)[0]?.endsWith(value.keyId)) {
    fail("the ACP plugin signing key ID differs from the catalog");
  }
}

async function inventoryTree(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const link = await lstat(path);
      if (link.isSymbolicLink()) fail(`symbolic links are forbidden: ${relative(root, path)}`);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        if (link.size > MAX_FILE_BYTES) fail(`invalid ACP plugin file size: ${relative(root, path)}`);
        files.push({ path: normalize(relative(root, path)), bytes: link.size, sha256: await sha256File(path) });
      } else {
        fail(`unsupported ACP plugin file: ${relative(root, path)}`);
      }
      if (files.length > MAX_FILES) fail(`ACP plugin exceeds ${MAX_FILES} files`);
    }
  }
  await visit(root);
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const unpacked = files.reduce((total, file) => total + file.bytes, 0);
  if (unpacked > MAX_UNPACKED_BYTES) fail(`ACP plugin exceeds ${MAX_UNPACKED_BYTES} unpacked bytes`);
  return files;
}

async function assertNoProviderNativeBinary(root) {
  const files = await inventoryTree(root);
  for (const file of files) {
    const name = basename(file.path).toLowerCase();
    if (["claude", "claude.exe", "codex", "codex.exe"].includes(name)) fail(`provider executable leaked into plugin: ${file.path}`);
    const bytes = await readFile(join(root, ...file.path.split("/")));
    const magic = bytes.subarray(0, 4).toString("hex");
    if (["7f454c46", "cffaedfe", "cefaedfe", "feedfacf", "feedface"].includes(magic) || bytes.subarray(0, 2).toString() === "MZ") {
      fail(`native executable leaked into plugin: ${file.path}`);
    }
    if (file.path.includes("node_modules/@openai/codex")) fail(`Codex package dependency leaked into plugin: ${file.path}`);
  }
}

async function collectPackages(root) {
  const inventory = await inventoryTree(root);
  const packages = [];
  for (const file of inventory.filter((candidate) => candidate.path.endsWith("package.json"))) {
    try {
      const value = JSON.parse(await readFile(join(root, ...file.path.split("/")), "utf8"));
      if (typeof value.name === "string" && typeof value.version === "string") {
        packages.push({ name: value.name, version: value.version, license: typeof value.license === "string" ? value.license : "NOASSERTION" });
      }
    } catch {
      fail(`invalid package metadata: ${file.path}`);
    }
  }
  packages.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en"));
  return packages;
}

function buildSbom(plugin, packages) {
  const spdxPackages = packages.map((item, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: item.name,
    versionInfo: item.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: item.license,
    copyrightText: "NOASSERTION",
  }));
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${plugin.id}-${plugin.adapterBundleVersion}`,
    documentNamespace: `https://dopedb.dev/sbom/acp/${plugin.provider}/${plugin.adapterBundleVersion}`,
    creationInfo: { created: "1970-01-01T00:00:00Z", creators: ["Tool: dopedb-acp-bundler-1"] },
    packages: spdxPackages,
    relationships: spdxPackages.map((item) => ({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: item.SPDXID })),
  };
}

function contentDigest(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    const path = Buffer.from(file.path);
    const pathLength = Buffer.alloc(8);
    pathLength.writeBigUInt64BE(BigInt(path.length));
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64BE(BigInt(file.bytes));
    hash.update(pathLength).update(path).update(bytes).update(Buffer.from(file.sha256, "hex"));
  }
  return hash.digest("hex");
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function normalize(path) {
  return sep === "/" ? path : path.split(sep).join("/");
}

function run(command, commandArgs, cwd) {
  return processCommand(command, commandArgs, cwd, false);
}

function capture(command, commandArgs, cwd) {
  return processCommand(command, commandArgs, cwd, true);
}

function processCommand(command, commandArgs, cwd, captureOutput) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd, stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit" });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.on("error", rejectPromise);
    child.on("exit", (code) => code === 0 ? resolvePromise(captureOutput ? output : undefined) : rejectPromise(new Error(`${command} exited ${code}`)));
  });
}

function fail(message) {
  throw new Error(message);
}
