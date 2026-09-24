import { describe, expect, it } from "vitest";
import { explorerUrlFor } from "./network";

describe("explorerUrlFor", () => {
  it("builds a lunar.arweave.net explorer link for a tx id", () => {
    expect(explorerUrlFor("test-tx-id-123")).toBe("https://lunar.arweave.net/#/explorer/test-tx-id-123");
  });

  it("builds the same explorer link shape for a wallet address", () => {
    expect(explorerUrlFor("some-wallet-address")).toBe("https://lunar.arweave.net/#/explorer/some-wallet-address");
  });
});
