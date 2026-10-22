import { describe, expect, it, vi } from "vitest";
import { fetchScanStats } from "./count";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const COUNT = { release: "1.2.3", total: 7, paidPlacesLeft: 93 };
const REWARDS = { day: "2026-10-19", issuedAtomic: "10000000", scanRewardAtomic: "10000", tailScanRewardAtomic: "2000", bountyPoolAtomic: "5000000" };

/** Answers each route by its parsed pathname. */
function api(routes: { count?: () => Response; rewards?: () => Response }): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const { pathname } = new URL(String(input));
    const route = pathname === "/attestations/count" ? routes.count : pathname === "/scan/rewards" ? routes.rewards : undefined;
    if (!route) throw new Error(`unexpected ${pathname}`);
    return route();
  }) as unknown as typeof fetch;
}

const run = (fetchImpl: typeof fetch, release = "1.2.3") =>
  fetchScanStats({ apiUrl: "https://api.example", release, fetchImpl });

describe("fetchScanStats", () => {
  it("reads the release's count route and the scan reward", async () => {
    const fetchImpl = api({ count: () => json(COUNT), rewards: () => json(REWARDS) });
    expect(await run(fetchImpl)).toEqual({ total: 7, paidPlacesLeft: 93, rewardAtomic: "10000", bountyPoolAtomic: "5000000" });
    expect(vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url))).toContain(
      "https://api.example/attestations/count?release=1.2.3",
    );
  });

  it("answers the tail reward once the full-reward places are taken", async () => {
    const fetchImpl = api({ count: () => json({ ...COUNT, paidPlacesLeft: 80 }), rewards: () => json(REWARDS) });
    expect((await run(fetchImpl))?.rewardAtomic).toBe("2000");
  });

  it("reads a release with no scans as the zero the server answers", async () => {
    const fetchImpl = api({ count: () => json({ release: "1.2.3", total: 0, paidPlacesLeft: 100 }), rewards: () => json(REWARDS) });
    expect(await run(fetchImpl)).toEqual({ total: 0, paidPlacesLeft: 100, rewardAtomic: "10000", bountyPoolAtomic: "5000000" });
  });

  it("has no reward before the first snapshot or when the rewards route fails", async () => {
    const before = { day: null, issuedAtomic: "0", scanRewardAtomic: "0", bountyPoolAtomic: "0" };
    expect((await run(api({ count: () => json(COUNT), rewards: () => json(before) })))?.rewardAtomic).toBeNull();
    expect((await run(api({ count: () => json(COUNT), rewards: () => json({}, 503) })))?.rewardAtomic).toBeNull();
    expect((await run(api({ count: () => json(COUNT), rewards: () => json({ ...REWARDS, scanRewardAtomic: 1 }) })))?.rewardAtomic).toBeNull();
  });

  it("has no bounty pool when it's empty or the rewards route fails", async () => {
    expect((await run(api({ count: () => json(COUNT), rewards: () => json({ ...REWARDS, bountyPoolAtomic: "0" }) })))?.bountyPoolAtomic).toBeNull();
    expect((await run(api({ count: () => json(COUNT), rewards: () => json({}, 503) })))?.bountyPoolAtomic).toBeNull();
  });

  it("is null on count failures and malformed count bodies", async () => {
    const withCount = (count: () => Response) => run(api({ count, rewards: () => json(REWARDS) }));
    expect(await withCount(() => json({}, 500))).toBeNull();
    expect(await withCount(() => json({ code: "rate_limited" }, 429))).toBeNull();
    expect(await withCount(() => json({ code: "unknown_release" }, 404))).toBeNull();
    expect(await withCount(() => json({ total: "7", paidPlacesLeft: 13 }))).toBeNull();
    expect(await withCount(() => json({ total: -1, paidPlacesLeft: 20 }))).toBeNull();
    expect(await withCount(() => json({ total: 7 }))).toBeNull();
    expect(await withCount(() => new Response("nope"))).toBeNull();
    expect(
      await withCount(() => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });

  it("doesn't call the API for a version that isn't a release", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await run(fetchImpl, "1.0.0&x=y")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
