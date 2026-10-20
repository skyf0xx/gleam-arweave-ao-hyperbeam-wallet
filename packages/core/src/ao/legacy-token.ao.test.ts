import { describe, expect, it } from "vitest";
import { readLegacyTokenBalance, readLegacyTokenInfo } from "./legacy-token";

const PID = "xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10";
const CU = "https://cu.test";

function answering(body: unknown, sent: Array<{ url: string; body: unknown }> = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json(body);
  }) as typeof fetch;
}

describe("readLegacyTokenBalance", () => {
  it("dry-runs a Balance message for the address and reads the reply's Data", async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    const quantity = await readLegacyTokenBalance(PID, "addr", CU, answering({ Messages: [{ Data: "123", Tags: [] }] }, sent));
    expect(quantity).toBe("123");
    expect(sent[0]?.url).toBe(`${CU}/dry-run?process-id=${PID}`);
    expect(sent[0]?.body).toMatchObject({
      Target: PID,
      Tags: expect.arrayContaining([
        { name: "Action", value: "Balance" },
        { name: "Recipient", value: "addr" },
      ]),
    });
  });

  it("falls back to the Balance tag and fails on a reply without one", async () => {
    expect(await readLegacyTokenBalance(PID, "a", CU, answering({ Messages: [{ Data: "", Tags: [{ name: "Balance", value: "9" }] }] }))).toBe("9");
    await expect(readLegacyTokenBalance(PID, "a", CU, answering({ Messages: [] }))).rejects.toThrow(/no balance/);
  });
});

describe("readLegacyTokenInfo", () => {
  it("reads name, ticker, denomination and logo from the Info reply's tags", async () => {
    const info = await readLegacyTokenInfo(
      PID,
      CU,
      answering({
        Messages: [
          {
            Tags: [
              { name: "Name", value: "Wrapped AR" },
              { name: "Ticker", value: "wAR" },
              { name: "Denomination", value: "12" },
              { name: "Logo", value: "L".repeat(43) },
            ],
          },
        ],
      }),
    );
    expect(info).toEqual({ name: "Wrapped AR", ticker: "wAR", denomination: 12, logo: "L".repeat(43) });
  });

  it("rejects a process that doesn't answer Info like a token", async () => {
    await expect(readLegacyTokenInfo(PID, CU, answering({ Messages: [{ Tags: [] }] }))).rejects.toThrow(/like a token/);
  });
});
