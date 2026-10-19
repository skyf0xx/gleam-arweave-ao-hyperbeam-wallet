// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "./cli.ts";
import { CHALLENGE, CHALLENGE_ID, COMMIT, exists, fakeGit, json, makeDeps, readJsonFile } from "./harness.ts";
import { runStart } from "./start.ts";

describe("pnpm scan start", () => {
  it("writes the challenge and a starter attestation, and lists the functions with spans", async () => {
    const deps = makeDeps();
    const outcome = await runStart(deps);
    expect(outcome.ok).toBe(true);
    expect(readJsonFile(deps, ".gleam-scan/challenge.json")).toEqual(CHALLENGE);
    expect(readJsonFile(deps, ".gleam-scan/attestation.json")).toEqual({
      challenge: CHALLENGE_ID,
      model: "",
      answers: CHALLENGE.functions.map((fn) => ({ ...fn, line: 0, check: "" })),
      result: "pass",
      report: "",
    });
    const text = render(outcome, false);
    expect(text).toContain("pkg/a.ts  unlockVault  lines 7-17");
    expect(text).toContain("pkg/c.ts  KeySession.get  lines 34-39");
    expect(text).toContain("not your working tree");
    expect(text).toContain("Run `pnpm scan finish`");
    expect(text).toContain(CHALLENGE.expiresAt);
  });

  it("writes nothing and says how to check out the release when HEAD differs", async () => {
    const deps = makeDeps({ git: fakeGit({ head: "d".repeat(40) }) });
    const outcome = await runStart(deps);
    expect(outcome.ok).toBe(false);
    expect(render(outcome, false)).toBe(
      "✗ git: HEAD is ddddddd but the latest release is v1.4.0 (ccccccc); run `git fetch --tags && git checkout v1.4.0 && pnpm install --frozen-lockfile`, then `pnpm scan start` again.",
    );
    expect(exists(deps, ".gleam-scan")).toBe(false);
  });

  it("reports server errors by code, with the server's sentence", async () => {
    const deps = makeDeps({
      fetchImpl: (async () => json({ error: "Gleam hasn't published a release yet.", code: "no_release", issues: [{ code: "no_release", path: "release", message: "Gleam hasn't published a release yet." }] }, 404)) as typeof fetch,
    });
    expect(render(await runStart(deps), false)).toBe("✗ release: Gleam hasn't published a release yet.");

    const down = makeDeps({ fetchImpl: (async () => json({ error: "Too many scan requests; try again in about 5 minutes.", code: "rate_limited" }, 429, { "Retry-After": "300" })) as typeof fetch });
    expect(render(await runStart(down), false)).toBe(
      "✗ rate_limited: The points API is rate limiting this address; wait 300 seconds, then run `pnpm scan start` again.",
    );
    const unreachable = makeDeps({ fetchImpl: (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as typeof fetch });
    expect(render(await runStart(unreachable), false)).toBe(
      "✗ network: Couldn't reach https://api.test (getaddrinfo ENOTFOUND); check the connection and run `pnpm scan start` again.",
    );
    const github = makeDeps({ fetchImpl: (async () => json({ error: "Gleam couldn't read the release from GitHub; run the command again in a minute.", code: "github_unavailable" }, 503)) as typeof fetch });
    expect(render(await runStart(github), false)).toContain("github_unavailable: Gleam couldn't read the release");
  });

  it("keeps an attestation for the same challenge", async () => {
    const deps = makeDeps();
    mkdirSync(join(deps.root, ".gleam-scan"));
    const mine = JSON.stringify({ challenge: CHALLENGE_ID, model: "mine" });
    writeFileSync(join(deps.root, ".gleam-scan/attestation.json"), mine);
    const outcome = await runStart(deps);
    expect(outcome.ok).toBe(true);
    expect(readJsonFile(deps, ".gleam-scan/attestation.json")).toEqual({ challenge: CHALLENGE_ID, model: "mine" });
    expect(render(outcome, false)).toContain("Kept your .gleam-scan/attestation.json.");
  });

  it("backs up an attestation for another challenge before writing a fresh one", async () => {
    const deps = makeDeps();
    mkdirSync(join(deps.root, ".gleam-scan"));
    const old = "O".repeat(22);
    writeFileSync(join(deps.root, ".gleam-scan/attestation.json"), JSON.stringify({ challenge: old, model: "old" }));
    const outcome = await runStart(deps);
    expect(readJsonFile(deps, `.gleam-scan/attestation.${old}.json`)).toEqual({ challenge: old, model: "old" });
    expect((readJsonFile(deps, ".gleam-scan/attestation.json") as { challenge: string }).challenge).toBe(CHALLENGE_ID);
    expect(render(outcome, false)).toContain(`Backed up the previous .gleam-scan/attestation.json to .gleam-scan/attestation.${old}.json.`);
  });

  it("fails when the challenge names a function the commit lacks", async () => {
    const deps = makeDeps({ git: fakeGit({ files: { "pkg/a.ts": "const x = 1;\n", "pkg/b.ts": "", "pkg/c.ts": "" } }) });
    const outcome = await runStart(deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.issues[0]!.message).toContain(`isn't in pkg/a.ts at ${COMMIT.slice(0, 7)}`);
    expect(exists(deps, ".gleam-scan")).toBe(false);
  });

  it("tells apart a missing route, a server error and an unexplained 4xx when there is no code", async () => {
    const reply = (status: number, body?: string) =>
      makeDeps({ fetchImpl: (async () => new Response(body ?? "<html>Not Found</html>", { status })) as typeof fetch });
    expect(render(await runStart(reply(404)), false)).toBe(
      "✗ http_404: https://api.test has no /scan/challenge endpoint; community scans may not be live on this server yet. Check https://gleamwallet.app/scan.html, or set GLEAM_POINTS_API.",
    );
    expect(render(await runStart(reply(404, '{"error":"Not found"}')), false)).toContain("has no /scan/challenge endpoint");
    expect(render(await runStart(reply(502)), false)).toBe(
      "✗ http_502: The points API had a server error (502); wait a few minutes, then run `pnpm scan start` again.",
    );
    expect(render(await runStart(reply(418)), false)).toBe(
      "✗ http_418: The points API answered 418 with no explanation; tell the user, since this is a bug to report.",
    );
  });
});
