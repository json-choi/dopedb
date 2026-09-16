// Exercise the site deployment orchestrator against isolated fake commands so
// package-runner and fail-closed behavior never touches Cloudflare or GitHub.
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deploySite } from "./deploy-site-cloudflare.mjs";

const commit = "a".repeat(40);
const accountId = "0123456789abcdef0123456789abcdef";
const versionId = "11111111-2222-3333-4444-555555555555";
const fakeCommand = `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { basename } from "node:path";

const name = basename(process.argv[1]).replace(/\\.cmd$/iu, "");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_COMMAND_LOG, JSON.stringify({ name, args }) + "\\n", "utf8");

if (name === "git") console.log(process.env.FAKE_COMMIT);
if (name === "wrangler") console.log(JSON.stringify({
  loggedIn: true,
  accounts: [{ id: process.env.FAKE_ACCOUNT_ID }],
}, null, 2));
if (name === "pnpm" && args[0] === "--version") console.log(process.env.FAKE_PNPM_VERSION);
if (name === "corepack" && args[0] === "pnpm" && args[1] === "--version") {
  console.log(process.env.FAKE_PNPM_VERSION);
}
if (name === "opennextjs-cloudflare") {
  console.log("Current Version ID: " + process.env.FAKE_VERSION_ID);
}

const build = (name === "pnpm" && args.join(" ") === "run build:cloudflare")
  || (name === "corepack" && args.join(" ") === "pnpm run build:cloudflare");
if (build && process.env.FAKE_FAIL_STEP === "build") process.exit(19);
`;

async function executable(path, source = fakeCommand) {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o755);
}

async function fixture({ runner = "pnpm", brokenWrangler = false, failStep } = {}) {
  const root = await mkdtemp(join(tmpdir(), "dopedb site deploy with spaces "));
  const site = join(root, "site");
  const commands = join(root, "fake commands");
  const localBins = join(site, "node_modules", ".bin");
  const scripts = join(root, "scripts");
  const log = join(root, "command log.jsonl");
  await mkdir(commands, { recursive: true });
  await mkdir(localBins, { recursive: true });
  await mkdir(scripts, { recursive: true });
  await writeFile(join(site, "package.json"), JSON.stringify({ packageManager: "pnpm@11.25.0" }), "utf8");
  await writeFile(join(site, "wrangler.jsonc"), JSON.stringify({
    name: "dopedb-site",
    account_id: accountId,
    routes: [{ pattern: "www.dopedb.dev" }, { pattern: "dopedb.dev" }],
  }), "utf8");
  await executable(join(commands, "git"));
  if (runner) await executable(join(commands, runner));
  if (brokenWrangler) {
    await executable(join(localBins, "wrangler"), "#!/definitely/missing/dopedb-interpreter\n");
  } else {
    await executable(join(localBins, "wrangler"));
  }
  await executable(join(localBins, "opennextjs-cloudflare"));
  await writeFile(join(scripts, "check-site-deployment.mjs"), fakeCommand, "utf8");

  const env = {
    PATH: commands,
    FAKE_ACCOUNT_ID: accountId,
    FAKE_COMMAND_LOG: log,
    FAKE_COMMIT: commit,
    FAKE_FAIL_STEP: failStep ?? "",
    FAKE_PNPM_VERSION: "11.25.0",
    FAKE_VERSION_ID: versionId,
  };
  return { root, env, log };
}

async function entries(path) {
  try {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function runScenario(setup) {
  const output = [];
  await deploySite({
    root: setup.root,
    env: setup.env,
    args: ["--commit", commit],
    writeStdout: (value) => output.push(value),
    writeStderr: (value) => output.push(value),
  });
  return { commands: await entries(setup.log), output };
}

const scenarios = [
  ["PATH pnpm uses the exact pin and preserves the full ordered receipt flow through paths with spaces", async () => {
    const setup = await fixture();
    try {
      assert(setup.root.includes(" "));
      const result = await runScenario(setup);
      assert.deepEqual(result.commands.map(({ name }) => name), [
        "git", "wrangler", "pnpm", "pnpm", "opennextjs-cloudflare", "check-site-deployment.mjs",
      ]);
      assert.deepEqual(result.commands[2].args, ["--version"]);
      assert.deepEqual(result.commands[3].args, ["run", "build:cloudflare"]);
      assert.deepEqual(result.commands[4].args, ["deploy", "--message", "git-aaaaaaaa-site-ci"]);
      assert.deepEqual(result.commands[5].args, [versionId]);
      assert(!result.commands.some(({ args }) => args.includes("exec")));
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  }],
  ["corepack-only PATH runs the pinned package script without a bare pnpm", async () => {
    const setup = await fixture({ runner: "corepack" });
    try {
      const result = await runScenario(setup);
      assert.deepEqual(result.commands.map(({ name }) => name), [
        "git", "wrangler", "corepack", "corepack", "opennextjs-cloudflare", "check-site-deployment.mjs",
      ]);
      assert.deepEqual(result.commands[2].args, ["pnpm", "--version"]);
      assert.deepEqual(result.commands[3].args, ["pnpm", "run", "build:cloudflare"]);
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  }],
  ["no pnpm or corepack fails before build, deploy, and receipt verification", async () => {
    const setup = await fixture({ runner: null });
    try {
      await assert.rejects(runScenario(setup), (error) => {
        assert.match(error.message, /No package runner matches the site pin pnpm@11\.25\.0/u);
        assert.match(error.message, /pnpm: ENOENT/u);
        assert.match(error.message, /corepack pnpm: ENOENT/u);
        return true;
      });
      assert.deepEqual((await entries(setup.log)).map(({ name }) => name), ["git", "wrangler"]);
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  }],
  ["spawn failure reports the executable errno before any exit status and stops later steps", async () => {
    const setup = await fixture({ brokenWrangler: true });
    try {
      await assert.rejects(runScenario(setup), (error) => {
        assert.match(error.message, /wrangler whoami could not start wrangler: ENOENT/u);
        assert.doesNotMatch(error.message, /exit/u);
        return true;
      });
      assert.deepEqual((await entries(setup.log)).map(({ name }) => name), ["git"]);
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  }],
  ["non-zero package-script exit stops deploy and receipt verification", async () => {
    const setup = await fixture({ failStep: "build" });
    try {
      await assert.rejects(runScenario(setup), (error) => {
        assert.match(error.message, /build:cloudflare failed \(pnpm\), exit 19/u);
        return true;
      });
      assert.deepEqual((await entries(setup.log)).map(({ name }) => name), [
        "git", "wrangler", "pnpm", "pnpm",
      ]);
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  }],
];

let failed = false;
for (const [name, scenario] of scenarios) {
  try {
    await scenario();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed = true;
    console.error(`not ok - ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}
if (failed) process.exitCode = 1;
