/// <reference types="vitest/config" />

import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

const packageMetadata = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const sentryRelease = `dopedb@${packageMetadata.version}`;

// Tauri v2 dev server config. Fixed port so the Rust side can point WKWebView at it.
export default defineConfig(({ command }) => {
  const uploadSourcemaps =
    command === "build" &&
    process.env.DOPEDB_SENTRY_UPLOAD_SOURCE_MAPS === "1" &&
    Boolean(process.env.SENTRY_AUTH_TOKEN);

  return {
    plugins: [
      tailwindcss(),
      react(),
      ...(uploadSourcemaps
        ? [
            sentryVitePlugin({
              org: "dopedb",
              project: "dopedb-desktop",
              debug: process.env.DOPEDB_SENTRY_DEBUG === "1",
              release: { name: sentryRelease },
              sourcemaps: {
                assets: "./dist/**",
                filesToDeleteAfterUpload: ["./dist/**/*.map"],
              },
              telemetry: false,
            }),
          ]
        : []),
    ],
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
    server: {
      port: 1420,
      strictPort: true,
      host: false,
      // Cargo writes this workspace's artifacts to the repository root, and
      // Windows locks a linking DLL, so watching them fails the dev server.
      watch: {
        ignored: ["**/target/**"],
      },
    },
    worker: {
      // Vite defaults workers to IIFE output. Module output preserves worker
      // exports without requiring a global name and remains compatible with
      // the module workers created by the application.
      format: "es",
    },
    build: {
      target: "esnext",
      sourcemap: uploadSourcemaps ? "hidden" : false,
      // Mermaid's parser is one lazy, upstream-generated module (~662 kB
      // minified / ~143 kB gzip) and cannot be split at an internal module
      // boundary. Initial dependencies are independently capped below.
      chunkSizeWarningLimit: 700,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "react-vendor",
                test: /node_modules[\\/](?:react|react-dom|@tanstack[\\/]react-query)[\\/]/,
                includeDependenciesRecursively: true,
                priority: 20,
              },
              {
                name: "observability-vendor",
                test: /node_modules[\\/]@sentry[\\/]/,
                includeDependenciesRecursively: true,
                priority: 15,
              },
              {
                name: "rich-text-vendor",
                test:
                  /node_modules[\\/](?:react-markdown|remark|rehype|unified|micromark|mdast-util|hast-util|unist-util|vfile)[^\\/]*[\\/]/,
                includeDependenciesRecursively: true,
                priority: 14,
              },
            ],
          },
        },
      },
    },
  };
});
