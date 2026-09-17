import { describe, expect, it, vi } from "vitest";
import {
  AO_TOKEN,
  DEFAULT_TOKEN_REGISTRY,
  isRegisteredProcessId,
  resolveUnregisteredTokenMetadata,
} from "./token-sources";

const UNREGISTERED_PROCESS_ID = "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY";

function fakeGraphQLFetch(edges: unknown[], ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: { transactions: { edges } } }),
  })) as unknown as typeof fetch;
}

describe("isRegisteredProcessId", () => {
  it("is true for a process id present in DEFAULT_TOKEN_REGISTRY", () => {
    expect(isRegisteredProcessId(AO_TOKEN.processId as string)).toBe(true);
  });

  it("is false for a process id not in the registry", () => {
    expect(isRegisteredProcessId(UNREGISTERED_PROCESS_ID)).toBe(false);
    expect(DEFAULT_TOKEN_REGISTRY.some((t) => t.processId === UNREGISTERED_PROCESS_ID)).toBe(false);
  });
});

describe("resolveUnregisteredTokenMetadata", () => {
  it("resolves metadata for an unregistered token from its spawn tags", async () => {
    const fetchImpl = fakeGraphQLFetch([
      {
        node: {
          id: UNREGISTERED_PROCESS_ID,
          tags: [
            { name: "ticker", value: "wUSDC" },
            { name: "name", value: "Legacy wUSDC" },
            { name: "denomination", value: "6" },
            { name: "total-supply", value: "255018926306" },
            { name: "logo", value: "HPTSjRYXipZsTAwp9fPjAoTDEH2LTceuiMUXPQ39vEk" },
            { name: "description", value: "Legacynet wrapped USDC tokens." },
          ],
        },
      },
    ]);

    const metadata = await resolveUnregisteredTokenMetadata(
      UNREGISTERED_PROCESS_ID,
      "https://arweave.net",
      fetchImpl,
    );

    expect(metadata).toEqual({
      processId: UNREGISTERED_PROCESS_ID,
      ticker: "wUSDC",
      name: "Legacy wUSDC",
      denomination: 6,
      totalSupply: "255018926306",
      logo: "HPTSjRYXipZsTAwp9fPjAoTDEH2LTceuiMUXPQ39vEk",
      description: "Legacynet wrapped USDC tokens.",
    });
  });

  it("returns null (not a throw) when the gateway lookup fails, since callers just want a label", async () => {
    const fetchImpl = fakeGraphQLFetch([], false);
    const metadata = await resolveUnregisteredTokenMetadata(
      UNREGISTERED_PROCESS_ID,
      "https://arweave.net",
      fetchImpl,
    );
    expect(metadata).toBeNull();
  });

  it("returns null when no spawn transaction is found for the process id", async () => {
    const fetchImpl = fakeGraphQLFetch([]);
    const metadata = await resolveUnregisteredTokenMetadata(
      UNREGISTERED_PROCESS_ID,
      "https://arweave.net",
      fetchImpl,
    );
    expect(metadata).toBeNull();
  });
});
