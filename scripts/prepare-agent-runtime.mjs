import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_DIST_ORIGIN = "https://nodejs.org";
const PINNED_NODE_RUNTIME_VERSION = "24.19.0";
const PINNED_NODE_DIST_SOURCE =
  `${NODE_DIST_ORIGIN}/dist/v${PINNED_NODE_RUNTIME_VERSION}/`;
const PINNED_NODE_LAYOUTS = {
  "aarch64-apple-darwin": {
    archive: `node-v${PINNED_NODE_RUNTIME_VERSION}-darwin-arm64.tar.gz`,
    executable: `node-v${PINNED_NODE_RUNTIME_VERSION}-darwin-arm64/bin/node`,
    licenseFile: `node-v${PINNED_NODE_RUNTIME_VERSION}-darwin-arm64/LICENSE`,
  },
  "x86_64-apple-darwin": {
    archive: `node-v${PINNED_NODE_RUNTIME_VERSION}-darwin-x64.tar.gz`,
    executable: `node-v${PINNED_NODE_RUNTIME_VERSION}-darwin-x64/bin/node`,
    licenseFile: `node-v${PINNED_NODE_RUNTIME_VERSION}-darwin-x64/LICENSE`,
  },
  "x86_64-pc-windows-msvc": {
    archive: `node-v${PINNED_NODE_RUNTIME_VERSION}-win-x64.zip`,
    executable: `node-v${PINNED_NODE_RUNTIME_VERSION}-win-x64/node.exe`,
    licenseFile: `node-v${PINNED_NODE_RUNTIME_VERSION}-win-x64/LICENSE`,
  },
};
const catalogPath = join(
  repositoryRoot,
  "src-tauri/resources/agent-runtime/runtime-catalog.json",
);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const checkOnly = process.argv.includes("--check-config");
const requestedTarget = valueAfter("--target") ?? process.env.TAURI_ENV_TARGET_TRIPLE;

validateCatalog(catalog);
if (checkOnly) {
  process.stdout.write(
    `verified Node ${catalog.version} runtime catalog for ${Object.keys(catalog.platforms).length} platforms\n`,
  );
  process.exit(0);
}

const targetTriple = requestedTarget ?? rustHostTriple();
const platform = catalog.platforms[targetTriple];
if (!platform) {
  throw new Error(`bundled Node runtime is not available for target ${targetTriple}`);
}

const targetRoot = resolve(repositoryRoot, process.env.CARGO_TARGET_DIR ?? "target");
const cacheDirectory = join(targetRoot, "agent-runtime", `node-v${catalog.version}`);
const archivePath = join(cacheDirectory, platform.archive);
const nodeResourceRoot = join(
  repositoryRoot,
  "src-tauri/resources/agent-runtime/node",
);
const outputDirectory = join(nodeResourceRoot, targetTriple);
const executableName = targetTriple.includes("windows") ? "node.exe" : "node";
const outputExecutable = join(outputDirectory, executableName);
const outputManifest = join(outputDirectory, "manifest.json");

// A developer may cross-build more than one target in the same checkout. Keep
// only the requested generated runtime so a later local bundle cannot silently
// include every cached platform executable.
for (const catalogTarget of Object.keys(catalog.platforms)) {
  if (catalogTarget !== targetTriple) {
    rmSync(join(nodeResourceRoot, catalogTarget), { recursive: true, force: true });
  }
}

if (preparedRuntimeIsCurrent(outputExecutable, outputManifest, platform)) {
  process.stdout.write(`verified bundled Node ${catalog.version} for ${targetTriple}\n`);
  process.exit(0);
}

mkdirSync(cacheDirectory, { recursive: true });
if (!existsSync(archivePath) || sha256File(archivePath) !== platform.archiveSha256) {
  const temporaryArchive = join(
    cacheDirectory,
    `.${basename(platform.archive)}.${process.pid}.download`,
  );
  rmSync(temporaryArchive, { force: true });
  try {
    const response = await fetch(nodeRuntimeDownloadUrl(targetTriple), {
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      throw new Error(`Node runtime download failed with HTTP ${response.status}`);
    }
    const verifiedArchive = await readPinnedArchive(
      response,
      platform.archiveBytes,
      platform.archiveSha256,
    );
    writeFileSync(temporaryArchive, verifiedArchive, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryArchive, archivePath);
  } finally {
    rmSync(temporaryArchive, { force: true });
  }
}
assertDigest(archivePath, platform.archiveSha256, "cached Node runtime archive");

const extractionRoot = mkdtempSync(join(tmpdir(), "dopedb-node-runtime-"));
const stagingDirectory = `${outputDirectory}.staging-${process.pid}`;
try {
  const tarExecutable = process.platform === "win32"
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
  execFileSync(
    tarExecutable,
    [
      "-xf",
      archivePath,
      "-C",
      extractionRoot,
      platform.executable,
      platform.licenseFile,
    ],
    { stdio: "inherit" },
  );
  const extractedExecutable = join(extractionRoot, platform.executable);
  const extractedLicense = join(extractionRoot, platform.licenseFile);
  if (!statSync(extractedExecutable).isFile() || !statSync(extractedLicense).isFile()) {
    throw new Error("Node runtime archive did not contain the pinned executable and license");
  }

  rmSync(stagingDirectory, { recursive: true, force: true });
  mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });
  const stagedExecutable = join(stagingDirectory, executableName);
  copyFileSync(extractedExecutable, stagedExecutable);
  chmodSync(stagedExecutable, targetTriple.includes("windows") ? 0o600 : 0o700);
  copyFileSync(extractedLicense, join(stagingDirectory, "LICENSE.txt"));

  const executableSha256 = sha256File(stagedExecutable);
  const executableBytes = statSync(stagedExecutable).size;
  const sbom = createSpdxSbom({
    targetTriple,
    executableName,
    executableSha256,
    executableBytes,
  });
  const sbomJson = `${JSON.stringify(sbom, null, 2)}\n`;
  writeFileSync(join(stagingDirectory, "sbom.spdx.json"), sbomJson);
  const sbomSha256 = sha256Bytes(sbomJson);
  const manifest = {
    schemaVersion: 1,
    runtime: catalog.runtime,
    version: catalog.version,
    releaseLine: catalog.releaseLine,
    targetTriple,
    executable: executableName,
    executableSha256,
    executableBytes,
    archive: platform.archive,
    archiveSha256: platform.archiveSha256,
    sourceUrl: nodeRuntimeDownloadUrl(targetTriple),
    license: catalog.license,
    licenseFile: "LICENSE.txt",
    sbomFile: "sbom.spdx.json",
    sbomSha256,
  };
  writeFileSync(
    join(stagingDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(dirname(outputDirectory), { recursive: true });
  renameSync(stagingDirectory, outputDirectory);
  process.stdout.write(`prepared bundled Node ${catalog.version} for ${targetTriple}\n`);
} finally {
  rmSync(extractionRoot, { recursive: true, force: true });
  rmSync(stagingDirectory, { recursive: true, force: true });
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function rustHostTriple() {
  const version = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = version.match(/^host:\s+(.+)$/m)?.[1];
  if (!host) throw new Error("could not determine the Rust host target triple");
  return host;
}

function validateCatalog(value) {
  let source;
  try {
    source = new URL(String(value?.source));
  } catch {
    throw new Error("invalid Node runtime catalog source");
  }
  if (
    value?.schemaVersion !== 1 ||
    value.runtime !== "node" ||
    value.version !== PINNED_NODE_RUNTIME_VERSION ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.releasedAt) ||
    value.license !== "MIT" ||
    source.href !== PINNED_NODE_DIST_SOURCE ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    !value.platforms ||
    typeof value.platforms !== "object"
  ) {
    throw new Error("invalid Node runtime catalog header");
  }
  const requiredTargets = Object.keys(PINNED_NODE_LAYOUTS);
  if (Object.keys(value.platforms).sort().join("\n") !== requiredTargets.sort().join("\n")) {
    throw new Error("Node runtime catalog must contain exactly the supported release targets");
  }
  for (const [target, platform] of Object.entries(value.platforms)) {
    const expected = PINNED_NODE_LAYOUTS[target];
    if (
      !platform ||
      typeof platform !== "object" ||
      !expected ||
      platform.archive !== expected.archive ||
      !/^[a-f0-9]{64}$/.test(platform.archiveSha256) ||
      !Number.isSafeInteger(platform.archiveBytes) ||
      platform.archiveBytes <= 0 ||
      platform.archiveBytes > 60 * 1024 * 1024 ||
      platform.executable !== expected.executable ||
      platform.licenseFile !== expected.licenseFile
    ) {
      throw new Error(`invalid Node runtime catalog entry for ${target}`);
    }
  }
}

function nodeRuntimeDownloadUrl(targetTriple) {
  switch (targetTriple) {
    case "aarch64-apple-darwin":
      return "https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz";
    case "x86_64-apple-darwin":
      return "https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-x64.tar.gz";
    case "x86_64-pc-windows-msvc":
      return "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip";
    default:
      throw new Error(`bundled Node runtime is not available for target ${targetTriple}`);
  }
}

async function readPinnedArchive(response, expectedBytes, expectedSha256) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedBytes)
  ) {
    throw new Error("Node runtime response did not match its pinned byte length");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > expectedBytes) {
      await reader.cancel();
      throw new Error("Node runtime response exceeded its pinned byte length");
    }
    chunks.push(Buffer.from(value));
  }
  if (received !== expectedBytes) {
    throw new Error(
      `Node runtime archive size mismatch: ${received} != ${expectedBytes}`,
    );
  }
  const archive = Buffer.concat(chunks, received);
  const actualSha256 = sha256Bytes(archive);
  if (actualSha256 !== expectedSha256) {
    throw new Error("Node runtime archive checksum mismatch");
  }
  return archive;
}

function preparedRuntimeIsCurrent(executable, manifestPath, platform) {
  if (!existsSync(executable) || !existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return (
      manifest.schemaVersion === 1 &&
      manifest.version === catalog.version &&
      manifest.archiveSha256 === platform.archiveSha256 &&
      manifest.executableSha256 === sha256File(executable) &&
      existsSync(join(dirname(manifestPath), manifest.licenseFile)) &&
      existsSync(join(dirname(manifestPath), manifest.sbomFile)) &&
      manifest.sbomSha256 ===
        sha256File(join(dirname(manifestPath), manifest.sbomFile))
    );
  } catch {
    return false;
  }
}

function assertDigest(path, expected, label) {
  const actual = sha256File(path);
  if (actual !== expected) {
    throw new Error(`${label} checksum mismatch: ${actual} != ${expected}`);
  }
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createSpdxSbom({
  targetTriple,
  executableName,
  executableSha256,
  executableBytes,
}) {
  const namespaceDigest = sha256Bytes(
    `${catalog.version}:${targetTriple}:${executableSha256}`,
  );
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `DopeDB bundled Node runtime ${catalog.version} (${targetTriple})`,
    documentNamespace: `https://dopedb.dev/sbom/agent-runtime/${namespaceDigest}`,
    creationInfo: {
      created: catalog.releasedAt,
      creators: ["Organization: DopeDB", "Tool: scripts/prepare-agent-runtime.mjs"],
    },
    packages: [
      {
        name: "Node.js",
        SPDXID: "SPDXRef-Package-Nodejs",
        versionInfo: catalog.version,
        downloadLocation: PINNED_NODE_DIST_SOURCE,
        filesAnalyzed: true,
        licenseConcluded: "MIT",
        licenseDeclared: "MIT",
        copyrightText: "See bundled LICENSE.txt",
        externalRefs: [
          {
            referenceCategory: "PACKAGE-MANAGER",
            referenceType: "purl",
            referenceLocator: `pkg:generic/nodejs@${catalog.version}?arch=${encodeURIComponent(targetTriple)}`,
          },
        ],
      },
    ],
    files: [
      {
        fileName: `./${executableName}`,
        SPDXID: "SPDXRef-File-NodeExecutable",
        checksums: [{ algorithm: "SHA256", checksumValue: executableSha256 }],
        licenseConcluded: "MIT",
        copyrightText: "See bundled LICENSE.txt",
        comment: `${executableBytes} bytes`,
      },
    ],
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: "SPDXRef-Package-Nodejs",
      },
      {
        spdxElementId: "SPDXRef-Package-Nodejs",
        relationshipType: "CONTAINS",
        relatedSpdxElement: "SPDXRef-File-NodeExecutable",
      },
    ],
  };
}
