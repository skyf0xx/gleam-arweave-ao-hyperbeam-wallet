// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Db } from "../db";
import { applyExaminedBackfill, planExaminedBackfill } from "./examined-backfill";
import { createGithubClient } from "./github";
import { createTestDb } from "../testing/test-db";
import { COMMIT, TEST_REPO, fakeGithub, functionsOf, surfaceFilesFor } from "../testing/test-github";

const GONE = "d".repeat(40);

async function attest(db: Db, n: number, commit: string, answers: { file: string; symbol: string }[]) {
  await db.query("INSERT INTO challenges (id, release, commit, functions, created_at, expires_at) VALUES ($1, '1.0.0', $2, '[]', now(), now())", [
    `c${n}`,
    commit,
  ]);
  await db.query(
    `INSERT INTO attestations (id, release, commit, challenge_id, address, owner, signature, proof, message, body, paid, created_at)
     VALUES ($1, '1.0.0', $2, $3, $4, 'o', 's', 'message', 'm', $5, true, now())`,
    [String(n).padStart(64, "0"), commit, `c${n}`, `w${n}`, JSON.stringify({ model: "x", result: "pass", report: "r", answers })],
  );
}

describe("examined_functions backfill", () => {
  it("fingerprints each answer at its attestation's commit, skips what it can't read, and writes once", async () => {
    const db = await createTestDb();
    const files = surfaceFilesFor();
    const github = fakeGithub({ "1.0.0": { commit: COMMIT, files } }, "v1.0.0");
    const client = createGithubClient({ fetchImpl: github.fetch, repo: TEST_REPO });
    await attest(db, 1, COMMIT, [
      { file: "lib/b.ts", symbol: "guardB1" },
      { file: "lib/b.ts", symbol: "gone" },
    ]);
    await attest(db, 2, GONE, [{ file: "lib/c.ts", symbol: "guardC1" }]);

    const plan = await planExaminedBackfill(db, client);
    const b1 = functionsOf(files).find((fn) => fn.symbol === "guardB1")!;
    expect(plan.rows).toEqual([{ attestationId: "1".padStart(64, "0"), file: "lib/b.ts", symbol: "guardB1", fingerprint: b1.fingerprint }]);
    expect(plan).toMatchObject({ attestations: 1, unmatched: 1 });
    expect(plan.skipped.map((s) => s.commit)).toEqual([GONE]);

    expect(await applyExaminedBackfill(db, plan)).toBe(1);
    expect(await applyExaminedBackfill(db, plan)).toBe(0);
    expect((await planExaminedBackfill(db, client)).rows).toEqual([]);
  });
});
