#!/usr/bin/env node
// Release gate: a version may be tagged only when security/audits/v<version>.md
// exists and no security-surface file changed after the commit it audited.
// Plain .mjs with JSDoc so it runs on bare Node with no build step.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { surfacePaths } from "../security/surface.mjs";

export const VERSION_FILE = "apps/extension/package.json";
export const SURFACE_FILE = "security/surface.txt";
export const AUDITS_DIR = "security/audits";

const SHA = /^[0-9a-f]{40}$/;
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const STATUSES = ["fixed", "accepted", "open"];
const BLOCKING = ["critical", "high"];

/**
 * @typedef {{ version: string, commit: string, previous: string, date: string, reviewers: string[] }} AuditMeta
 * @typedef {{ id: string, severity: string, summary: string, status: string }} Finding
 * @typedef {{ ok: true, version: string, commit: string } | { ok: false, reason: string, details?: string[] }} GateResult
 */

/** @param {string} raw */
function unquote(raw) {
  const value = raw.trim();
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  return quoted ? quoted[1] : value;
}

/**
 * Parses a `[a, "b, c"]` list; commas inside quotes stay in the item.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseList(raw) {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  const items = inner.match(/"[^"]*"|'[^']*'|[^,\s][^,]*/g) ?? [];
  return items.map(unquote).filter((item) => item !== "");
}

/**
 * Reads the `---`-fenced frontmatter at the top of an audit file. Only the
 * flat `key: value` and `key: [list]` forms the template uses are supported.
 * @param {string} text
 * @returns {{ meta: AuditMeta, body: string }}
 * @throws {Error} when the fence or a required key is missing
 */
export function parseFrontmatter(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new Error("audit file has no frontmatter (first line must be ---)");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("audit frontmatter is not closed with ---");

  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`unreadable frontmatter line: "${line}"`);
    fields[match[1]] = match[2];
  }

  for (const key of ["version", "commit", "previous", "date", "reviewers"]) {
    if (!fields[key]?.trim()) throw new Error(`audit frontmatter is missing "${key}"`);
  }

  return {
    meta: {
      version: unquote(fields.version),
      commit: unquote(fields.commit),
      previous: unquote(fields.previous),
      date: unquote(fields.date),
      reviewers: parseList(fields.reviewers),
    },
    body: lines.slice(end + 1).join("\n"),
  };
}

/**
 * Reads the markdown table under the `## Findings` heading. Columns are found
 * by header name, so their order doesn't matter.
 * @param {string} body
 * @returns {Finding[]}
 * @throws {Error} on a missing column or an unknown severity or status
 */
export function parseFindings(body) {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^##\s+Findings\s*$/i.test(line.trim()));
  if (start === -1) throw new Error('audit file has no "## Findings" section');

  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line.trim())) break;
    if (line.trim().startsWith("|")) rows.push(line.trim());
  }
  if (rows.length === 0) return [];

  const cells = (/** @type {string} */ row) =>
    row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const header = cells(rows[0]).map((cell) => cell.toLowerCase());
  const column = (/** @type {string} */ name) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`findings table has no "${name}" column`);
    return index;
  };
  const cols = { id: column("id"), severity: column("severity"), summary: column("summary"), status: column("status") };

  return rows
    .slice(1)
    .filter((row) => !/^\|?[\s:|-]+\|?$/.test(row))
    .map((row) => {
      const c = cells(row);
      const finding = {
        id: c[cols.id] ?? "",
        severity: (c[cols.severity] ?? "").toLowerCase(),
        summary: c[cols.summary] ?? "",
        status: (c[cols.status] ?? "").toLowerCase(),
      };
      // An unknown value fails loudly, so a typo can't hide an open finding.
      if (!SEVERITIES.includes(finding.severity)) {
        throw new Error(`finding ${finding.id || "(no id)"} has unknown severity "${finding.severity}"`);
      }
      if (!STATUSES.includes(finding.status)) {
        throw new Error(`finding ${finding.id || "(no id)"} has unknown status "${finding.status}"`);
      }
      return finding;
    });
}

/**
 * @param {Finding[]} findings
 * @returns {Finding[]} open findings that block a release
 */
export function blockingFindings(findings) {
  return findings.filter((f) => f.status === "open" && BLOCKING.includes(f.severity));
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {{ ok: boolean, out: string }}
 */
export function git(cwd, args) {
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out: out.trim() };
  } catch (error) {
    const stderr = /** @type {{ stderr?: string }} */ (error).stderr;
    return { ok: false, out: String(stderr ?? "").trim() };
  }
}

/**
 * @param {string} root
 * @returns {string}
 */
export function readVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, VERSION_FILE), "utf8"));
  if (typeof pkg.version !== "string" || pkg.version === "") throw new Error(`${VERSION_FILE} has no version`);
  return pkg.version;
}

/**
 * Runs every check against the repo at `cwd` and stops at the first failure.
 * @param {{ cwd?: string }} [options]
 * @returns {GateResult}
 */
export function runGate({ cwd = process.cwd() } = {}) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { ok: false, reason: `not a git repository: ${cwd}` };
  const root = top.out;

  let version;
  try {
    version = readVersion(root);
  } catch (error) {
    return { ok: false, reason: /** @type {Error} */ (error).message };
  }

  const auditPath = `${AUDITS_DIR}/v${version}.md`;
  if (!existsSync(join(root, auditPath))) {
    return { ok: false, reason: `no audit for v${version}: ${auditPath} does not exist` };
  }

  let meta, findings;
  try {
    const parsed = parseFrontmatter(readFileSync(join(root, auditPath), "utf8"));
    meta = parsed.meta;
    findings = parseFindings(parsed.body);
  } catch (error) {
    return { ok: false, reason: `${auditPath}: ${/** @type {Error} */ (error).message}` };
  }

  if (meta.version !== version) {
    return { ok: false, reason: `${auditPath} says version ${meta.version}, but ${VERSION_FILE} is ${version}` };
  }
  if (!SHA.test(meta.commit)) {
    return { ok: false, reason: `${auditPath}: commit "${meta.commit}" is not a full 40-character sha` };
  }
  if (meta.previous !== "none" && !SHA.test(meta.previous)) {
    return { ok: false, reason: `${auditPath}: previous "${meta.previous}" is neither "none" nor a full sha` };
  }
  if (!git(root, ["cat-file", "-e", `${meta.commit}^{commit}`]).ok) {
    return { ok: false, reason: `audited commit ${meta.commit} does not exist in this repository` };
  }
  if (!git(root, ["merge-base", "--is-ancestor", meta.commit, "HEAD"]).ok) {
    return { ok: false, reason: `audited commit ${meta.commit} is not an ancestor of HEAD` };
  }

  // The union of the audited and current lists, so dropping a path from
  // surface.txt doesn't take that path's changes out of the comparison.
  let paths;
  try {
    const current = surfacePaths(readFileSync(join(root, SURFACE_FILE), "utf8"));
    const then = git(root, ["show", `${meta.commit}:${SURFACE_FILE}`]);
    const audited = then.ok ? surfacePaths(then.out) : [];
    paths = [...new Set([SURFACE_FILE, ...audited, ...current])];
  } catch (error) {
    return { ok: false, reason: `${SURFACE_FILE}: ${/** @type {Error} */ (error).message}` };
  }

  const diff = git(root, ["diff", "--name-only", meta.commit, "HEAD", "--", ...paths]);
  if (!diff.ok) return { ok: false, reason: `git diff failed: ${diff.out}` };
  if (diff.out !== "") {
    const changed = diff.out.split("\n");
    return {
      ok: false,
      reason: `${changed.length} security-surface file(s) changed since the audited commit ${meta.commit.slice(0, 12)}`,
      details: changed,
    };
  }

  const blocking = blockingFindings(findings);
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: `${auditPath} has ${blocking.length} open critical/high finding(s)`,
      details: blocking.map((f) => `${f.id} [${f.severity}] ${f.summary}`),
    };
  }

  return { ok: true, version, commit: meta.commit };
}

/**
 * @param {GateResult} result
 */
export function printGate(result) {
  if (result.ok) {
    process.stdout.write(`release gate passed: v${result.version} audited at ${result.commit.slice(0, 12)}\n`);
    return;
  }
  process.stderr.write(`release gate failed: ${result.reason}\n`);
  for (const line of result.details ?? []) process.stderr.write(`  ${line}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runGate();
  printGate(result);
  process.exit(result.ok ? 0 : 1);
}
