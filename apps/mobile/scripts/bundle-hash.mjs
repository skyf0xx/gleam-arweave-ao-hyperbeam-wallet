#!/usr/bin/env node
// The hash of a web bundle: sha256 over the sorted lines
// `<relative-path>\0<sha256-of-file>\n`, paths relative to the directory
// with `/` separators, sorted by UTF-16 code unit order (JavaScript's `<`).
// Empty directories and file modes are not hashed. CI writes it to
// release-manifest.json as `mobileBundleSha256`; the fastlane lanes
// recompute it before signing. Both must call this file.
//
//   node apps/mobile/scripts/bundle-hash.mjs <dir> [--exclude <relative-path>]...
//
// --exclude drops top-level files that `cap sync` adds to the native copy
// of the bundle (cordova.js, cordova_plugins.js).
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function listFiles(root, rel = "") {
  const files = [];
  for (const name of readdirSync(join(root, rel))) {
    const path = rel === "" ? name : `${rel}/${name}`;
    const stat = lstatSync(join(root, path));
    // A symlink could point outside the bundle, so it is never hashed.
    if (stat.isSymbolicLink()) throw new Error(`symlink in bundle: ${path}`);
    if (stat.isDirectory()) files.push(...listFiles(root, path));
    else if (stat.isFile()) files.push(path);
    else throw new Error(`not a regular file: ${path}`);
  }
  return files;
}

export function hashDirectory(dir, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  const paths = listFiles(dir)
    .filter((path) => !skip.has(path))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (paths.length === 0) throw new Error(`no files under ${dir}`);
  const manifest = paths.map((path) => `${path}\0${sha256(readFileSync(join(dir, path)))}\n`).join("");
  return sha256(manifest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const usage = () => {
    console.error("usage: bundle-hash.mjs <dir> [--exclude <relative-path>]...");
    process.exit(2);
  };
  const args = process.argv.slice(2);
  const exclude = [];
  let dir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--exclude" && i + 1 < args.length) exclude.push(args[++i]);
    else if (dir === null && !args[i].startsWith("-")) dir = args[i];
    else usage();
  }
  if (dir === null) usage();
  try {
    console.log(hashDirectory(dir, { exclude }));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
