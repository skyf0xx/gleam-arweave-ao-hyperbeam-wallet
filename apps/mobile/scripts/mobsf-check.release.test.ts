// @vitest-environment node
import { describe, expect, it } from "vitest";
import baseline from "../mobsf-baseline.json";
import { compareWithBaseline, gatedFindings } from "./mobsf-check.mjs";

describe("gatedFindings", () => {
  it("keeps high and warning findings and drops the rest", () => {
    const scorecard = {
      security_score: 54,
      high: [{ title: "a" }],
      warning: [{ title: "b" }],
      info: [{ title: "c" }],
      secure: [{ title: "d" }],
    };
    expect(gatedFindings(scorecard)).toEqual([
      { severity: "high", title: "a" },
      { severity: "warning", title: "b" },
    ]);
  });
});

describe("compareWithBaseline", () => {
  it("reports a finding outside the baseline", () => {
    const { added } = compareWithBaseline(
      [
        { severity: "warning", title: "known" },
        { severity: "high", title: "new" },
      ],
      [{ severity: "warning", title: "known" }],
    );
    expect(added).toEqual([{ severity: "high", title: "new" }]);
  });

  it("treats a known title at a higher severity as new", () => {
    const { added } = compareWithBaseline(
      [{ severity: "high", title: "known" }],
      [{ severity: "warning", title: "known" }],
    );
    expect(added).toHaveLength(1);
  });

  it("lists baseline entries MobSF no longer reports", () => {
    const { added, gone } = compareWithBaseline([], [{ severity: "warning", title: "fixed" }]);
    expect(added).toEqual([]);
    expect(gone).toEqual([{ severity: "warning", title: "fixed" }]);
  });
});

describe("mobsf-baseline.json", () => {
  it("gives every accepted finding a reason", () => {
    for (const rows of Object.values(baseline)) {
      for (const row of rows) expect(row.why.length, row.title).toBeGreaterThan(10);
    }
  });
});
