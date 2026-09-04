// Read-only GitHub App boundary for Project Knowledge. Installation tokens are
// minted per request, kept in function-local memory, and never returned or stored.
import "server-only";

import {
  createHash,
  createHmac,
  createSign,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../env";

const GITHUB_API = "https://api.github.com";
const GITHUB_OAUTH_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_OAUTH_ACCESS_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_API_VERSION = "2026-03-10";
const MAX_REPOSITORIES = 1_000;
const MAX_USER_INSTALLATIONS = 1_000;
const MAX_SOURCE_FILES = 100_000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 16 * 1024 * 1024;
const GITHUB_REQUEST_TIMEOUT_MS = 8_000;
const GITHUB_METADATA_RESPONSE_BYTES = 1024 * 1024;
const GITHUB_TREE_RESPONSE_BYTES = 8 * 1024 * 1024;
const GITHUB_BLOB_RESPONSE_BYTES = 24 * 1024 * 1024;

type GithubInstallationToken = {
  token: string;
  expires_at: string;
};

export class GithubKnowledgeRequestError extends Error {
  constructor(readonly status: number) {
    super("GitHub Knowledge request failed");
    this.name = "GithubKnowledgeRequestError";
  }
}

export type GithubInstallation = {
  id: number;
  account: { id: number; login: string };
  repository_selection: "all" | "selected";
  suspended_at: string | null;
};

export type GithubRepository = {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
  archived: boolean;
};

export type GithubSourceFile = {
  path: string;
  blobSha: string;
  bytes: number;
};

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function githubAppConfiguration() {
  const appId = env.githubKnowledgeAppId();
  const appSlug = env.githubKnowledgeAppSlug();
  const privateKey = env.githubKnowledgePrivateKey();
  if (
    !appId
    || !/^[1-9][0-9]{0,19}$/.test(appId)
    || !appSlug
    || !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(appSlug)
    || !privateKey
  ) {
    throw new Error("GitHub Knowledge App is not configured");
  }
  return { appId, appSlug, privateKey };
}

function githubOauthConfiguration() {
  const clientId = env.githubKnowledgeClientId();
  const clientSecret = env.githubKnowledgeClientSecret();
  if (
    !clientId
    || !/^[A-Za-z0-9._-]{10,128}$/.test(clientId)
    || !clientSecret
    || clientSecret.length < 20
    || clientSecret.length > 512
    || /[\u0000-\u001f\u007f-\u009f]/.test(clientSecret)
  ) {
    throw new Error("GitHub Knowledge OAuth is not configured");
  }
  return { clientId, clientSecret };
}

function githubOauthCallbackUrl() {
  return new URL("/api/v1/knowledge/github/callback", env.appOrigin()).toString();
}

export function githubKnowledgeConfigured() {
  try {
    githubAppConfiguration();
    githubOauthConfiguration();
    const webhookSecret = env.githubKnowledgeWebhookSecret();
    return Boolean(webhookSecret && webhookSecret.length >= 32);
  } catch {
    return false;
  }
}

export function githubInstallationUrl(state: string) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(state)) {
    throw new Error("Invalid GitHub installation state");
  }
  const { appSlug } = githubAppConfiguration();
  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

function githubOauthStateSignature(
  setupState: string,
  installationId: bigint,
  clientSecret: string,
) {
  return createHmac("sha256", clientSecret)
    .update(`dopedb-github-installation-oauth-state\0${setupState}\0${installationId}`)
    .digest("base64url");
}

function deriveGithubPkceEntropy(
  setupState: string,
  installationId: bigint,
  clientSecret: string,
) {
  return createHmac("sha256", clientSecret)
    .update(`dopedb-github-installation-oauth-pkce\0${setupState}\0${installationId}`)
    .digest("base64url");
}

export type GithubInstallationUserAuthorizationState = Readonly<{
  setupState: string;
  installationId: bigint;
  pkceEntropy: string;
}>;

export function githubInstallationUserAuthorizationUrl(
  setupState: string,
  installationId: bigint,
) {
  if (
    !/^[A-Za-z0-9_-]{32,256}$/.test(setupState)
    || installationId <= 0n
    || installationId > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Invalid GitHub installation authorization input");
  }
  const { clientId, clientSecret } = githubOauthConfiguration();
  const signature = githubOauthStateSignature(
    setupState,
    installationId,
    clientSecret,
  );
  const pkceEntropy = deriveGithubPkceEntropy(
    setupState,
    installationId,
    clientSecret,
  );
  // RFC 7636 requires SHA-256 for the S256 challenge. The input is a
  // server-derived 256-bit HMAC value, not a stored user credential.
  const codeChallenge = createHash("sha256")
    .update(pkceEntropy)
    .digest("base64url");
  const url = new URL(GITHUB_OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", githubOauthCallbackUrl());
  url.searchParams.set(
    "state",
    `${setupState}.${installationId.toString()}.${signature}`,
  );
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function parseGithubInstallationUserAuthorizationState(
  value: string,
): GithubInstallationUserAuthorizationState {
  const parts = value.split(".");
  if (
    parts.length !== 3
    || !/^[A-Za-z0-9_-]{32,256}$/.test(parts[0] ?? "")
    || !/^[1-9][0-9]{0,19}$/.test(parts[1] ?? "")
    || !/^[A-Za-z0-9_-]{43}$/.test(parts[2] ?? "")
  ) {
    throw new Error("Invalid GitHub installation authorization state");
  }
  const setupState = parts[0] ?? "";
  const installationId = BigInt(parts[1] ?? "0");
  if (installationId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invalid GitHub installation authorization state");
  }
  const { clientSecret } = githubOauthConfiguration();
  const received = Buffer.from(parts[2] ?? "", "base64url");
  const expected = Buffer.from(
    githubOauthStateSignature(setupState, installationId, clientSecret),
    "base64url",
  );
  if (
    received.length !== expected.length
    || !timingSafeEqual(received, expected)
  ) {
    throw new Error("Invalid GitHub installation authorization state");
  }
  return {
    setupState,
    installationId,
    pkceEntropy: deriveGithubPkceEntropy(
      setupState,
      installationId,
      clientSecret,
    ),
  };
}

function appJwt() {
  const { appId, privateKey } = githubAppConfiguration();
  const now = Math.floor(Date.now() / 1_000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  }));
  const input = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey).toString("base64url")}`;
}

async function boundedGithubJson<T>(
  response: Response,
  maximumBytes: number,
): Promise<T> {
  if (!response.ok) {
    throw new GithubKnowledgeRequestError(response.status);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new Error("GitHub returned a non-JSON response");
  }
  const declaredLengthHeader = response.headers.get("content-length");
  const declaredLength = declaredLengthHeader === null ? null : Number(declaredLengthHeader);
  if (declaredLength !== null && (
    !Number.isSafeInteger(declaredLength)
    || declaredLength < 0
    || declaredLength > maximumBytes
  )) {
    throw new Error("GitHub response exceeded the configured byte limit");
  }
  if (!response.body) throw new Error("GitHub returned an empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error("GitHub response exceeded the configured byte limit");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new Error("GitHub returned invalid UTF-8 JSON");
  }
  return JSON.parse(text) as T;
}

async function githubJson<T>(
  path: string,
  authorization: string,
  init: RequestInit = {},
  maximumBytes = GITHUB_METADATA_RESPONSE_BYTES,
): Promise<T> {
  if (!path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error("Invalid GitHub API path");
  }
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${authorization}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "DopeDB-Project-Knowledge",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return await boundedGithubJson<T>(response, maximumBytes);
}

async function githubUserAccessToken(code: string, pkceEntropy: string) {
  if (
    !/^[A-Za-z0-9_-]{16,256}$/.test(code)
    || !/^[A-Za-z0-9_-]{43,128}$/.test(pkceEntropy)
  ) {
    throw new Error("Invalid GitHub user authorization response");
  }
  const { clientId, clientSecret } = githubOauthConfiguration();
  const response = await fetch(GITHUB_OAUTH_ACCESS_TOKEN, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "DopeDB-Project-Knowledge",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: githubOauthCallbackUrl(),
      code_verifier: pkceEntropy,
    }),
  });
  const result = await boundedGithubJson<{
    access_token?: unknown;
    token_type?: unknown;
  }>(response, GITHUB_METADATA_RESPONSE_BYTES);
  if (
    typeof result.access_token !== "string"
    || !result.access_token.startsWith("ghu_")
    || result.access_token.length < 24
    || result.access_token.length > 512
    || typeof result.token_type !== "string"
    || result.token_type.toLowerCase() !== "bearer"
  ) {
    throw new Error("GitHub returned an invalid user access token");
  }
  return result.access_token;
}

export async function verifyGithubInstallationUserAccess(
  code: string,
  authorizationState: GithubInstallationUserAuthorizationState,
) {
  const accessToken = await githubUserAccessToken(
    code,
    authorizationState.pkceEntropy,
  );
  for (let page = 1; page <= Math.ceil(MAX_USER_INSTALLATIONS / 100); page += 1) {
    const response = await githubJson<{
      total_count: number;
      installations: Array<{ id: number }>;
    }>(`/user/installations?per_page=100&page=${page}`, accessToken);
    if (
      !Number.isSafeInteger(response.total_count)
      || response.total_count < 0
      || response.total_count > MAX_USER_INSTALLATIONS
      || !Array.isArray(response.installations)
      || response.installations.length > 100
    ) {
      throw new Error("GitHub returned an invalid user installation inventory");
    }
    if (response.installations.some((installation) => (
      Number.isSafeInteger(installation?.id)
      && BigInt(installation.id) === authorizationState.installationId
    ))) {
      return true;
    }
    if (
      response.installations.length < 100
      || page * 100 >= response.total_count
    ) break;
  }
  return false;
}

export async function inspectGithubInstallation(installationId: bigint) {
  if (installationId <= 0n || installationId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invalid GitHub installation id");
  }
  return await githubJson<GithubInstallation>(
    `/app/installations/${installationId.toString()}`,
    appJwt(),
  );
}

async function installationToken(installationId: bigint) {
  const token = await githubJson<GithubInstallationToken>(
    `/app/installations/${installationId.toString()}/access_tokens`,
    appJwt(),
    {
      method: "POST",
      body: JSON.stringify({ permissions: { contents: "read" } }),
    },
  );
  if (
    typeof token.token !== "string"
    || token.token.length < 20
    || !Number.isFinite(Date.parse(token.expires_at))
  ) {
    throw new Error("GitHub returned an invalid installation token");
  }
  return token.token;
}

export async function listGithubRepositories(installationId: bigint) {
  const token = await installationToken(installationId);
  const repositories: GithubRepository[] = [];
  for (let page = 1; repositories.length < MAX_REPOSITORIES; page += 1) {
    const response = await githubJson<{
      total_count: number;
      repositories: GithubRepository[];
    }>(`/installation/repositories?per_page=100&page=${page}`, token);
    if (!Number.isSafeInteger(response.total_count) || response.total_count < 0) {
      throw new Error("GitHub returned an invalid repository inventory size");
    }
    if (response.total_count > MAX_REPOSITORIES) {
      throw new Error("GitHub installation exceeds the repository inventory limit");
    }
    if (!Array.isArray(response.repositories) || response.repositories.length > 100) {
      throw new Error("GitHub returned an invalid repository inventory");
    }
    for (const repository of response.repositories) {
      if (
        repository !== null
        && typeof repository === "object"
        && Number.isSafeInteger(repository.id)
        && repository.id > 0
        && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name)
        && /^[A-Za-z0-9._\/-]{1,255}$/.test(repository.default_branch)
      ) {
        if (repositories.length >= MAX_REPOSITORIES) {
          throw new Error("GitHub installation exceeds the repository inventory limit");
        }
        repositories.push(repository);
      }
    }
    if (response.repositories.length < 100 || repositories.length >= response.total_count) break;
  }
  return repositories.sort((left, right) => left.full_name.localeCompare(right.full_name));
}

function checkedRepository(repository: string) {
  const segments = repository.split("/");
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Invalid GitHub repository identity");
  }
  return repository;
}

function checkedRef(refName: string) {
  if (
    !/^[A-Za-z0-9._\/-]{1,255}$/.test(refName)
    || refName.startsWith("/")
    || refName.startsWith(".")
    || refName.endsWith("/")
    || refName.endsWith(".")
    || refName.includes("..")
    || refName.includes("//")
  ) {
    throw new Error("Invalid GitHub ref");
  }
  return refName;
}

export async function resolveGithubCommit(
  installationId: bigint,
  repository: string,
  refName: string,
) {
  const token = await installationToken(installationId);
  const commit = await githubJson<{ sha: string }>(
    `/repos/${checkedRepository(repository)}/commits/${encodeURIComponent(checkedRef(refName))}`,
    token,
  );
  if (!/^[0-9a-f]{40}$/.test(commit.sha)) {
    throw new Error("GitHub returned an invalid commit identity");
  }
  return commit.sha;
}

const SOURCE_EXTENSIONS = new Set([
  "c", "cc", "cjs", "cpp", "cs", "go", "h", "hpp", "java", "js", "json", "jsx",
  "kt", "kts", "md", "mdx", "mjs", "php", "proto", "py", "rb", "rs", "sh", "sql",
  "svelte", "swift", "toml", "ts", "tsx", "vue", "yaml", "yml",
]);
const EXCLUDED_SEGMENTS = new Set([
  ".git", ".next", "build", "dist", "node_modules", "target", "vendor",
]);

function supportedSourcePath(path: string) {
  const segments = path.split("/");
  const fileName = segments.at(-1)?.toLowerCase();
  const extension = fileName?.split(".").at(-1);
  return Boolean(
    fileName
    && (fileName === "dockerfile"
      || fileName.startsWith("dockerfile.")
      || (extension && SOURCE_EXTENSIONS.has(extension)))
    && segments.every((segment) => segment && segment !== "." && segment !== "..")
    && !/[\u0000-\u001f\u007f-\u009f]/.test(path)
    && !segments.some((segment) => EXCLUDED_SEGMENTS.has(segment)),
  );
}

export async function githubSourceManifest(
  installationId: bigint,
  repository: string,
  commitSha: string,
  options: { maxTotalBytes?: number } = {},
) {
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error("Invalid GitHub commit");
  const token = await installationToken(installationId);
  const tree = await githubJson<{
    truncated: boolean;
    tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }>;
  }>(
    `/repos/${checkedRepository(repository)}/git/trees/${commitSha}?recursive=1`,
    token,
    {},
    GITHUB_TREE_RESPONSE_BYTES,
  );
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > MAX_SOURCE_FILES) {
    throw new Error("GitHub repository tree is truncated or invalid");
  }
  const maxTotalBytes = options.maxTotalBytes ?? MAX_SOURCE_BYTES;
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) {
    throw new Error("Invalid GitHub source manifest budget");
  }
  let totalBytes = 0;
  const files: GithubSourceFile[] = [];
  for (const item of tree.tree) {
    if (
      item.type !== "blob"
      || item.mode === "120000"
      || !supportedSourcePath(item.path)
      || !Number.isSafeInteger(item.size)
      || (item.size ?? 0) < 0
      || (item.size ?? 0) > MAX_SOURCE_FILE_BYTES
      || !/^[0-9a-f]{40}$/.test(item.sha)
    ) {
      continue;
    }
    totalBytes += item.size ?? 0;
    if (files.length >= MAX_SOURCE_FILES || totalBytes > maxTotalBytes) {
      throw new Error("GitHub repository exceeds the source manifest budget");
    }
    files.push({ path: item.path, blobSha: item.sha, bytes: item.size ?? 0 });
  }
  return files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"))
  );
}

async function readGithubBlobWithToken(
  token: string,
  repository: string,
  blobSha: string,
) {
  if (!/^[0-9a-f]{40}$/.test(blobSha)) throw new Error("Invalid GitHub blob identity");
  const blob = await githubJson<{ encoding: string; content: string; size: number }>(
    `/repos/${checkedRepository(repository)}/git/blobs/${blobSha}`,
    token,
    {},
    GITHUB_BLOB_RESPONSE_BYTES,
  );
  if (
    blob.encoding !== "base64"
    || !Number.isSafeInteger(blob.size)
    || blob.size < 0
    || blob.size > MAX_SOURCE_FILE_BYTES
  ) {
    throw new Error("GitHub returned an invalid source blob");
  }
  const bytes = Buffer.from(blob.content.replaceAll("\n", ""), "base64");
  if (bytes.byteLength !== blob.size) throw new Error("GitHub source blob size changed");
  const identity = createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
  if (identity !== blobSha) throw new Error("GitHub source blob identity changed");
  return bytes;
}

export async function readGithubBlobs(
  installationId: bigint,
  repository: string,
  files: ReadonlyArray<{ path: string; blobSha: string }>,
) {
  if (files.length < 1 || files.length > 50) throw new Error("Invalid GitHub blob batch");
  const token = await installationToken(installationId);
  const results = new Array<{ path: string; bytes: Buffer }>(files.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(16, files.length) }, async () => {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      const file = files[index]!;
      results[index] = {
        path: file.path,
        bytes: await readGithubBlobWithToken(token, repository, file.blobSha),
      };
    }
  }));
  return results;
}

export function verifyGithubWebhook(rawBody: Buffer, signature: string | null) {
  const secret = env.githubKnowledgeWebhookSecret();
  if (!secret || secret.length < 32 || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const receivedBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return receivedBytes.length === expectedBytes.length
    && timingSafeEqual(receivedBytes, expectedBytes);
}
