import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const skillName = "dopedb-cli";
const sourceRoot = path.join(repositoryRoot, "skills", skillName);
const resourceRoot = path.join(repositoryRoot, "src-tauri", "resources", "skills");
const currentManifestPath = path.join(resourceRoot, "current-manifest.json");
const snapshotRegistryPath = path.join(resourceRoot, "snapshot-registry.json");
const releaseMappingPath = path.join(resourceRoot, "release-mapping.json");
const checkOnly = process.argv.includes("--check");

const discoveryStub = `---
name: dopedb-cli
description: Set up or use the direct dopedb CLI outside an existing DopeDB Agent session. Do not load when a session-scoped DopeDB MCP server is already available.
---

When DopeDB supplies a session-scoped MCP server through built-in AI Chat or \`dopedb agent start\`, use its typed tools and do not run the public CLI or fetch this guide.

Outside an approved Agent session, first load the version-matched setup and safety guide:
dopedb skills get dopedb-cli
`;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalizedText(bytes) {
  return bytes
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC");
}

function fileRecord(relativePath, sourcePath, bytes, content) {
  return {
    path: relativePath,
    sourcePath,
    size: bytes.byteLength,
    executable: false,
    sha256: sha256(bytes),
    normalizedTextSha256: sha256(Buffer.from(normalizedText(bytes), "utf8")),
    ...(content === undefined ? {} : { content }),
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function contentDigest(contentManifest) {
  return sha256(Buffer.from(stableJson(contentManifest), "utf8"));
}

function resolveContentRevision(snapshots, packageDigest, snapshotFiles) {
  const digestMatches = snapshots.filter(
    (snapshot) => snapshot.packageDigest === packageDigest,
  );
  if (digestMatches.length > 1) {
    throw new Error(
      `package digest ${packageDigest} names multiple Skill revisions`,
    );
  }
  const reusableSnapshot = digestMatches[0];
  if (
    reusableSnapshot &&
    stableJson(reusableSnapshot.files) !== stableJson(snapshotFiles)
  ) {
    throw new Error(
      `package digest ${packageDigest} names different installed Skill files`,
    );
  }
  return {
    reusableSnapshot,
    releaseRevision:
      reusableSnapshot?.releaseRevision ??
      snapshots.reduce(
        (maximum, snapshot) => Math.max(maximum, snapshot.releaseRevision),
        0,
      ) + 1,
  };
}

// This script is part of every frontend build, so keep the content-versioning
// policy executable without adding another critical-test slot. Each content
// surface must earn exactly one revision, while app metadata must not.
function assertContentRevisionPolicy() {
  const sourceFile = (path, digest) => ({
    path,
    sourcePath: `skills/${skillName}/${path}`,
    size: 1,
    executable: false,
    sha256: digest,
    normalizedTextSha256: digest,
  });
  const installedFile = (digest) => ({
    path: "SKILL.md",
    sourcePath: "generated:discovery-stub",
    size: 1,
    executable: false,
    sha256: digest,
    normalizedTextSha256: digest,
  });
  const digest = (digit) => digit.repeat(64);
  const base = {
    schemaVersion: 1,
    skillName,
    sourcePath: `skills/${skillName}`,
    sourceFiles: [
      sourceFile("SKILL.md", digest("1")),
      sourceFile("references/safety.md", digest("2")),
    ],
    installFiles: [installedFile(digest("3"))],
  };
  const baseFiles = base.installFiles;
  const baseDigest = contentDigest(base);
  const snapshots = [
    {
      releaseRevision: 41,
      packageDigest: baseDigest,
      files: baseFiles,
    },
  ];

  assert.equal(
    resolveContentRevision(snapshots, baseDigest, baseFiles).releaseRevision,
    41,
    "unchanged content must reuse its revision across app releases",
  );

  const variants = [
    {
      ...base,
      sourceFiles: [
        sourceFile("SKILL.md", digest("4")),
        base.sourceFiles[1],
      ],
    },
    {
      ...base,
      sourceFiles: [
        base.sourceFiles[0],
        sourceFile("references/safety.md", digest("5")),
      ],
    },
    {
      ...base,
      installFiles: [installedFile(digest("6"))],
    },
  ];
  for (const variant of variants) {
    const variantFiles = variant.installFiles;
    assert.equal(
      resolveContentRevision(
        snapshots,
        contentDigest(variant),
        variantFiles,
      ).releaseRevision,
      42,
      "one guide, reference, or discovery-stub change must add one revision",
    );
  }

  const second = variants[0];
  const secondDigest = contentDigest(second);
  const afterSecond = snapshots.concat({
    releaseRevision: 42,
    packageDigest: secondDigest,
    files: second.installFiles,
  });
  const third = {
    ...second,
    sourceFiles: [
      second.sourceFiles[0],
      sourceFile("references/safety.md", digest("7")),
    ],
  };
  assert.equal(
    resolveContentRevision(
      afterSecond,
      contentDigest(third),
      third.installFiles,
    ).releaseRevision,
    43,
    "successive content changes must stay monotonic without skipping",
  );
}

function assertVersionsMatch() {
  const packageVersion = readJson(path.join(repositoryRoot, "package.json")).version;
  const tauriVersion = readJson(
    path.join(repositoryRoot, "src-tauri", "tauri.conf.json"),
  ).version;
  const cargo = fs.readFileSync(
    path.join(repositoryRoot, "src-tauri", "Cargo.toml"),
    "utf8",
  );
  const cargoVersion = cargo.match(
    /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
  )?.[1];
  if (!packageVersion || packageVersion !== tauriVersion || packageVersion !== cargoVersion) {
    throw new Error(
      `version mismatch: package=${packageVersion}, tauri=${tauriVersion}, cargo=${cargoVersion}`,
    );
  }
  return packageVersion;
}

function sourceRecords() {
  return [
    "SKILL.md",
    "references/analyses.md",
    "references/documents.md",
    "references/operations.md",
    "references/queries.md",
    "references/safety.md",
  ].map((relativePath) => {
    const bytes = fs.readFileSync(path.join(sourceRoot, relativePath));
    return fileRecord(
      relativePath,
      path.posix.join("skills", skillName, relativePath),
      bytes,
    );
  });
}

function loadRegistry() {
  if (!fs.existsSync(snapshotRegistryPath)) {
    return { schemaVersion: 1, skillName, snapshots: [] };
  }
  const registry = readJson(snapshotRegistryPath);
  if (
    registry.schemaVersion !== 1 ||
    registry.skillName !== skillName ||
    !Array.isArray(registry.snapshots)
  ) {
    throw new Error("snapshot-registry.json has an unsupported shape");
  }
  return registry;
}

function loadReleaseMapping() {
  if (!fs.existsSync(releaseMappingPath)) {
    return { schemaVersion: 1, skillName, releases: [] };
  }
  const mapping = readJson(releaseMappingPath);
  if (
    mapping.schemaVersion !== 1 ||
    mapping.skillName !== skillName ||
    !Array.isArray(mapping.releases)
  ) {
    throw new Error("release-mapping.json has an unsupported shape");
  }
  return mapping;
}

function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeOrCheck(file, value) {
  const expected = serialized(value);
  if (checkOnly) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected) {
      throw new Error(`${path.relative(repositoryRoot, file)} is stale`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, expected, { flag: "wx" });
  fs.renameSync(temporary, file);
}

const appVersion = assertVersionsMatch();
const installBytes = Buffer.from(discoveryStub, "utf8");
const sourceFiles = sourceRecords();
const installFiles = [
  fileRecord(
    "SKILL.md",
    "generated:discovery-stub",
    installBytes,
    discoveryStub,
  ),
];
const contentManifest = {
  schemaVersion: 1,
  skillName,
  sourcePath: path.posix.join("skills", skillName),
  sourceFiles,
  installFiles,
};
// App metadata is deliberately excluded: one exact Skill package can ship with
// many app releases. Only a content change earns a new monotonic revision.
const packageDigest = contentDigest(contentManifest);

const registry = loadRegistry();
const snapshotFiles = installFiles.map(({ content: _content, ...file }) => file);
assertContentRevisionPolicy();
const { reusableSnapshot, releaseRevision } = resolveContentRevision(
  registry.snapshots,
  packageDigest,
  snapshotFiles,
);
const currentManifest = {
  ...contentManifest,
  releaseRevision,
  appVersion,
  packageDigest,
};

const existingSnapshot = registry.snapshots.find(
  (snapshot) => snapshot.releaseRevision === releaseRevision,
);
if (
  existingSnapshot &&
  existingSnapshot.packageDigest !== currentManifest.packageDigest
) {
  throw new Error(
    `release revision ${releaseRevision} already names different bytes; bump releaseRevision`,
  );
}
const currentSnapshot = {
  releaseRevision,
  appVersion,
  packageDigest: currentManifest.packageDigest,
  files: snapshotFiles,
};
const snapshots = (reusableSnapshot
  ? registry.snapshots
  : registry.snapshots.concat(currentSnapshot)
).sort((left, right) => left.releaseRevision - right.releaseRevision);
const snapshotRegistry = { schemaVersion: 1, skillName, snapshots };

const mapping = loadReleaseMapping();
const releases = mapping.releases
  .filter((release) => release.appVersion !== appVersion)
  .concat({
    appVersion,
    releaseRevision,
    packageDigest: currentManifest.packageDigest,
  })
  .sort((left, right) => left.appVersion.localeCompare(right.appVersion));
const releaseMapping = { schemaVersion: 1, skillName, releases };

writeOrCheck(currentManifestPath, currentManifest);
writeOrCheck(snapshotRegistryPath, snapshotRegistry);
writeOrCheck(releaseMappingPath, releaseMapping);

process.stdout.write(
  `${checkOnly ? "verified" : "generated"} ${skillName} content revision ${releaseRevision} for app ${appVersion}\n`,
);
