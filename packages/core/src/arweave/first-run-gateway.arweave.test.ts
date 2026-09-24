import { describe, expect, it, vi } from "vitest";
import { resolveInitialGatewayUrl } from "./first-run-gateway";

function arweaveInfoResponse(): Response {
  return { ok: true, json: () => Promise.resolve({ network: "arweave.N.1" }) } as unknown as Response;
}

function notArweaveResponse(): Response {
  return { ok: true, json: () => Promise.resolve({ status: "ok" }) } as unknown as Response;
}

describe("resolveInitialGatewayUrl", () => {
  it("returns arweave.net when it passes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(arweaveInfoResponse());
    await expect(resolveInitialGatewayUrl(fetchImpl)).resolves.toBe("https://arweave.net");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://arweave.net/info", { method: "GET" });
  });

  it("falls back to the first working fallback gateway when arweave.net fails", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://arweave.net/info") throw new Error("down");
      if (url === "https://ar-io.dev/info") return arweaveInfoResponse();
      return notArweaveResponse();
    });
    await expect(resolveInitialGatewayUrl(fetchImpl)).resolves.toBe("https://ar-io.dev");
  });

  it("tries the next fallback if an earlier one doesn't answer as a gateway", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://arweave.net/info") throw new Error("down");
      if (url === "https://ar-io.dev/info") return notArweaveResponse();
      if (url === "https://permagate.io/info") return arweaveInfoResponse();
      throw new Error("unexpected url " + url);
    });
    await expect(resolveInitialGatewayUrl(fetchImpl)).resolves.toBe("https://permagate.io");
  });

  it("falls back to arweave.net when every candidate fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(resolveInitialGatewayUrl(fetchImpl)).resolves.toBe("https://arweave.net");
  });

  it("never throws even if fetchImpl throws synchronously", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("boom");
    });
    await expect(resolveInitialGatewayUrl(fetchImpl as unknown as typeof fetch)).resolves.toBe(
      "https://arweave.net",
    );
  });
});
