import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_DIST_ORIGIN = "https://nodejs.org";
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
    // validateCatalog pins the HTTPS origin and exact per-target filename.
    // codeql[js/file-access-to-http]
    const response = await fetch(new URL(platform.archive, catalog.source), {
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      throw new Error(`Node runtime download failed with HTTP ${response.status}`);
    }
    const file = openSync(temporaryArchive, "wx", 0o600);
    let written = 0;
    try {
      for await (const chunk of response.body) {
        written += chunk.byteLength;
        if (written > platform.archiveBytes) {
          throw new Error("Node runtime response exceeded its pinned byte length");
        }
        let offset = 0;
        while (offset < chunk.byteLength) {
          // Length and SHA-256 are pinned before this temporary file is promoted.
          // codeql[js/http-to-file-access]
          offset += writeSync(file, chunk, offset);
        }
      }
    } finally {
      closeSync(file);
    }
    if (written !== platform.archiveBytes) {
      throw new Error(
        `Node runtime archive size mismatch: ${written} != ${platform.archiveBytes}`,
      );
    }
    assertDigest(temporaryArchive, platform.archiveSha256, "Node runtime archive");
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
    sourceUrl: new URL(platform.archive, catalog.source).href,
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
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.releasedAt) ||
    value.license !== "MIT" ||
    source.origin !== NODE_DIST_ORIGIN ||
    source.pathname !== `/dist/v${value.version}/` ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    !value.platforms ||
    typeof value.platforms !== "object"
  ) {
    throw new Error("invalid Node runtime catalog header");
  }
  const requiredTargets = [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
  ];
  if (Object.keys(value.platforms).sort().join("\n") !== requiredTargets.sort().join("\n")) {
    throw new Error("Node runtime catalog must contain exactly the supported release targets");
  }
  const expectedLayouts = {
    "aarch64-apple-darwin": {
      archive: `node-v${value.version}-darwin-arm64.tar.gz`,
      executable: `node-v${value.version}-darwin-arm64/bin/node`,
      licenseFile: `node-v${value.version}-darwin-arm64/LICENSE`,
    },
    "x86_64-apple-darwin": {
      archive: `node-v${value.version}-darwin-x64.tar.gz`,
      executable: `node-v${value.version}-darwin-x64/bin/node`,
      licenseFile: `node-v${value.version}-darwin-x64/LICENSE`,
    },
    "x86_64-pc-windows-msvc": {
      archive: `node-v${value.version}-win-x64.zip`,
      executable: `node-v${value.version}-win-x64/node.exe`,
      licenseFile: `node-v${value.version}-win-x64/LICENSE`,
    },
  };
  for (const [target, platform] of Object.entries(value.platforms)) {
    const expected = expectedLayouts[target];
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
        downloadLocation: catalog.source,
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
