// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "pack-release.sh");
const TAG = "v1.2.3";
const ZIP = "gleamextension-1.2.3-chrome.zip";

let root: string;
let repo: string;
let bin: string;
let base: string;
let calls: string;
let commit: string;

function sh(cwd: string, file: string, args: string[]): string {
  return execFileSync(file, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A fake tool on PATH that appends `<name> <args>` to the calls log, then runs `body`. */
function fake(name: string, body = "exit 0"): void {
  const path = join(bin, name);
  writeFileSync(path, `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
  chmodSync(path, 0o755);
}

function publish(manifest: Record<string, string>): void {
  writeFileSync(join(base, TAG, "release-manifest.json"), JSON.stringify(manifest));
}

/** What a passing verify-release.sh run leaves behind; null removes it. */
function receipt(sha: string | null): void {
  const path = join(root, "receipts", `${TAG}.verified`);
  mkdirSync(join(root, "receipts"), { recursive: true });
  if (sha === null) rmSync(path, { force: true });
  else writeFileSync(path, `${sha}\n`);
}

function pack(env: Record<string, string> = {}) {
  writeFileSync(calls, "");
  const out = mkdtempSync(join(root, "out-"));
  const result = spawnSync("bash", [join(repo, "scripts/pack-release.sh"), TAG, "--kdbx", join(root, "db.kdbx")], {
    cwd: out,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CHROME_BIN: join(bin, "chrome"),
      GLEAM_RELEASE_BASE_URL: `file://${base}`,
      GLEAM_GH_REPO: "owner/repo",
      GLEAM_PACK_TEST: "1",
      GLEAM_RELEASE_RECEIPTS: join(root, "receipts"),
      GH_EXIT: "0",
      ...env,
    },
  });
  return { ...result, out, calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pack-release-"));
  repo = join(root, "repo");
  bin = join(root, "bin");
  base = join(root, "releases");
  calls = join(root, "calls.log");
  for (const dir of [repo, join(repo, "scripts"), join(repo, ".github"), bin, join(base, TAG)]) mkdirSync(dir, { recursive: true });

  const key = join(root, "signer");
  sh(root, "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "test", "-f", key]);
  writeFileSync(join(repo, ".github/allowed_signers"), `test@example.com namespaces="git" ${readFileSync(`${key}.pub`, "utf8")}`);
  copyFileSync(SCRIPT, join(repo, "scripts/pack-release.sh"));
  const git = (...args: string[]) =>
    sh(repo, "git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "gpg.format=ssh", "-c", `user.signingkey=${key}`, "-c", "commit.gpgsign=false", ...args]);
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  git("tag", "-s", TAG, "-m", TAG);
  commit = git("rev-parse", "HEAD");

  const stage = join(root, "stage");
  mkdirSync(stage);
  writeFileSync(join(stage, "manifest.json"), '{"name":"Gleam"}');
  sh(stage, "zip", ["-q", join(base, TAG, ZIP), "manifest.json"]);

  fake("gh", 'exit "$GH_EXIT"');
  fake("pnpm", "exit 1");
  fake("keepassxc-cli", 'echo key > "${@: -1}"');
  // chrome --pack-extension=<dir> writes <dir>.crx next to it.
  fake("chrome", 'for a in "$@"; do case "$a" in --pack-extension=*) touch "${a#--pack-extension=}.crx";; esac; done');
  writeFileSync(join(root, "db.kdbx"), "");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function goodManifest(): Record<string, string> {
  const sha = createHash("sha256").update(readFileSync(join(base, TAG, ZIP))).digest("hex");
  return { zipName: ZIP, zipSha256: sha, commit };
}

describe("pack-release.sh", () => {
  beforeEach(() => receipt(goodManifest().zipSha256!));

  it("packs the downloaded zip after the attestation passes, without running pnpm", () => {
    publish(goodManifest());
    const run = pack();
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(join(run.out, `${TAG}.crx`))).toBe(true);
    const tools = run.calls.map((call) => call.split(" ")[0]);
    expect(tools).toEqual(["gh", "keepassxc-cli", "chrome"]);
    expect(run.calls[0]).toContain(`--repo owner/repo`);
    expect(run.calls[0]).toContain(`--signer-workflow owner/repo/.github/workflows/release.yml`);
    expect(run.calls[0]).toContain(`--source-digest ${commit} --source-ref refs/tags/${TAG}`);
  });

  it("never exports the key without a local rebuild receipt", () => {
    publish(goodManifest());
    receipt(null);
    const run = pack();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("verify-release.sh");
    expect(run.calls.map((call) => call.split(" ")[0])).toEqual(["gh"]);
  });

  it("never exports the key when the local rebuild produced another zip", () => {
    publish(goodManifest());
    receipt("0".repeat(64));
    const run = pack();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("refusing to pack");
    expect(run.calls.map((call) => call.split(" ")[0])).toEqual(["gh"]);
  });

  it("never exports the key when the attestation check fails", () => {
    publish(goodManifest());
    const run = pack({ GH_EXIT: "1" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("refusing to pack");
    expect(run.calls.map((call) => call.split(" ")[0])).toEqual(["gh"]);
  });

  it("refuses a zip whose hash differs from the manifest before asking gh", () => {
    publish({ ...goodManifest(), zipSha256: "0".repeat(64) });
    const run = pack();
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
  });

  it("refuses the download overrides outside the test", () => {
    publish(goodManifest());
    const run = pack({ GLEAM_PACK_TEST: "" });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
  });

  it("refuses a manifest built from another commit", () => {
    publish({ ...goodManifest(), commit: "f".repeat(40) });
    const run = pack();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`${TAG} points to ${commit}`);
    expect(run.calls).toEqual([]);
  });
});
