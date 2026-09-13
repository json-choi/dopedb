// Resolve the exact local executables this project's scripts re-invoke. A
// corepack-only shell has no bare `pnpm` on PATH, so prefer the pinned binary in
// node_modules and keep the package manager for real package scripts. Each
// helper returns an argv prefix so callers append their own parameters.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// The package manager that started this process. pnpm passes its own entry
// point down as npm_execpath, which a plain `node` invocation does not set.
export function packageManager() {
  const execpath = process.env.npm_execpath;
  if (!execpath) return ["pnpm"];
  return /\.[cm]?js$/.test(execpath) ? [process.execPath, execpath] : [execpath];
}

// A pinned CLI from the node_modules of the given project directory, which is a
// parameter because each subproject installs against its own dependency tree.
export function localBin(directory, name) {
  const binary = resolve(directory, "node_modules/.bin", process.platform === "win32" ? `${name}.CMD` : name);
  return existsSync(binary) ? [binary] : [...packageManager(), "exec", name];
}

// A Node script, run by the interpreter already executing this process.
export function nodeScript(...args) {
  return [process.execPath, ...args];
}

// A package.json script, the one case that genuinely needs a package manager.
export function packageScript(name) {
  return [...packageManager(), "run", name];
}
