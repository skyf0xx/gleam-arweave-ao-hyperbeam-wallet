// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Root ESLint flat config.
 *
 * `.hedgehog/core.yaml`'s scaffold layer names `.eslintrc.cjs`, the
 * legacy config format — ESLint 9 (the current release as of this
 * bootstrap) only reads flat config by default, so this is written as
 * `eslint.config.js` instead. Same role (repo-wide lint, the
 * import-boundary rule below), current tool shape; see
 * `hedgehog-bootstrap-authored-core`'s Step 4 on reconciling generator
 * drift against a locked `core.yaml`.
 *
 * The import-boundary rule enforces core-design.md's hexagonal
 * constraint: `packages/core` never imports an adapter, and popup-side
 * UI code never imports background-adapter code directly — every
 * cross-context call crosses `packages/messaging`.
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
);
