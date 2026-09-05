// Release availability gate. The Desktop installer remains the authority for
// Minisign and full payload verification; this gate never installs or runs code.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const repository = "json-choi/dopedb";
const releaseBase = `https://github.com/${repository}/releases/download/`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function version(value) {
  assert(typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value), "invalid compatibility version");
  return value.split(".").map(Number);
}

function compare(left, right) {
  const a = version(left);
  const b = version(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function stableReleaseTags(refs) {
  assert(Array.isArray(refs) && refs.length <= 99, "ACP tag catalog is missing or exceeds the Desktop limit");
  return refs.flatMap(({ ref }) => {
    const match = /^refs\/tags\/(acp-bundle-v(\d{4})\.(\d{2})\.(\d{2})\.([1-9]\d*))$/.exec(ref);
    if (!match) return [];
    const [, tag, year, month, day, sequence] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return [];
    return [{ tag, date: date.valueOf(), sequence: Number(sequence) }];
  }).sort((a, b) => b.date - a.date || b.sequence - a.sequence).slice(0, 8).map(({ tag }) => tag);
}

export function assertPublishedCompatibility(envelope, plugin, catalog, runtime, tag) {
  const manifest = envelope?.manifest;
  const label = `${tag}/${plugin.provider}`;
  assert(manifest?.schemaVersion === 2 && manifest.pluginId === plugin.id && manifest.provider === plugin.provider, `${label}: incompatible manifest schema or plugin identity; publish a current ACP bundle first`);
  assert(envelope.keyId === catalog.keyId && manifest.artifact?.keyId === catalog.keyId, `${label}: wrong signing key identity`);
  assert(typeof envelope.signature === "string" && envelope.signature.length > 0, `${label}: missing manifest signature`);
  assert(createHash("sha256").update(JSON.stringify(manifest)).digest("hex") === envelope.manifestSha256, `${label}: manifest digest mismatch`);
  assert(!manifest.revokedAt && manifest.rolloutBasisPoints === 10_000, `${label}: release is revoked or not fully available`);
  const compatibility = manifest.compatibility;
  assert(compatibility && Object.keys(compatibility).sort().join(",") === "acpProtocolMax,acpProtocolMin,nodeVersionMax,nodeVersionMin,runtimeContractVersion", `${label}: invalid compatibility contract`);
  assert(Number.isInteger(compatibility.runtimeContractVersion) && compatibility.runtimeContractVersion > 0
    && compatibility.runtimeContractVersion === catalog.runtimeContractVersion,
    `${label}: incompatible adapter runtime contract; publish a compatible ACP bundle first`);
  assert(compare(runtime.version, compatibility.nodeVersionMin) >= 0 && compare(runtime.version, compatibility.nodeVersionMax) <= 0, `${label}: incompatible bundled Node`);
  assert(catalog.acpProtocol >= compatibility.acpProtocolMin && catalog.acpProtocol <= compatibility.acpProtocolMax, `${label}: incompatible ACP protocol`);
  assert(manifest.adapterVersion === plugin.adapterVersion && manifest.adapterBundleVersion === plugin.adapterBundleVersion, `${label}: published adapter does not match the checked-in pins`);
  assert(manifest.artifact.url === `${releaseBase}${tag}/${plugin.provider}.tar.gz`, `${label}: artifact belongs to another release`);
  assert(Number.isSafeInteger(manifest.artifact.packedBytes) && manifest.artifact.packedBytes > 0 && manifest.artifact.packedBytes <= 30 * 1024 * 1024, `${label}: invalid artifact size`);
  return manifest;
}

async function request(url, method = "GET") {
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const parsed = new URL(url);
    assert(parsed.protocol === "https:" && ["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(parsed.hostname), "ACP release redirected outside GitHub");
    const response = await fetch(url, {
      method, redirect: "manual", signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "DopeDB-release-availability" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    assert(location, "ACP release redirect is missing its location");
    url = new URL(location, url).href;
  }
  throw new Error("too many ACP release redirects");
}

async function json(url, maximum) {
  const response = await request(url);
  if (response.status === 404) return null;
  assert(response.ok, `ACP release request failed: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(size <= maximum, "ACP release response exceeds its size limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  assert(process.argv.length === 2, "usage: pnpm check:agent-runtime:published");
  const [catalog, runtime] = await Promise.all([
    "agent-runtime/plugins/catalog.json", "src-tauri/resources/agent-runtime/runtime-catalog.json",
  ].map(async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"))));
  const refs = await json(`https://api.github.com/repos/${repository}/git/matching-refs/tags/acp-bundle-v?per_page=100`, 256 * 1024);
  const tags = stableReleaseTags(refs);
  assert(tags.length > 0, "no published stable ACP bundle exists");
  for (const plugin of catalog.plugins) {
    let found = false;
    for (const tag of tags) {
      const envelope = await json(`${releaseBase}${tag}/${plugin.provider}.manifest.json`, 128 * 1024);
      if (!envelope) continue;
      // Match Desktop resolution: an incompatible published manifest is a
      // failure, not permission to silently fall back to an older adapter.
      const manifest = assertPublishedCompatibility(envelope, plugin, catalog, runtime, tag);
      const artifact = await request(manifest.artifact.url, "HEAD");
      assert(artifact.ok && Number(artifact.headers.get("content-length")) === manifest.artifact.packedBytes, `${tag}/${plugin.provider}: public bundle is missing or has the wrong size`);
      console.log(`${plugin.provider}: ${tag}, adapter ${manifest.adapterVersion}, runtime contract ${catalog.runtimeContractVersion} compatible and publicly downloadable`);
      found = true;
      break;
    }
    assert(found, `${plugin.provider}: no public stable ACP manifest exists`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Published ACP verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
