import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1] ?? "");
}
const input = resolve(required("--input"));
const key = resolve(required("--secret-key"));
const releaseTag = required("--release-tag");
const releasedAt = required("--released-at");
if (!validReleaseTag(releaseTag)) fail("invalid ACP adapter release tag");
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(releasedAt)) fail("released-at must be UTC seconds");

const metadata = JSON.parse(await readFile(join(input, "build-metadata.json"), "utf8"));
if (metadata.schemaVersion !== 2 || metadata.keyId !== "71F10E6488C84C71") fail("invalid ACP build metadata");
const artifact = resolve(metadata.artifact.path);
if (!artifact.startsWith(`${input}/`) || basename(artifact) !== `${metadata.plugin.provider}.tar.gz`) {
  fail("ACP artifact escaped its build directory");
}
const artifactSignaturePath = `${artifact}.minisig`;
await sign(key, artifact, artifactSignaturePath);
const artifactSignature = await readFile(artifactSignaturePath, "utf8");
const manifest = {
  schemaVersion: 2,
  pluginId: metadata.plugin.id,
  provider: metadata.plugin.provider,
  adapterVersion: metadata.plugin.adapterVersion,
  adapterBundleVersion: metadata.plugin.adapterBundleVersion,
  adapterEntrypoint: metadata.plugin.entrypoint,
  upstream: {
    repository: metadata.plugin.upstreamRepository,
    tag: metadata.plugin.upstreamTag,
    commit: metadata.plugin.upstreamCommit,
  },
  compatibility: metadata.compatibility,
  artifact: {
    url: `https://github.com/json-choi/dopedb/releases/download/${releaseTag}/${basename(artifact)}`,
    sha256: metadata.artifact.sha256,
    signature: artifactSignature,
    keyId: metadata.keyId,
    packedBytes: metadata.artifact.packedBytes,
    unpackedBytes: metadata.artifact.unpackedBytes,
  },
  licenses: metadata.licenses,
  sbomSha256: metadata.sbomSha256,
  contentSha256: metadata.contentSha256,
  releasedAt,
  rolloutBasisPoints: 10_000,
};
const canonical = JSON.stringify(manifest);
const canonicalPath = join(input, `${metadata.plugin.provider}.manifest.canonical.json`);
await writeFile(canonicalPath, canonical);
const signaturePath = `${canonicalPath}.minisig`;
await sign(key, canonicalPath, signaturePath);
const envelope = {
  manifest,
  manifestSha256: createHash("sha256").update(canonical).digest("hex"),
  signature: await readFile(signaturePath, "utf8"),
  keyId: metadata.keyId,
};
const output = join(input, `${metadata.plugin.provider}.manifest.json`);
await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`);
console.log(output);

function sign(secretKey, message, signature) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("cargo", [
      "run",
      "--locked",
      "--quiet",
      "-p",
      "acp-plugin-sign",
      "--",
      "--secret-key",
      secretKey,
      "--message",
      message,
      "--signature",
      signature,
    ], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`ACP signer exited ${code}`)));
  });
}

function required(name) {
  const value = args.get(name);
  if (!value) fail(`missing ${name}`);
  return value;
}

function validReleaseTag(value) {
  const match = /^acp-bundle-v(\d{4})\.(\d{2})\.(\d{2})\.([1-9]\d*)(?:-candidate)?$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = parsed.toISOString().slice(0, 10);
  return normalized === `${year}-${month}-${day}`;
}

function fail(message) {
  throw new Error(message);
}
