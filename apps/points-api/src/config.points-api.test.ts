// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readConfig } from "./config";

describe("readConfig", () => {
  it("requires DATABASE_URL and defaults the rest", () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
    expect(readConfig({ DATABASE_URL: "postgres://x" })).toEqual({
      databaseUrl: "postgres://x",
      port: 8080,
      arweaveGatewayUrl: "https://arweave.net",
      hyperbeamUrl: "https://state.forward.computer",
    });
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => readConfig({ DATABASE_URL: "postgres://x", PORT: "abc" })).toThrow(/PORT/);
  });
});
