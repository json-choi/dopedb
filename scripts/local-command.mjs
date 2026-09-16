// Resolve the exact local executables this repository's site deployment scripts
// re-invoke. A corepack-only shell has no bare `pnpm` on PATH, so prefer the
// pinned binary inside a subproject's node_modules, then the package manager
// already running this process, then corepack, which runs the version the
// nearest package.json pins instead of fetching an arbitrary release.
//
// This lives beside its only callers, the repository-root deploy and verify
// scripts. `site/` stays an independent subproject and gains no import from
// here, and `workspace-cloud/scripts/local-command.mjs` keeps serving the
// workspace-cloud scripts that import it from inside their own tree.
import { statSync } from "node:fs";
import { delimiter, resolve } from "node:path";

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// The first PATH entry that actually holds this command. Resolving it here turns
// a missing executable into a named diagnostic instead of a later spawn failure.
export function onPath(name) {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const file = resolve(directory, `${name}${extension}`);
      if (isFile(file)) return file;
    }
  }
  return undefined;
}

// The package manager this project declares, as an argv prefix. pnpm passes its
// own entry point down as npm_execpath, which a plain `node` invocation does not
// set. A bare `pnpm` on PATH stays ahead of corepack so an environment that
// already installed the pinned version keeps using it; corepack is the fallback
// for a shell that has no bare pnpm, and it runs the version the nearest
// package.json pins rather than downloading an arbitrary newer release.
export function packageManager() {
  const execpath = process.env.npm_execpath;
  if (execpath && isFile(execpath)) {
    return /\.[cm]?js$/.test(execpath) ? [process.execPath, execpath] : [execpath];
  }
  const pnpm = onPath("pnpm");
  if (pnpm) return [pnpm];
  const corepack = onPath("corepack");
  if (corepack) return [corepack, "pnpm"];
  throw new Error("No package manager is available: run `corepack enable` or put the pinned pnpm on PATH.");
}

// A pinned CLI from the node_modules of the given project directory, which is a
// parameter because each independent subproject installs its own dependency tree.
export function localBin(directory, name) {
  const binary = resolve(directory, "node_modules/.bin", process.platform === "win32" ? `${name}.CMD` : name);
  return isFile(binary) ? [binary] : [...packageManager(), "exec", name];
}

// A Node script, run by the interpreter already executing this process.
export function nodeScript(...args) {
  return [process.execPath, ...args];
}

// A package.json script, the one case that genuinely needs a package manager.
export function packageScript(name) {
  return [...packageManager(), "run", name];
}
