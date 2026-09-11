// Build without production values, apply exact D1 migration receipts,
// upload runtime secrets over stdin, then verify the exact public Worker version.
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../workspace-cloud", import.meta.url));
const example = parseEnv(await readFile(new URL("../workspace-cloud/.env.example", import.meta.url), "utf8"));
const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "WORKSPACE_CREDENTIAL_KEY", "CRON_SECRET",
  "WORKSPACE_KMS_KEY_NAME", "WORKSPACE_KMS_WIF_AUDIENCE", "WORKSPACE_KMS_SERVICE_ACCOUNT_EMAIL"];

function run(args, { env = {}, input, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    // Do not inherit production credentials from the invoking shell into builds.
    const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !(key in example) && !["DATABASE_URL", "DATABASE_URL_UNPOOLED"].includes(key)
      && !key.startsWith("OIDC_") && !key.startsWith("NEXT_PUBLIC_")
      && !key.startsWith("PRODUCT_ANALYTICS_")));
    const child = spawn("pnpm", args, { cwd, env: { ...clean, ...env },
      stdio: [input === undefined ? "ignore" : "pipe", capture ? "pipe" : "inherit", "inherit"] });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.length > 2 * 1024 * 1024) {
        child.kill();
        reject(new Error("Deployment output exceeded its bounded receipt buffer."));
      }
    });
    child.once("error", reject);
    child.stdin?.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(output)
      : reject(new Error(`Deployment step failed (${args[0]}), exit ${code}`)));
    if (input !== undefined) child.stdin.end(input);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const preserveSecrets = args.includes("--preserve-secrets");
  const rest = args.filter((arg) => !["--check", "--preserve-secrets"].includes(arg));
  const publicBuildEnv = JSON.parse(await readFile(`${cwd}/deployment-public.json`, "utf8"));
  if (Object.keys(publicBuildEnv).join(",") !== "NEXT_PUBLIC_CLARITY_PROJECT_ID"
    || !/^[a-z0-9]+$/.test(publicBuildEnv.NEXT_PUBLIC_CLARITY_PROJECT_ID)) {
    throw new Error("Invalid public Workspace build configuration.");
  }
  let values = {};
  if (preserveSecrets) {
    if (rest.length) throw new Error("--preserve-secrets must not receive an environment file.");
  } else {
    if (rest.length !== 2 || rest[0] !== "--env-file") {
      throw new Error("Usage: pnpm deploy:cloudflare --env-file /secure/workspace.env [--check]");
    }
    const info = await stat(rest[1]);
    if (!info.isFile() || info.size > 64 * 1_024 || (info.mode & 0o077) !== 0) {
      throw new Error("Use a private, bounded environment file (chmod 600).");
    }
    values = parseEnv(await readFile(rest[1], "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (!(key in example)) throw new Error(`Unexpected runtime variable: ${key}`);
      if (key.startsWith("NEXT_PUBLIC_")) throw new Error("Public build values belong in deployment-public.json.");
      if (!value.trim() || /\[SENSITIVE\]|replace-me|replace-with-|example\.com|example\.workers\.dev/i.test(value)) {
        throw new Error(`The original production value is required for ${key}.`);
      }
    }
    for (const key of required) if (!values[key]) throw new Error(`Missing production variable: ${key}`);
    if (values.BETTER_AUTH_URL !== "https://app.dopedb.dev") throw new Error("Production origin mismatch.");
    if (values.BETTER_AUTH_SECRET.length < 32
      || !/^[A-Za-z0-9_-]{43}$/.test(values.WORKSPACE_CREDENTIAL_KEY)
      || Buffer.from(values.WORKSPACE_CREDENTIAL_KEY, "base64url").toString("base64url") !== values.WORKSPACE_CREDENTIAL_KEY
      || !/^[a-f0-9]{64}$/.test(values.CRON_SECRET)) throw new Error("Invalid production key format.");
    if (!/^\/\/iam\.googleapis\.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/dopedb-workspace\/providers\/dopedb-workspace$/.test(values.WORKSPACE_KMS_WIF_AUDIENCE)) {
      throw new Error("KMS must use the verified Cloudflare workload identity provider before cutover.");
    }
    if (values.DATABASE_URL || values.DATABASE_URL_UNPOOLED) {
      throw new Error("Workspace production uses the D1 binding; PostgreSQL URLs are not permitted.");
    }
    for (const [switchKey, prefix] of [
      ["WORKSPACE_BACKGROUND_SCHEDULER_ENABLED", "WORKSPACE_BACKGROUND_SCHEDULER"],
    ]) {
      if (values[switchKey] && !["0", "1"].includes(values[switchKey])) throw new Error(`Invalid ${switchKey}.`);
      if (values[switchKey] === "1" && (!values[`${prefix}_URL`] || !values[`${prefix}_TOKEN`])) {
        throw new Error(`The enabled ${switchKey} requires its existing URL and token.`);
      }
    }
    if (values.PRODUCT_ANALYTICS_RELAY_ENABLED && !["0", "1"].includes(values.PRODUCT_ANALYTICS_RELAY_ENABLED)) {
      throw new Error("Invalid PRODUCT_ANALYTICS_RELAY_ENABLED.");
    }
    const githubKeys = Object.keys(example).filter((key) => key.startsWith("GITHUB_KNOWLEDGE_"));
    for (const group of [githubKeys, ["PLANETSCALE_CLIENT_ID", "PLANETSCALE_CLIENT_SECRET"],
      ["RESEND_API_KEY", "WORKSPACE_INVITATION_FROM"]]) {
      if (group.some((key) => values[key]) && group.some((key) => !values[key])) {
        throw new Error(`Incomplete optional integration: ${group[0]}.`);
      }
    }
  }
  await run(["exec", "node", "scripts/check-d1-runtime.mjs"]);
  if (checkOnly) {
    console.log("Deployment inputs accepted; no deployment, IAM, or database changes made.");
    return;
  }
  const configuration = JSON.parse(await readFile(`${cwd}/wrangler.jsonc`, "utf8"));
  const identityOutput = await run(["exec", "wrangler", "whoami", "--json"], { capture: true });
  const identityStart = identityOutput.search(/^[\t ]*[\[{][\t ]*$/m);
  if (identityStart < 0) throw new Error("Wrangler did not return an account receipt.");
  const identity = JSON.parse(identityOutput.slice(identityStart));
  if (!identity.loggedIn || !identity.accounts?.some((account) => account.id === configuration.account_id)) {
    throw new Error("The active Wrangler account does not match this project's configured account.");
  }
  if (preserveSecrets) {
    const secretOutput = await run(["exec", "wrangler", "secret", "list"], { capture: true });
    const secretStart = secretOutput.search(/^[\t ]*\[[\t ]*$/m);
    if (secretStart < 0) throw new Error("Wrangler did not return the secret inventory.");
    const names = new Set(JSON.parse(secretOutput.slice(secretStart)).map((secret) => secret.name));
    if (required.some((name) => !names.has(name))) throw new Error("Required production secrets are missing.");
    const migrationReceipt = await run(["exec", "node", "scripts/migrate-d1.mjs", "--check"], { capture: true });
    if (!/D1 migration preflight passed: \d+ applied, 0 pending\./.test(migrationReceipt)) {
      throw new Error("Code-only deployment requires a fully applied D1 migration history.");
    }
  }
  // .env.local is deliberately not the production-secret source: Next would
  // load it during compilation, outside this process environment boundary.
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (await stat(`${cwd}/${name}`).then(() => true, () => false)) {
      throw new Error(`Remove the build-visible ${name}; keep production values outside the app directory.`);
    }
  }
  await run(["build:cloudflare"], { env: publicBuildEnv });
  if (!preserveSecrets) {
    await run(["exec", "node", "scripts/migrate-d1.mjs"]);
    await run(["exec", "wrangler", "secret", "bulk"], { input: JSON.stringify(values) });
  }
  const deployed = await run(["exec", "opennextjs-cloudflare", "deploy"], { capture: true });
  const versions = [...deployed.matchAll(/Current Version ID:\s+([a-f0-9-]{36})/g)];
  if (versions.length !== 1) throw new Error("The exact uploaded Worker version was not returned.");
  const versionId = versions[0][1];
  console.log(`Uploaded Workspace Worker version ${versionId}. Verifying the production domain.`);
  await run(["exec", "node", "../scripts/check-workspace-deployment.mjs", versionId]);
}

try { await main(); } catch (error) {
  // Never print command environments, HTTP bodies, or original credential values.
  console.error(error instanceof Error ? error.message : "Workspace deployment failed.");
  process.exitCode = 1;
}
