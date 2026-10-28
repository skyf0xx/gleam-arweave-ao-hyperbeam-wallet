#!/usr/bin/env node
// Walks a full release end to end, pausing at each step a human has to do
// (merge a PR, watch CI, upload to the Chrome Web Store) rather than trying
// to script past them.
//
//   pnpm release:all <major|minor|patch> --kdbx <path-to-keepassxc-db>
//   pnpm release:all <major|minor|patch> --key <path-to-private-key>
//
// Stages:
//   1. Bump the extension and both mobile apps (scripts/app-versions.mjs),
//      commit, push a branch, open a PR.
//      Stops here: merge it yourself (release-gate.mjs also requires
//      security/audits/v<version>.md to exist with no open critical/high
//      findings — write that first if it's missing).
//   2. Pull master, check the app versions and the invite-link host's
//      .well-known files, run scripts/release.mjs --yes (signed tag + push).
//      Confirms before tagging, since a tag CI has already built on is not
//      something to casually re-push.
//   3. Wait for you to confirm the GitHub Release (with its zip and
//      release-manifest.json) exists for that tag.
//   4. Run scripts/pack-release.sh, which re-verifies the release against
//      the manifest and a from-source rebuild, then signs a .crx with your
//      local key, unlocking the KeePassXC database if you passed --kdbx.
//      The key is never read by CI, only passed to this script.
//   5. Remind you to upload the .crx by hand; that step stays manual.
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { checkVersions, readVersions, writeVersions } from "./app-versions.mjs";
import { git, runGate } from "./release-gate.mjs";
import { checkWellKnown } from "./well-known.mjs";

const REMOTE = "origin";
const BRANCH = "master";
// A release must not ship apps whose invite and attest links cannot verify.
const WELL_KNOWN_REQUIRED = true;

/** @param {string} reason */
function refuse(reason) {
  process.stderr.write(`release:all refused: ${reason}\n`);
  process.exit(1);
}

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
/** @param {string} prompt */
async function pause(prompt) {
  await rl.question(`\n${prompt} (press enter to continue) `);
}

const args = process.argv.slice(2);
const bump = args.find((a) => ["major", "minor", "patch"].includes(a));
if (!bump) refuse('pass a bump type: "major", "minor" or "patch"');
/** @param {string} name */
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
const key = flag("--key") ?? process.env.GLEAM_CWS_KEY;
const kdbx = flag("--kdbx") ?? process.env.GLEAM_CWS_KDBX;
if (key && kdbx) refuse("both a KeePassXC database and a key file given; pass only one");
if (!key && !kdbx) refuse("no private key given: pass --kdbx <path> or --key <path>, or set GLEAM_CWS_KDBX or GLEAM_CWS_KEY");
const signWith = kdbx ? ["--kdbx", kdbx] : ["--key", /** @type {string} */ (key)];

const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
if (!top.ok) refuse("not inside a git repository");
const root = top.out;

const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
if (branch !== BRANCH) refuse(`on "${branch}"; start release:all from ${BRANCH}`);
const dirty = git(root, ["status", "--porcelain", "--untracked-files=no"]).out;
if (dirty !== "") refuse("working tree has uncommitted changes");

// --- stage 1: bump, commit, PR -------------------------------------------

const current = readVersions(root).extension;
const [maj, min, patch] = current.split(".").map(Number);
const next =
  bump === "major" ? `${maj + 1}.0.0` : bump === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${patch + 1}`;

process.stdout.write(`== Stage 1: bump ${current} -> ${next} ==\n`);
const changed = writeVersions(root, next);

const bumpBranch = `release/v${next}`;
run("git", ["checkout", "-b", bumpBranch], root);
run("git", ["add", "--", ...changed], root);
run("git", ["commit", "-m", `chore: bump version to ${next}`], root);
run("git", ["push", "-u", REMOTE, bumpBranch], root);
run(
  "gh",
  ["pr", "create", "--title", `chore: bump version to ${next}`, "--body", `Release prep for v${next}.`, "--base", BRANCH],
  root,
);

process.stdout.write(
  `\nOpened a PR for the version bump. Before merging, check security/audits/v${next}.md exists,\n` +
    "has no open critical/high findings, and audits a commit already on master —\n" +
    "release-gate.mjs refuses to tag without it.\n",
);
await pause("Merge the PR, then");

// --- stage 2: tag and push -------------------------------------------------

process.stdout.write("\n== Stage 2: tag and push ==\n");
run("git", ["checkout", BRANCH], root);
run("git", ["pull", "--ff-only", REMOTE, BRANCH], root);

const gate = runGate({ cwd: root });
if (!gate.ok) refuse(`release gate still failing after merge: ${gate.reason}`);
if (gate.version !== next) refuse(`master's version is ${gate.version}, expected ${next}`);

try {
  checkVersions(root, next);
} catch (e) {
  refuse(/** @type {Error} */ (e).message);
}

const wellKnown = await checkWellKnown();
if (wellKnown.length > 0) {
  const detail = wellKnown.map((p) => `  ${p}`).join("\n");
  if (WELL_KNOWN_REQUIRED) refuse(`invite-link .well-known files are not served correctly:\n${detail}`);
  process.stdout.write(`WARNING: invite-link .well-known files are not served correctly:\n${detail}\n`);
}

process.stdout.write(`about to create signed tag v${next} and push it to ${REMOTE}\n`);
await pause(`Confirm you want to tag and push v${next},`);
run("node", ["scripts/release.mjs", "--yes"], root);

// --- stage 3: wait for the GitHub Release -----------------------------------

process.stdout.write("\n== Stage 3: CI build ==\n");
process.stdout.write(`release.yml is now building and attesting v${next} from the pushed tag.\n`);
await pause(`Watch it finish, confirm the GitHub Release for v${next} has its zip and release-manifest.json, then`);

// --- stage 4: pack and sign -------------------------------------------------

// Readline keeps the terminal in raw mode while open, which would swallow the
// Enter on keepassxc-cli's password prompt.
rl.close();
process.stdout.write("\n== Stage 4: verify and sign ==\n");
run("scripts/pack-release.sh", [`v${next}`, ...signWith], root);

// --- stage 5: upload ---------------------------------------------------------

process.stdout.write(
  `\n== Stage 5 ==\nUpload ${root}/v${next}.crx to the Chrome Web Store Developer Dashboard.\n` +
    "That step stays manual: no store credentials live in this script or in CI.\n",
);
