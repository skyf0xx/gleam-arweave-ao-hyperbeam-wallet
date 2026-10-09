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
      pointsPhase: 1,
    });
  });

  it("reads POINTS_PHASE and treats empty as Phase 1", () => {
    const env = { DATABASE_URL: "postgres://x" };
    expect(readConfig({ ...env, POINTS_PHASE: "2" }).pointsPhase).toBe(2);
    expect(readConfig({ ...env, POINTS_PHASE: "1" }).pointsPhase).toBe(1);
    expect(readConfig({ ...env, POINTS_PHASE: "" }).pointsPhase).toBe(1);
    expect(() => readConfig({ ...env, POINTS_PHASE: "3" })).toThrow(/POINTS_PHASE/);
    expect(() => readConfig({ ...env, POINTS_PHASE: "one" })).toThrow(/POINTS_PHASE/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => readConfig({ DATABASE_URL: "postgres://x", PORT: "abc" })).toThrow(/PORT/);
  });
});
