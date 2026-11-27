import { describe, expect, it, vi } from "vitest";
import { getArTotalSupply } from "./total-supply";

const SUPPLY = "65561299541769737381";

function stubFetch(answers: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const answer = answers[String(input)];
    if (!answer) throw new TypeError("offline");
    return answer();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("getArTotalSupply", () => {
  it("reads the supply from the user's gateway", async () => {
    const fetchImpl = stubFetch({ "https://gw.test/total_supply": () => new Response(`${SUPPLY}\n`) });
    expect(await getArTotalSupply("https://gw.test/", fetchImpl)).toBe(SUPPLY);
  });

  it("falls back to arweave.net when the gateway answers with an error page", async () => {
    const fetchImpl = stubFetch({
      "https://gw.test/total_supply": () => new Response("<!DOCTYPE html><title>Error</title>"),
      "https://arweave.net/total_supply": () => new Response(SUPPLY),
    });
    expect(await getArTotalSupply("https://gw.test", fetchImpl)).toBe(SUPPLY);
  });

  it("asks arweave.net once when it is the gateway", async () => {
    const fetchImpl = stubFetch({ "https://arweave.net/total_supply": () => new Response("x", { status: 500 }) });
    await expect(getArTotalSupply("https://arweave.net", fetchImpl)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back past a gateway whose reply runs past a few dozen digits", async () => {
    const fetchImpl = stubFetch({
      "https://gw.test/total_supply": () => new Response("9".repeat(1_000_000)),
      "https://arweave.net/total_supply": () => new Response(SUPPLY),
    });
    expect(await getArTotalSupply("https://gw.test", fetchImpl)).toBe(SUPPLY);
  });

  it("refuses a supply of 0", async () => {
    const fetchImpl = stubFetch({ "https://arweave.net/total_supply": () => new Response("0") });
    await expect(getArTotalSupply("https://arweave.net", fetchImpl)).rejects.toThrow();
  });
});
