#!/usr/bin/env node
// Checks, before anything is signed, that the web bundle inside a native
// project is the one CI published for the tag.
//
//   node apps/mobile/scripts/verify-bundle.mjs <tag> <native-public-dir>
//
// 1. hash(apps/mobile/dist) must equal `mobileBundleSha256` in the tag's
//    release-manifest.json (fetched like scripts/verify-release.sh does);
// 2. hash(<native-public-dir>) must equal hash(dist), so `cap sync` copied
//    exactly the bundle that was checked.
//
// GLEAM_ALLOW_UNVERIFIED_BUNDLE=1 skips step 1 only, for a release whose
// manifest has no `mobileBundleSha256`. Step 2 always runs.
// GLEAM_RELEASE_BASE_URL overrides the download base, as in verify-release.sh.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { hashDirectory } from "./bundle-hash.mjs";

const BASE_URL =
  process.env.GLEAM_RELEASE_BASE_URL ?? "https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/download";
// `cap sync` adds these two files next to the copied bundle.
const SYNC_ADDED = ["cordova.js", "cordova_plugins.js"];

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

const [tag, nativeDir] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "") || !nativeDir) {
  console.error("usage: verify-bundle.mjs v<major>.<minor>.<patch> <native-public-dir>");
  process.exit(2);
}

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
for (const dir of [dist, nativeDir]) {
  if (!existsSync(dir)) fail(`${dir} does not exist; run the prepare lane first`);
}
const distHash = hashDirectory(dist);

if (process.env.GLEAM_ALLOW_UNVERIFIED_BUNDLE === "1") {
  console.warn("WARNING: GLEAM_ALLOW_UNVERIFIED_BUNDLE=1, so the bundle is NOT compared with the release manifest.");
} else {
  let manifest;
  try {
    const body = execFileSync("curl", ["-fsSL", "--proto", "=https,file", `${BASE_URL}/${tag}/release-manifest.json`], {
      encoding: "utf8",
    });
    manifest = JSON.parse(body);
  } catch (err) {
    fail(`could not fetch or parse release-manifest.json for ${tag}: ${err.message}`);
  }
  if (manifest.tag !== tag) fail(`manifest is for ${manifest.tag}, not ${tag}`);
  if (typeof manifest.mobileBundleSha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.mobileBundleSha256)) {
    fail(`release-manifest.json for ${tag} has no mobileBundleSha256`);
  }
  if (manifest.mobileBundleSha256 !== distHash) {
    fail(`dist hash ${distHash} differs from the manifest's ${manifest.mobileBundleSha256}`);
  }
  console.log(`PASS dist matches the manifest (${distHash})`);
}

const nativeHash = hashDirectory(join(nativeDir), { exclude: SYNC_ADDED });
if (nativeHash !== distHash) fail(`${nativeDir} hash ${nativeHash} differs from dist ${distHash}; run the prepare lane`);
console.log(`PASS ${nativeDir} matches dist`);
