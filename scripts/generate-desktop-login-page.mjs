// Bundle a self-contained loopback document from the canonical UI primitives.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const tailwindRequire = createRequire(require.resolve("@tailwindcss/vite"));
const { compile } = await import(pathToFileURL(tailwindRequire.resolve("@tailwindcss/node")).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: "automatic" } });
try {
  const { renderDesktopLoginPage } = await server.ssrLoadModule("/src/features/workspaces/DesktopLoginPage.tsx");
  let html = renderDesktopLoginPage();
  // Fonts use the OS fallback: the ephemeral listener serves no external assets.
  const bridge = await readFile(new URL("../src/design-system/index.css", import.meta.url), "utf8");
  const compiler = await compile([
    '@import "tailwindcss/theme.css" layer(theme) prefix(tw);',
    '@import "tailwindcss/utilities.css" layer(utilities) prefix(tw) source(none) important;',
    '@import "./src/design-system/tokens.css";',
    bridge.slice(bridge.indexOf("@theme inline")),
  ].join("\n"), { base: root, onDependency() {} });
  const candidates = [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  const css = compiler.build(candidates);
  const script = await readFile(new URL("../src/features/workspaces/desktopLoginPage.js", import.meta.url), "utf8");
  html = "<!doctype html>" + html.replace("</head>", `<style>${css}</style></head>`)
    .replace("</body>", `<script>${script}</script></body>`);
  const output = new URL("../src-tauri/src/features/workspaces/adapters/desktop_login/page.html", import.meta.url);
  if (process.argv.includes("--check")) {
    if (await readFile(output, "utf8") !== html) throw new Error("Desktop login page is stale; run node scripts/generate-desktop-login-page.mjs");
  } else {
    await writeFile(output, html);
  }
  console.log("Desktop login browser document verified.");
} finally {
  await server.close();
}
