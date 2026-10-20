import { describe, expect, it, vi } from "vitest";
import { ScansHandler } from "./scans";

describe("ScansHandler", () => {
  it("counts the scans of the running version", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ total: 1 }))) as unknown as typeof fetch;
    const handler = new ScansHandler({ apiUrl: "https://api.example", version: () => "1.26.0", fetchImpl });

    expect(await handler.count()).toBe(1);
    expect(vi.mocked(fetchImpl).mock.calls[0]![0]).toContain("release=1.26.0");
  });

  it("is null when the API fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await new ScansHandler({ apiUrl: "https://api.example", version: () => "1.26.0", fetchImpl }).count()).toBeNull();
  });
});
