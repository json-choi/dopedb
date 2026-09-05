import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";

const typedReactFiles = [
  "src/**/*.{ts,tsx}",
  "workspace-cloud/**/*.{ts,tsx}",
  "site/**/*.{ts,tsx}",
];

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/target/**",
      "graphify-out/**",
    ],
  },
  {
    files: ["scripts/benchmark-packaged-release.mjs", "scripts/benchmark/*.mjs"],
    languageOptions: {
      globals: Object.fromEntries([
        "Buffer", "process", "console", "URL", "performance",
        "setTimeout", "clearTimeout", "setInterval", "clearInterval",
      ].map((name) => [name, "readonly"])),
    },
    rules: { "no-undef": "error" },
  },
  {
    files: typedReactFiles,
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ["typescript", "jsx"] },
        },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
