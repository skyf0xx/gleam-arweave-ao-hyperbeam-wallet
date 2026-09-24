import { describe, expect, it, vi } from "vitest";
import { isArweaveGateway } from "./gateway";

function jsonResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("isArweaveGateway", () => {
  it("returns true for a 2xx response with an arweave network field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(true, { network: "arweave.N.1" }));
    await expect(isArweaveGateway("https://arweave.net", fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("https://arweave.net/info", { method: "GET" });
  });

  it("returns false for a 2xx response whose network field isn't arweave", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(true, { network: "somethingelse.1" }));
    await expect(isArweaveGateway("https://google.com", fetchImpl)).resolves.toBe(false);
  });

  it("returns false for a non-JSON response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);
    await expect(isArweaveGateway("https://google.com", fetchImpl)).resolves.toBe(false);
  });

  it("returns false on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(isArweaveGateway("https://dead.example.com", fetchImpl)).resolves.toBe(false);
  });

  it("returns false for a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(false, { network: "arweave.N.1" }));
    await expect(isArweaveGateway("https://arweave.net", fetchImpl)).resolves.toBe(false);
  });
});
