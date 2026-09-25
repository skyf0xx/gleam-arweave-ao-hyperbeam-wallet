// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Root ESLint flat config (repo-wide lint plus the import-boundary rule
 * below; ESLint 9 reads flat config by default, not `.eslintrc.cjs`).
 *
 * The import-boundary rule enforces CLAUDE.md's hexagonal constraint:
 * `packages/core` never imports an adapter, and popup-side UI code never
 * imports background-adapter code directly — every cross-context call
 * crosses `packages/messaging`.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/core/src",
              from: "./apps/extension/src/adapters",
              message:
                "packages/core must not import an adapter directly — adapters are wired at the extension's entrypoints, per core-design.md's ports/adapters split.",
            },
          ],
        },
      ],
    },
  },
  {
    // The static site's vanilla script runs in the browser; `globals` isn't
    // resolvable from the root, so the handful it uses are listed here.
    files: ["apps/site/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        IntersectionObserver: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
