import { describe, expect, it, vi } from "vitest";
import { ScansHandler } from "./scans";

describe("ScansHandler", () => {
  it("reads the scan stats of the running version", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ total: 1, paidPlacesLeft: 19 }))) as unknown as typeof fetch;
    const handler = new ScansHandler({ apiUrl: "https://api.example", version: () => "1.26.0", fetchImpl });

    expect(await handler.stats()).toEqual({ total: 1, paidPlacesLeft: 19, rewardAtomic: null, bountyPoolAtomic: null });
    expect(vi.mocked(fetchImpl).mock.calls[0]![0]).toContain("release=1.26.0");
  });

  it("is null when the API fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await new ScansHandler({ apiUrl: "https://api.example", version: () => "1.26.0", fetchImpl }).stats()).toBeNull();
  });
});
