#!/usr/bin/env node
// Reads, writes and checks the version of the extension and both mobile
// apps, which release from one tag.
//
//   node scripts/app-versions.mjs --check <version>
//
// apps/extension/package.json is the source of truth. The iOS marketing
// version lives in project.pbxproj (Info.plist only holds build-setting
// references) and the Android one in app/build.gradle. Both stores reject a
// build number they have already seen, so the build numbers count up by one
// per release rather than following the version.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXTENSION = "apps/extension/package.json";
const MOBILE = "apps/mobile/package.json";
const PBXPROJ = "apps/mobile/ios/App/App.xcodeproj/project.pbxproj";
const GRADLE = "apps/mobile/android/app/build.gradle";

const MARKETING = /^(\s*MARKETING_VERSION = )([^;\s]+)(;\s*)$/gm;
const BUILD = /^(\s*CURRENT_PROJECT_VERSION = )([^;\s]+)(;\s*)$/gm;
const GRADLE_CODE = /^(\s*versionCode )(\d+)(\s*)$/gm;
const GRADLE_NAME = /^(\s*versionName ")([^"]*)("\s*)$/gm;

/** @param {string} root @param {string} rel */
const read = (root, rel) => readFileSync(join(root, rel), "utf8");

/**
 * The values of every line `re` matches, which must be exactly `count`
 * and all equal, so a stray or half-edited line fails loudly.
 * @param {string} text @param {RegExp} re @param {number} count @param {string} label
 */
function uniform(text, re, count, label) {
  const values = [...text.matchAll(re)].map((m) => m[2]);
  if (values.length !== count) throw new Error(`${label}: expected ${count} line(s), found ${values.length}`);
  if (new Set(values).size !== 1) throw new Error(`${label}: lines disagree (${values.join(", ")})`);
  return values[0];
}

/** @param {string} root */
export function readVersions(root) {
  const pbx = read(root, PBXPROJ);
  const gradle = read(root, GRADLE);
  const iosBuild = uniform(pbx, BUILD, 2, "CURRENT_PROJECT_VERSION in project.pbxproj");
  const androidCode = uniform(gradle, GRADLE_CODE, 1, "versionCode in build.gradle");
  if (!/^\d+$/.test(iosBuild)) throw new Error(`CURRENT_PROJECT_VERSION is not an integer: ${iosBuild}`);
  return {
    extension: JSON.parse(read(root, EXTENSION)).version,
    mobile: JSON.parse(read(root, MOBILE)).version,
    iosMarketing: uniform(pbx, MARKETING, 2, "MARKETING_VERSION in project.pbxproj"),
    iosBuild: Number(iosBuild),
    androidName: uniform(gradle, GRADLE_NAME, 1, "versionName in build.gradle"),
    androidCode: Number(androidCode),
  };
}

/** @param {string} text @param {RegExp} re @param {string} value */
const replaceValue = (text, re, value) => text.replace(re, (_, pre, _old, post) => `${pre}${value}${post}`);

/**
 * Returns the repo-relative paths it changed.
 * @param {string} root @param {string} next
 */
export function writeVersions(root, next) {
  // Reading first validates every file before any is touched.
  const current = readVersions(root);

  for (const rel of [EXTENSION, MOBILE]) {
    const json = JSON.parse(read(root, rel));
    json.version = next;
    writeFileSync(join(root, rel), `${JSON.stringify(json, null, 2)}\n`);
  }

  let pbx = read(root, PBXPROJ);
  pbx = replaceValue(pbx, MARKETING, next);
  pbx = replaceValue(pbx, BUILD, String(current.iosBuild + 1));
  writeFileSync(join(root, PBXPROJ), pbx);

  let gradle = read(root, GRADLE);
  gradle = replaceValue(gradle, GRADLE_NAME, next);
  gradle = replaceValue(gradle, GRADLE_CODE, String(current.androidCode + 1));
  writeFileSync(join(root, GRADLE), gradle);

  return [EXTENSION, MOBILE, PBXPROJ, GRADLE];
}

/** @param {string} root @param {string} version */
export function checkVersions(root, version) {
  const v = readVersions(root);
  const wrong = /** @type {const} */ (["extension", "mobile", "iosMarketing", "androidName"])
    .filter((k) => v[k] !== version)
    .map((k) => `${k} is ${v[k]}`);
  if (wrong.length > 0) throw new Error(`versions do not match ${version}: ${wrong.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, version] = process.argv.slice(2);
  if (flag !== "--check" || !version) {
    process.stderr.write("usage: app-versions.mjs --check <version>\n");
    process.exit(2);
  }
  try {
    checkVersions(process.cwd(), version);
    process.stdout.write(`OK all app versions are ${version}\n`);
  } catch (e) {
    process.stderr.write(`FAIL ${/** @type {Error} */ (e).message}\n`);
    process.exit(1);
  }
}
