#!/usr/bin/env node
// @ts-check
// Checks the built extension (after `pnpm wxt:build`):
// - the keyring page, which holds unlocked keys, loads only key code;
// - the background worker and every other extension page pull in only the
//   npm packages listed per entry in BUNDLE_PACKAGES, and their lazy chunks
//   only those in LAZY_PACKAGES;
// - provider.js (run in every page's world) and the content script
//   (injected into every page) stay within their size budgets and pull in
//   no npm package beyond the ones listed here;
// - every other built script is either in one of those closures or a
//   listed worker script (Vite emits each `new Worker()` entry as an
//   asset, so no module map describes it); an unaccounted script fails
//   the check, and a listed worker stays within its size budget.
// Reads the chunk-to-module map `apps/extension/build-plugins.ts` writes.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

/** Modules the keyring page may load, as repo-relative paths or virtual ids. */
export const KEYRING_ALLOWED = [
  /^apps\/extension\/(entrypoints|src)\/keyring\//,
  /^packages\/core\/src\/signer\//,
  /^packages\/core\/src\/vault\/(base64|signer|message-signing)\.ts$/,
  /^packages\/core\/src\/(models|ports)\//,
  /^packages\/messaging\/src\/keyring-protocol\.ts$/,
  // Argon2id for the vault envelope.
  /node_modules\/hash-wasm\//,
  // `browser.runtime`, a re-export of the `chrome` global.
  /node_modules\/wxt\/dist\/browser\.mjs$/,
  /node_modules\/@wxt-dev\/browser\//,
  /^\0?virtual:wxt-(html-)?plugins\?entrypoint=keyring$/,
  /^\0rolldown\/runtime/,
];

/**
 * Each page-injected file's size budget and the npm packages it may contain.
 * @type {Record<string, { maxBytes: number, packages: string[] }>}
 */
export const PAGE_SCRIPTS = {
  "provider.js": { maxBytes: 16 * 1024, packages: ["wxt"] },
  "content-scripts/content.js": {
    maxBytes: 12 * 1024,
    packages: ["wxt", "@wxt-dev/browser", "@webext-core/messaging", "@aklinker1/zero-serialize-error"],
  },
};

/**
 * The npm packages each other built entry may contain: the background worker
 * (dispatcher, signing) and every page that renders what a user approves or
 * sees, up front: a chunk it loads through `import()` has its own list in
 * LAZY_PACKAGES. Adding a package is a reviewed change to this file. A package
 * that no longer appears fails the check too, so a list never holds more than
 * the bundle does.
 */
const POPUP_PACKAGES = [
  "@aklinker1/zero-serialize-error",
  "@dicebear/core",
  "@dicebear/styles",
  "@radix-ui/primitive",
  "@radix-ui/react-compose-refs",
  "@radix-ui/react-context",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dismissable-layer",
  "@radix-ui/react-focus-guards",
  "@radix-ui/react-focus-scope",
  "@radix-ui/react-id",
  "@radix-ui/react-portal",
  "@radix-ui/react-presence",
  "@radix-ui/react-primitive",
  "@radix-ui/react-slot",
  "@radix-ui/react-use-callback-ref",
  "@radix-ui/react-use-controllable-state",
  "@radix-ui/react-use-effect-event",
  "@radix-ui/react-use-layout-effect",
  "@tanstack/query-core",
  "@tanstack/query-persist-client-core",
  "@tanstack/react-query",
  "@webext-core/messaging",
  "@wxt-dev/browser",
  "aria-hidden",
  "arweave",
  "bignumber.js",
  "class-variance-authority",
  "clsx",
  "flag-icons",
  "get-nonce",
  "qr-code-styling",
  "react",
  "react-dom",
  "react-remove-scroll",
  "react-remove-scroll-bar",
  "react-style-singleton",
  "scheduler",
  "tailwind-merge",
  "tslib",
  "use-callback-ref",
  "use-sidecar",
  "vaul",
  "vite-plugin-node-polyfills",
  "wxt",
  "zod",
];

/** @type {Record<string, string[]>} */
export const BUNDLE_PACKAGES = {
  "background.js": [
    "@aklinker1/zero-serialize-error",
    "@webext-core/messaging",
    "@wxt-dev/browser",
    "@wxt-dev/storage",
    "arweave",
    "bignumber.js",
    "hash-wasm",
    "superlock",
    "vite-plugin-node-polyfills",
    "wxt",
    "zod",
  ],
  "approval.html": [
    "@aklinker1/zero-serialize-error",
    "@dicebear/core",
    "@dicebear/styles",
    "@radix-ui/primitive",
    "@radix-ui/react-compose-refs",
    "@radix-ui/react-context",
    "@radix-ui/react-dialog",
    "@radix-ui/react-dismissable-layer",
    "@radix-ui/react-focus-guards",
    "@radix-ui/react-focus-scope",
    "@radix-ui/react-id",
    "@radix-ui/react-portal",
    "@radix-ui/react-presence",
    "@radix-ui/react-primitive",
    "@radix-ui/react-slot",
    "@radix-ui/react-use-callback-ref",
    "@radix-ui/react-use-controllable-state",
    "@radix-ui/react-use-effect-event",
    "@radix-ui/react-use-layout-effect",
    "@tanstack/query-core",
    "@tanstack/react-query",
    "@webext-core/messaging",
    "@wxt-dev/browser",
    "aria-hidden",
    "arweave",
    "bignumber.js",
    "class-variance-authority",
    "clsx",
    "get-nonce",
    "qr-code-styling",
    "react",
    "react-dom",
    "react-remove-scroll",
    "react-remove-scroll-bar",
    "react-style-singleton",
    "scheduler",
    "tailwind-merge",
    "tslib",
    "use-callback-ref",
    "use-sidecar",
    "vaul",
    "vite-plugin-node-polyfills",
    "wxt",
    "zod",
  ],
  "connect.html": [
    "@aklinker1/zero-serialize-error",
    "@keystonehq/alias-sampling",
    "@keystonehq/bc-ur-registry",
    "@keystonehq/bc-ur-registry-arweave",
    "@ngraveio/bc-ur",
    "@radix-ui/react-compose-refs",
    "@radix-ui/react-slot",
    "@webext-core/messaging",
    "@wxt-dev/browser",
    "arweave",
    "assert",
    "available-typed-arrays",
    "base-x",
    "base64-js",
    "bignumber.js",
    "bs58",
    "bs58check",
    "buffer",
    "call-bind",
    "call-bind-apply-helpers",
    "call-bound",
    "cbor-sync",
    "cipher-base",
    "class-variance-authority",
    "clsx",
    "core-util-is",
    "crc",
    "create-hash",
    "define-data-property",
    "define-properties",
    "dunder-proto",
    "es-define-property",
    "es-errors",
    "es-object-atoms",
    "events",
    "for-each",
    "generator-function",
    "get-intrinsic",
    "get-proto",
    "gopd",
    "has-property-descriptors",
    "has-symbols",
    "has-tostringtag",
    "hash-base",
    "hasown",
    "ieee754",
    "inherits",
    "is-arguments",
    "is-callable",
    "is-generator-function",
    "is-nan",
    "is-regex",
    "is-typed-array",
    "isarray",
    "jsbi",
    "jsqr",
    "math-intrinsics",
    "md5.js",
    "object-is",
    "object-keys",
    "object.assign",
    "possible-typed-array-names",
    "process-nextick-args",
    "qrcode-generator",
    "react",
    "react-dom",
    "readable-stream",
    "ripemd160",
    "safe-buffer",
    "safe-regex-test",
    "scheduler",
    "set-function-length",
    "sha.js",
    "stream-browserify",
    "string_decoder",
    "tailwind-merge",
    "to-buffer",
    "tslib",
    "typed-array-buffer",
    "util",
    "util-deprecate",
    "uuid",
    "vite-plugin-node-polyfills",
    "which-typed-array",
    "wxt",
  ],
  "passkey.html": [
    "@aklinker1/zero-serialize-error",
    "@dicebear/core",
    "@dicebear/styles",
    "@radix-ui/react-compose-refs",
    "@radix-ui/react-slot",
    "@webext-core/messaging",
    "@wxt-dev/browser",
    "arweave",
    "bignumber.js",
    "class-variance-authority",
    "clsx",
    "react",
    "react-dom",
    "scheduler",
    "tailwind-merge",
    "tslib",
    "vite-plugin-node-polyfills",
    "wxt",
  ],
  "popup.html": POPUP_PACKAGES,
  "sidepanel.html": POPUP_PACKAGES,
};

/**
 * Chunks an entry loads only through a dynamic `import()`, each named by a
 * module it holds, with the npm packages it adds beyond what the entry
 * loads up front. The entry's own list in BUNDLE_PACKAGES covers only that
 * eager part, so a lazy chunk that becomes eager fails the check.
 * @type {Record<string, Record<string, string[]>>}
 */
export const LAZY_PACKAGES = {
  "approval.html": {
    // The Keystone panel, loaded the first time a Keystone wallet signs.
    "apps/extension/src/hardware/panels/keystone.ts": [
      "@keystonehq/alias-sampling",
      "@keystonehq/bc-ur-registry",
      "@keystonehq/bc-ur-registry-arweave",
      "@ngraveio/bc-ur",
      "assert",
      "available-typed-arrays",
      "base-x",
      "base64-js",
      "bs58",
      "bs58check",
      "buffer",
      "call-bind",
      "call-bind-apply-helpers",
      "call-bound",
      "cbor-sync",
      "cipher-base",
      "core-util-is",
      "crc",
      "create-hash",
      "define-data-property",
      "define-properties",
      "dunder-proto",
      "es-define-property",
      "es-errors",
      "es-object-atoms",
      "events",
      "for-each",
      "generator-function",
      "get-intrinsic",
      "get-proto",
      "gopd",
      "has-property-descriptors",
      "has-symbols",
      "has-tostringtag",
      "hash-base",
      "hasown",
      "ieee754",
      "inherits",
      "is-arguments",
      "is-callable",
      "is-generator-function",
      "is-nan",
      "is-regex",
      "is-typed-array",
      "isarray",
      "jsbi",
      "jsqr",
      "math-intrinsics",
      "md5.js",
      "object-is",
      "object-keys",
      "object.assign",
      "possible-typed-array-names",
      "process-nextick-args",
      "qrcode-generator",
      "readable-stream",
      "ripemd160",
      "safe-buffer",
      "safe-regex-test",
      "set-function-length",
      "sha.js",
      "stream-browserify",
      "string_decoder",
      "to-buffer",
      "typed-array-buffer",
      "util",
      "util-deprecate",
      "uuid",
      "which-typed-array",
    ],
  },
};

/**
 * Built worker scripts, by file pattern (`*` matches the content hash
 * Vite appends). Each `new Worker()` entry lands in the bundle as an
 * asset, not a chunk, so `recordBundleModules` writes no module map for
 * it and the package checks above never see it; naming it here, with a
 * size budget, is what brings it under the gate. A pattern that matches
 * nothing fails the check too, so the list never holds more than the
 * bundle does.
 * @type {Record<string, { maxBytes: number }>}
 */
export const WORKER_SCRIPTS = {
  // The seed-phrase key derivation worker: node-forge's prime search.
  "assets/phrase-key.worker-*.js": { maxBytes: 400 * 1024 },
};

/**
 * The worker pattern a built file matches, or null.
 * @param {string} fileName
 * @returns {string | null}
 */
export function workerPatternOf(fileName) {
  for (const pattern of Object.keys(WORKER_SCRIPTS)) {
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
    if (regex.test(fileName)) return pattern;
  }
  return null;
}

/**
 * Problems with one worker script: over its size budget.
 * @param {string} fileName
 * @param {number} bytes
 */
export function workerScriptProblems(fileName, bytes) {
  const pattern = workerPatternOf(fileName);
  if (pattern === null) return [];
  const { maxBytes } = WORKER_SCRIPTS[pattern];
  return bytes > maxBytes ? [`${fileName} is ${bytes} bytes, over its ${maxBytes}-byte budget`] : [];
}

/**
 * Problems with built scripts no checked closure loads and no worker
 * pattern names.
 * @param {string[]} builtFiles output-relative .js files
 * @param {ReadonlySet<string>} covered files a checked closure loads
 */
export function uncoveredScriptProblems(builtFiles, covered) {
  return builtFiles
    .filter((fileName) => !covered.has(fileName) && workerPatternOf(fileName) === null)
    .map(
      (fileName) =>
        `${fileName} is built but no checked closure loads it and no worker pattern names it; add it to the checks or to WORKER_SCRIPTS`,
    );
}

/**
 * Worker patterns that match no built file.
 * @param {string[]} builtFiles output-relative .js files
 */
export function unusedWorkerPatterns(builtFiles) {
  return Object.keys(WORKER_SCRIPTS)
    .filter((pattern) => !builtFiles.some((fileName) => workerPatternOf(fileName) === pattern))
    .map((pattern) => `no built script matches worker pattern ${pattern}; remove it from WORKER_SCRIPTS`);
}

/**
 * The npm package a module path belongs to, or null for workspace code.
 * @param {string} modulePath
 * @returns {string | null}
 */
export function packageOf(modulePath) {
  const match = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(modulePath);
  return match ? match[1] : null;
}

/**
 * Every chunk the entry loads, statically or dynamically, and the
 * modules in them. A dynamic import of a chunk in `lazy` isn't followed.
 * @param {string} entry
 * @param {Map<string, { imports: string[], dynamicImports: string[], modules: string[] }>} chunks
 * @param {ReadonlySet<string>} [lazy]
 */
export function closureOf(entry, chunks, lazy = new Set()) {
  /** @type {Set<string>} */
  const seen = new Set();
  const queue = [entry];
  /** @type {string[]} */
  const modules = [];
  while (queue.length > 0) {
    const fileName = /** @type {string} */ (queue.pop());
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    const chunk = chunks.get(fileName);
    if (!chunk) throw new Error(`no module map for ${fileName}; rebuild with pnpm wxt:build`);
    modules.push(...chunk.modules);
    queue.push(...chunk.imports, ...chunk.dynamicImports.filter((fileName) => !lazy.has(fileName)));
  }
  return { chunks: [...seen], modules };
}

/**
 * Problems with the keyring page's modules.
 * @param {string[]} modules
 */
export function keyringProblems(modules) {
  return modules
    .filter((module) => !KEYRING_ALLOWED.some((pattern) => pattern.test(module)))
    .map((module) => `keyring page loads ${JSON.stringify(module)}, which isn't key code`);
}

/**
 * Problems with the npm packages one entry contains, in both directions.
 * @param {string} entry
 * @param {string[]} modules
 */
export function entryPackageProblems(entry, modules) {
  return listProblems(entry, BUNDLE_PACKAGES[entry], packagesOf(modules));
}

/**
 * Problems with one entry's lazy chunks: one that is missing or that the
 * entry loads up front, and the npm packages each adds, in both directions.
 * @param {string} entry
 * @param {string[]} eagerModules the entry's closure, not following its lazy chunks
 * @param {Map<string, { imports: string[], dynamicImports: string[], modules: string[] }>} chunks
 */
export function lazyChunkProblems(entry, eagerModules, chunks) {
  const eager = new Set(eagerModules);
  const eagerPackages = packagesOf(eagerModules);
  /** @type {string[]} */
  const problems = [];
  for (const [module, allowed] of Object.entries(LAZY_PACKAGES[entry] ?? {})) {
    const fileName = chunkHolding(module, chunks);
    if (fileName === null) {
      problems.push(`${entry}: no chunk holds ${module}; remove it from LAZY_PACKAGES`);
    } else if (eager.has(module)) {
      problems.push(`${entry} loads ${module} up front; it must load only through import()`);
    } else {
      const added = [...packagesOf(closureOf(fileName, chunks).modules)].filter((name) => !eagerPackages.has(name));
      problems.push(...listProblems(`${entry}'s lazy ${module}`, allowed, new Set(added)));
    }
  }
  return problems;
}

/**
 * The lazy chunks an entry names, by file, for `closureOf` to stop at.
 * @param {string} entry
 * @param {Map<string, { modules: string[] }>} chunks
 */
export function lazyChunksOf(entry, chunks) {
  return new Set(
    Object.keys(LAZY_PACKAGES[entry] ?? {})
      .map((module) => chunkHolding(module, chunks))
      .filter((fileName) => fileName !== null),
  );
}

/**
 * @param {string} module
 * @param {Map<string, { modules: string[] }>} chunks
 * @returns {string | null}
 */
function chunkHolding(module, chunks) {
  for (const [fileName, chunk] of chunks) if (chunk.modules.includes(module)) return fileName;
  return null;
}

/** @param {string[]} modules */
function packagesOf(modules) {
  return new Set(/** @type {string[]} */ (modules.map(packageOf).filter((name) => name !== null)));
}

/**
 * @param {string} label
 * @param {string[]} allowed
 * @param {Set<string>} found
 */
function listProblems(label, allowed, found) {
  /** @type {string[]} */
  const problems = [];
  for (const name of [...found].sort()) {
    if (!allowed.includes(name)) problems.push(`${label} contains npm package ${name}, which isn't in its allowlist`);
  }
  for (const name of allowed) {
    if (!found.has(name)) problems.push(`${label} no longer contains ${name}; remove it from its allowlist`);
  }
  return problems;
}

/**
 * Problems with one page-injected file.
 * @param {string} fileName
 * @param {number} bytes
 * @param {string[]} modules
 */
export function pageScriptProblems(fileName, bytes, modules) {
  const { maxBytes, packages } = PAGE_SCRIPTS[fileName];
  /** @type {string[]} */
  const problems = [];
  if (bytes > maxBytes) problems.push(`${fileName} is ${bytes} bytes, over its ${maxBytes}-byte budget`);
  for (const name of new Set(modules.map(packageOf).filter((name) => name !== null))) {
    if (!packages.includes(name)) problems.push(`${fileName} contains npm package ${name}`);
  }
  return problems;
}

/**
 * The scripts an HTML entry loads.
 * @param {string} htmlPath
 */
function scriptsOf(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const scripts = [...html.matchAll(/<script[^>]*src="\/?([^"]+)"/g)].map((match) => /** @type {string} */ (match[1]));
  if (scripts.length === 0) throw new Error(`${htmlPath} loads no script`);
  return scripts;
}

function main() {
  const extension = fileURLToPath(new URL("../apps/extension/.output/", import.meta.url));
  const out = join(extension, "chrome-mv3");
  const mapDir = join(extension, "bundle-modules");
  if (!existsSync(out) || !existsSync(mapDir)) throw new Error("no build found; run pnpm wxt:build first");

  const chunks = new Map(
    readdirSync(mapDir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => JSON.parse(readFileSync(join(mapDir, name), "utf8")))
      .map((chunk) => [chunk.fileName, chunk]),
  );

  const scripts = scriptsOf(join(out, "keyring.html"));
  const keyring = scripts.map((script) => closureOf(script, chunks));
  const problems = keyringProblems(keyring.flatMap(({ modules }) => modules));

  for (const entry of Object.keys(BUNDLE_PACKAGES)) {
    const files = entry.endsWith(".html") ? scriptsOf(join(out, entry)) : [entry];
    const lazy = lazyChunksOf(entry, chunks);
    const modules = files.flatMap((file) => closureOf(file, chunks, lazy).modules);
    problems.push(...entryPackageProblems(entry, modules), ...lazyChunkProblems(entry, modules, chunks));
  }

  for (const fileName of Object.keys(PAGE_SCRIPTS)) {
    const chunk = chunks.get(fileName);
    if (!chunk) throw new Error(`no module map for ${fileName}`);
    problems.push(...pageScriptProblems(fileName, statSync(join(out, fileName)).size, chunk.modules));
  }

  // Every built script must be accounted for: in a checked closure, or a
  // listed worker. The closures above stop at lazy chunks, so recompute
  // them following every dynamic import for coverage purposes.
  const covered = new Set();
  for (const script of scripts) for (const file of closureOf(script, chunks).chunks) covered.add(file);
  for (const entry of Object.keys(BUNDLE_PACKAGES)) {
    const files = entry.endsWith(".html") ? scriptsOf(join(out, entry)) : [entry];
    for (const file of files) for (const loaded of closureOf(file, chunks).chunks) covered.add(loaded);
  }
  for (const fileName of Object.keys(PAGE_SCRIPTS)) covered.add(fileName);

  /** @type {string[]} */
  const builtFiles = [];
  const walk = (/** @type {string} */ dir, /** @type {string} */ prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (name.endsWith(".js")) builtFiles.push(`${prefix}${name}`);
    }
  };
  walk(out, "");
  for (const fileName of builtFiles) {
    if (workerPatternOf(fileName) !== null) {
      problems.push(...workerScriptProblems(fileName, statSync(join(out, fileName)).size));
    }
  }
  problems.push(...uncoveredScriptProblems(builtFiles, covered), ...unusedWorkerPatterns(builtFiles));

  const chunkCount = keyring.reduce((count, { chunks: loaded }) => count + loaded.length, 0);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`::error::${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `bundles ok: keyring loads ${chunkCount} chunk(s) of key code; ` +
      Object.keys(PAGE_SCRIPTS)
        .map((fileName) => `${fileName} ${statSync(join(out, fileName)).size} bytes`)
        .join(", ") +
      builtFiles
        .filter((fileName) => workerPatternOf(fileName) !== null)
        .map((fileName) => `; worker ${fileName} ${statSync(join(out, fileName)).size} bytes`)
        .join("") +
      "\n",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
