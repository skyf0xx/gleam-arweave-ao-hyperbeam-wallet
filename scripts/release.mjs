#!/usr/bin/env node
// Tags a release: checks the branch, tree and remote, runs the release gate,
// then creates a signed annotated tag v<version> and pushes only that tag.
// Dry run unless --yes is passed.

import { execFileSync } from "node:child_process";
import process from "node:process";
import { git, printGate, runGate } from "./release-gate.mjs";

const BRANCH = "master";
const REMOTE = "origin";

/** @param {string} reason */
function refuse(reason) {
  process.stderr.write(`release refused: ${reason}\n`);
  process.exit(1);
}

const confirmed = process.argv.slice(2).includes("--yes");

const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
if (!top.ok) refuse("not inside a git repository");
const root = top.out;

const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
if (branch !== BRANCH) refuse(`on "${branch}", releases are tagged from ${BRANCH}`);

// Untracked files can't end up in the tagged commit, so they don't block.
const dirty = git(root, ["status", "--porcelain", "--untracked-files=no"]).out;
if (dirty !== "") refuse("working tree has uncommitted changes");

const fetched = git(root, ["fetch", "--quiet", REMOTE, BRANCH]);
if (!fetched.ok) refuse(`could not fetch ${REMOTE}/${BRANCH}: ${fetched.out}`);
const head = git(root, ["rev-parse", "HEAD"]).out;
const upstream = git(root, ["rev-parse", `${REMOTE}/${BRANCH}`]).out;
if (head !== upstream) refuse(`HEAD ${head.slice(0, 12)} is not ${REMOTE}/${BRANCH} ${upstream.slice(0, 12)}`);

const result = runGate({ cwd: root });
printGate(result);
if (!result.ok) process.exit(1);

const tag = `v${result.version}`;
if (git(root, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).ok) refuse(`tag ${tag} already exists locally`);
const remoteTag = git(root, ["ls-remote", "--tags", REMOTE, `refs/tags/${tag}`]);
if (!remoteTag.ok) refuse(`could not list ${REMOTE} tags: ${remoteTag.out}`);
if (remoteTag.out !== "") refuse(`tag ${tag} already exists on ${REMOTE}`);

process.stdout.write(`will create signed tag ${tag} at ${head.slice(0, 12)} and push it to ${REMOTE}\n`);
if (!confirmed) {
  process.stdout.write("dry run: pass --yes to tag and push\n");
  process.exit(0);
}

// Inherit stdio so the signing prompt and push output reach the terminal.
execFileSync("git", ["tag", "-s", tag, "-m", `Gleam ${tag}`], { cwd: root, stdio: "inherit" });
execFileSync("git", ["push", REMOTE, `refs/tags/${tag}`], { cwd: root, stdio: "inherit" });
process.stdout.write(`released ${tag}\n`);
