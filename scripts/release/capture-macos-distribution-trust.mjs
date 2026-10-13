#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";

const MAX_TREE_ENTRIES = 200_000;
const MAX_ARCHIVE_ENTRIES = 200_000;
const TARGETS = {
  "aarch64-apple-darwin": { architecture: "arm64", assetSuffix: "aarch64" },
  "x86_64-apple-darwin": { architecture: "x64", assetSuffix: "x64" },
};

function fail(message) {
  throw new Error(message);
}

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      fail(`invalid argument near ${name ?? "end of input"}`);
    }
    if (parsed.has(name)) fail(`duplicate argument ${name}`);
    parsed.set(name, value);
  }
  const allowed = new Set([
    "--bundle-root",
    "--commit",
    "--config",
    "--output",
    "--tag",
    "--target",
  ]);
  if ([...parsed.keys()].some((name) => !allowed.has(name))) {
    fail("unknown macOS trust capture argument");
  }
  const required = (name) => {
    const value = parsed.get(name);
    if (!value) fail(`missing ${name}`);
    return value;
  };
  return {
    bundleRoot: required("--bundle-root"),
    commit: required("--commit"),
    config: required("--config"),
    output: required("--output"),
    tag: required("--tag"),
    target: required("--target"),
  };
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} has missing or unknown fields`);
  }
}

function distributionConfig(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  exactObject(
    value,
    [
      "schemaVersion",
      "distributionMode",
      "productName",
      "bundleIdentifier",
      "teamIdentifier",
    ],
    "macOS distribution config",
  );
  if (value.schemaVersion !== 2) fail("unsupported macOS distribution config version");
  if (value.distributionMode !== "developer-id") {
    fail("macOS trust capture requires developer-id distribution mode");
  }
  for (const field of ["productName", "bundleIdentifier", "teamIdentifier"]) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      fail(`macOS distribution config ${field} is missing`);
    }
  }
  if (!/^[A-Z0-9]{10}$/.test(value.teamIdentifier)) {
    fail("macOS distribution TeamIdentifier is invalid");
  }
  return value;
}

function command(commandName, args) {
  const maximumAttempts = 5;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const result = spawnSync(commandName, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) fail(`${commandName} failed to start: ${result.error.message}`);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) return output;

    // Ticket validation reads Apple's CloudKit service even after notarization.
    // Retry only its explicit connection-lost error; every trust check still
    // needs a successful native command before a receipt can be written.
    const connectionLost = commandName === "xcrun"
      && args[0] === "stapler"
      && args[1] === "validate"
      && /NSURLErrorDomain\s+Code=-1005\b/.test(output);
    if (!connectionLost || attempt === maximumAttempts) {
      fail(`${commandName} ${args[0] ?? ""} failed: ${output.trim() || `exit ${result.status}`}`);
    }
    const delayMs = attempt * 5_000;
    console.warn(`Apple ticket validation connection lost; retry ${attempt + 1}/${maximumAttempts} in ${delayMs / 1_000}s`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  }
  fail(`${commandName} exhausted its validation attempts`);
}

function oneFile(directory, suffix) {
  const matches = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(directory, entry.name));
  if (matches.length !== 1) {
    fail(`${directory} must contain exactly one ${suffix} file`);
  }
  return matches[0];
}

function assertInside(root, candidate, label) {
  const realRoot = realpathSync(root);
  const realCandidate = realpathSync(candidate);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${sep}`)) {
    fail(`${label} escapes its expected root`);
  }
  return realCandidate;
}

function archiveEntries(archive) {
  const entries = command("tar", ["-tzf", archive])
    .split("\n")
    .filter(Boolean);
  if (entries.length === 0 || entries.length > MAX_ARCHIVE_ENTRIES) {
    fail("updater archive has an invalid entry count");
  }
  for (const entry of entries) {
    const components = entry.replace(/\\/g, "/").split("/");
    if (
      entry.startsWith("/")
      || components.includes("..")
      || /^[A-Za-z]:/.test(entry)
    ) {
      fail("updater archive contains an unsafe path");
    }
  }
}

function findApplication(root, productName) {
  const expected = `${productName}.app`;
  const matches = [];
  let visited = 0;
  const visit = (directory, depth) => {
    if (depth > 6) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      visited += 1;
      if (visited > MAX_TREE_ENTRIES) fail("application search exceeded its entry cap");
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && entry.name === expected) {
        matches.push(path);
        continue;
      }
      if (entry.isDirectory()) visit(path, depth + 1);
    }
  };
  visit(root, 0);
  if (matches.length !== 1) fail(`${root} must contain exactly one ${expected}`);
  return assertInside(root, matches[0], expected);
}

function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function applicationTreeDigest(root) {
  const hash = createHash("sha256");
  const entries = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const metadata = lstatSync(path);
      const relativePath = relative(root, path).split(sep).join("/");
      if (metadata.isDirectory()) {
        entries.push({ kind: "directory", mode: metadata.mode & 0o777, path: relativePath });
        visit(path);
      } else if (metadata.isSymbolicLink()) {
        entries.push({
          kind: "symlink",
          mode: metadata.mode & 0o777,
          path: relativePath,
          target: readlinkSync(path),
        });
      } else if (metadata.isFile()) {
        entries.push({
          kind: "file",
          mode: metadata.mode & 0o777,
          path: relativePath,
          sha256: sha256File(path),
          size: metadata.size,
        });
      } else {
        fail(`application contains unsupported entry ${relativePath}`);
      }
      if (entries.length > MAX_TREE_ENTRIES) fail("application tree exceeded its entry cap");
    }
  };
  visit(root);
  for (const entry of entries) hash.update(`${JSON.stringify(entry)}\n`);
  return `sha256:${hash.digest("hex")}`;
}

function field(output, name) {
  return output
    .split("\n")
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim();
}

function verifyApplication(path, config) {
  command("codesign", ["--verify", "--deep", "--strict", "--verbose=4", path]);
  const details = command("codesign", ["--display", "--verbose=4", path]);
  if (
    details.includes("Signature=adhoc")
    || details.includes("TeamIdentifier=not set")
    || details.includes("Info.plist=not bound")
    || details.includes("Sealed Resources=none")
  ) {
    fail("application has an ad-hoc or incomplete code signature");
  }
  const authorities = details
    .split("\n")
    .filter((line) => line.startsWith("Authority="))
    .map((line) => line.slice("Authority=".length).trim());
  const developerIdAuthority = authorities.find((value) =>
    value.startsWith("Developer ID Application: "));
  if (!developerIdAuthority || !developerIdAuthority.includes(`(${config.teamIdentifier})`)) {
    fail("application is not signed by the expected Developer ID Application identity");
  }
  if (field(details, "TeamIdentifier") !== config.teamIdentifier) {
    fail("application TeamIdentifier does not match the release configuration");
  }
  if (field(details, "Identifier") !== config.bundleIdentifier) {
    fail("application bundle identifier does not match the release configuration");
  }
  if (!/\bflags=[^\n]*\bruntime\b/.test(details)) {
    fail("application is not signed with hardened runtime");
  }
  if (!details.includes("Sealed Resources version=2")) {
    fail("application does not have a version 2 sealed resource envelope");
  }
  command("spctl", ["--assess", "--type", "execute", "--verbose=4", path]);
  command("xcrun", ["stapler", "validate", path]);
  return developerIdAuthority;
}

function capture() {
  if (process.platform !== "darwin") fail("macOS trust capture must run on macOS");
  const args = parseArguments(process.argv.slice(2));
  const target = TARGETS[args.target];
  if (!target) fail("unsupported macOS release target");
  if (!/^app-v[0-9]+\.[0-9]+\.[0-9]+$/.test(args.tag)) fail("invalid stable release tag");
  if (!/^[0-9a-f]{40}$/.test(args.commit)) fail("invalid release commit SHA");
  const version = args.tag.slice("app-v".length);
  const config = distributionConfig(args.config);
  const bundleRoot = realpathSync(args.bundleRoot);
  const macosRoot = assertInside(bundleRoot, join(bundleRoot, "macos"), "macOS bundle root");
  const dmgRoot = assertInside(bundleRoot, join(bundleRoot, "dmg"), "DMG bundle root");
  const builtApplication = assertInside(
    macosRoot,
    join(macosRoot, `${config.productName}.app`),
    "built application",
  );
  const updaterArchive = assertInside(
    macosRoot,
    oneFile(macosRoot, ".app.tar.gz"),
    "updater archive",
  );
  const dmg = assertInside(dmgRoot, oneFile(dmgRoot, ".dmg"), "DMG");
  archiveEntries(updaterArchive);
  command("hdiutil", ["verify", dmg]);
  command("xcrun", ["stapler", "validate", dmg]);

  const temporary = mkdtempSync(join(tmpdir(), "dopedb-macos-trust-"));
  const extractedRoot = join(temporary, "updater");
  const mountedRoot = join(temporary, "dmg");
  mkdirSync(extractedRoot);
  mkdirSync(mountedRoot);
  let mounted = false;
  try {
    command("tar", ["-xzf", updaterArchive, "-C", extractedRoot]);
    command("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mountedRoot,
      dmg,
    ]);
    mounted = true;
    const updaterApplication = findApplication(extractedRoot, config.productName);
    const dmgApplication = findApplication(mountedRoot, config.productName);
    const applications = [builtApplication, updaterApplication, dmgApplication];
    const authorities = applications.map((path) => verifyApplication(path, config));
    if (new Set(authorities).size !== 1) {
      fail("app, DMG, and updater do not share one Developer ID identity");
    }
    const appTreeDigests = applications.map(applicationTreeDigest);
    if (new Set(appTreeDigests).size !== 1) {
      fail("DMG and updater archive do not contain the same signed application bytes");
    }
    const expectedPrefix = `DopeDB_${version}_${target.assetSuffix}`;
    const receipt = {
      schemaVersion: 1,
      tag: args.tag,
      commit: args.commit,
      target: args.target,
      architecture: target.architecture,
      teamIdentifier: config.teamIdentifier,
      bundleIdentifier: config.bundleIdentifier,
      developerIdAuthority: authorities[0],
      appTreeSha256: appTreeDigests[0],
      artifacts: {
        dmg: {
          name: `${expectedPrefix}.dmg`,
          sha256: sha256File(dmg),
        },
        updater: {
          name: `${expectedPrefix}.app.tar.gz`,
          sha256: sha256File(updaterArchive),
        },
      },
      checks: {
        codesignStrict: true,
        developerId: true,
        hardenedRuntime: true,
        spctlExecute: true,
        appStaple: true,
        dmgStaple: true,
        dmgIntegrity: true,
        sameAppBytes: true,
      },
    };
    writeFileSync(args.output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(`captured macOS distribution trust for ${args.target}`);
  } finally {
    if (mounted) {
      const detached = spawnSync("hdiutil", ["detach", mountedRoot], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (detached.status !== 0) {
        console.warn("macOS distribution trust capture could not detach its temporary DMG mount");
      }
    }
    rmSync(temporary, { force: true, recursive: true });
  }
}

try {
  capture();
} catch (error) {
  console.error(`macOS distribution trust capture failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
