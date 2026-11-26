// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchScorecardScore, readmeWithBadges } from "./readme-badges.mjs";

const README = [
  "[![Release](https://img.shields.io/badge/release-v1.0.0-blue)](https://example.com/releases/latest)",
  "[![CI](https://example.com/ci.svg)](https://example.com/ci)",
  "[![OpenSSF Scorecard](https://img.shields.io/badge/openssf_scorecard-5.0-yellow)](https://scorecard.dev/viewer/)",
].join("\n");

function stubFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("readmeWithBadges", () => {
  it("writes the version and score as fixed text, keeping each badge's link", () => {
    expect(readmeWithBadges(README, "1.55.0", 8.25).split("\n")).toEqual([
      "[![Release](https://img.shields.io/badge/release-v1.55.0-blue)](https://example.com/releases/latest)",
      "[![CI](https://example.com/ci.svg)](https://example.com/ci)",
      "[![OpenSSF Scorecard](https://img.shields.io/badge/openssf_scorecard-8.3-brightgreen)](https://scorecard.dev/viewer/)",
    ]);
  });

  it("colours the score by band", () => {
    const color = (score: number) => readmeWithBadges(README, "1.0.0", score).match(/scorecard-[\d.]+-(\w+)/)?.[1];
    expect([color(9), color(6.9), color(3), color(1)]).toEqual(["brightgreen", "yellow", "orange", "red"]);
  });

  it("leaves the Scorecard badge alone without a score", () => {
    expect(readmeWithBadges(README, "1.55.0", null)).toContain("openssf_scorecard-5.0-yellow");
  });

  it("fails when a badge is missing rather than letting it go stale", () => {
    expect(() => readmeWithBadges("no badges here", "1.55.0", 7)).toThrow("expected one Release badge, found 0");
  });

  it("matches the badges in the real README", () => {
    const real = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(() => readmeWithBadges(real, "1.0.0", 7)).not.toThrow();
  });
});

describe("fetchScorecardScore", () => {
  it("returns the published score", async () => {
    await expect(fetchScorecardScore(stubFetch(200, { score: 6.9 }))).resolves.toBe(6.9);
  });

  it("returns null on an error status, a bad body or a network failure", async () => {
    await expect(fetchScorecardScore(stubFetch(404, {}))).resolves.toBeNull();
    await expect(fetchScorecardScore(stubFetch(200, { score: "high" }))).resolves.toBeNull();
    await expect(fetchScorecardScore((async () => Promise.reject(new Error("offline"))) as typeof fetch)).resolves.toBeNull();
  });
});
