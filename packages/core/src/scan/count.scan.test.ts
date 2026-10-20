import { describe, expect, it, vi } from "vitest";
import { fetchScanCount } from "./count";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const run = (fetchImpl: typeof fetch, release = "1.2.3") =>
  fetchScanCount({ apiUrl: "https://api.example", release, fetchImpl });

describe("fetchScanCount", () => {
  it("reads total from the release's count route", async () => {
    const fetchImpl = vi.fn(async () => json({ release: "1.2.3", total: 7 })) as unknown as typeof fetch;
    expect(await run(fetchImpl)).toBe(7);
    expect(vi.mocked(fetchImpl).mock.calls[0]![0]).toBe("https://api.example/attestations/count?release=1.2.3");
  });

  it("reads a release with no scans as the zero the server answers", async () => {
    expect(await run((async () => json({ release: "1.2.3", total: 0 })) as typeof fetch)).toBe(0);
  });

  it("is null on other failures and malformed bodies", async () => {
    expect(await run((async () => json({}, 500)) as typeof fetch)).toBeNull();
    expect(await run((async () => json({ code: "rate_limited" }, 429)) as typeof fetch)).toBeNull();
    expect(await run((async () => json({ code: "unknown_release" }, 404)) as typeof fetch)).toBeNull();
    expect(await run((async () => json({ total: "7" })) as typeof fetch)).toBeNull();
    expect(await run((async () => json({ total: -1 })) as typeof fetch)).toBeNull();
    expect(await run((async () => new Response("nope")) as typeof fetch)).toBeNull();
    expect(
      await run((async () => {
        throw new Error("offline");
      }) as typeof fetch),
    ).toBeNull();
  });

  it("doesn't call the API for a version that isn't a release", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await run(fetchImpl, "1.0.0&x=y")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
