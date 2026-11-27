// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBadge,
  fetchScorecardScore,
  RELEASE_BADGE,
  releaseBadgeUrl,
  SCORECARD_BADGE,
  scorecardBadgeUrl,
  writeReadmeBadges,
} from "./readme-badges.mjs";

const svg = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg"><title>${text}</title></svg>`;

function stubFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

/** Serves each URL's last path segment as the badge's text, or fails the ones `failing` names. */
function shields(failing: (url: string) => boolean = () => false): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failing(url)) return new Response("down", { status: 503 });
    return new Response(svg(url.split("/").pop() ?? ""), { headers: { "content-type": "image/svg+xml" } });
  }) as typeof fetch;
}

describe("badge URLs", () => {
  it("name the version, and the score coloured by band", () => {
    expect(releaseBadgeUrl("1.55.0")).toBe("https://img.shields.io/badge/release-v1.55.0-blue");
    expect([9, 6.9, 3, 1].map((score) => scorecardBadgeUrl(score).split("-").pop())).toEqual(["brightgreen", "yellow", "orange", "red"]);
    expect(scorecardBadgeUrl(8.25)).toContain("openssf_scorecard-8.3-");
  });
});

describe("fetchBadge", () => {
  const serve = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;

  it("returns a badge SVG", async () => {
    await expect(fetchBadge("https://x/b", serve(svg("ok")))).resolves.toBe(svg("ok"));
  });

  it("refuses an error status, a non-SVG, a script and an oversized reply", async () => {
    await expect(fetchBadge("https://x/b", serve(svg("ok"), 500))).rejects.toThrow("HTTP 500");
    await expect(fetchBadge("https://x/b", serve("<html></html>"))).rejects.toThrow("not a badge SVG");
    await expect(fetchBadge("https://x/b", serve("<svg><script>alert(1)</script></svg>"))).rejects.toThrow("not a badge SVG");
    await expect(fetchBadge("https://x/b", serve(`<svg>${"x".repeat(20_000)}</svg>`))).rejects.toThrow("not a badge SVG");
  });
});

describe("writeReadmeBadges", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "badges-"));
    mkdirSync(join(root, "docs/badges"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const read = (file: string) => readFileSync(join(root, file), "utf8");

  it("writes both badges and returns the files it changed", async () => {
    await expect(writeReadmeBadges(root, "1.55.0", 7, shields())).resolves.toEqual([RELEASE_BADGE, SCORECARD_BADGE]);
    expect(read(RELEASE_BADGE)).toContain("release-v1.55.0-blue");
    expect(read(SCORECARD_BADGE)).toContain("openssf_scorecard-7.0-yellow");
    await expect(writeReadmeBadges(root, "1.55.0", 7, shields())).resolves.toEqual([]);
  });

  it("leaves the Scorecard badge alone without a score", async () => {
    await expect(writeReadmeBadges(root, "1.55.0", null, shields())).resolves.toEqual([RELEASE_BADGE]);
    expect(existsSync(join(root, SCORECARD_BADGE))).toBe(false);
  });

  it("keeps the last Scorecard badge when shields can't serve the new one", async () => {
    writeFileSync(join(root, SCORECARD_BADGE), svg("old"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(writeReadmeBadges(root, "1.55.0", 7, shields((url) => url.includes("scorecard")))).resolves.toEqual([RELEASE_BADGE]);
    expect(read(SCORECARD_BADGE)).toBe(svg("old"));
  });

  it("fails rather than leave a stale release badge", async () => {
    await expect(writeReadmeBadges(root, "1.55.0", 7, shields((url) => url.includes("release")))).rejects.toThrow("HTTP 503");
  });
});

describe("the real README", () => {
  it("shows the committed badge files", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const file of [RELEASE_BADGE, SCORECARD_BADGE]) {
      expect(readme).toContain(`](${file})`);
      expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).toMatch(/^<svg[\s>]/);
    }
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
