import { describe, expect, it } from "vitest";
import { AO_ICON_URL, AR_ICON_URL } from "./default-token-icons";
import { DEFAULT_AO_PROCESS_ID, DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN, DEFAULT_TOKENS } from "./default-tokens";

describe("default-tokens", () => {
  it("orders AR before AO", () => {
    expect(DEFAULT_TOKENS).toEqual([DEFAULT_AR_TOKEN, DEFAULT_AO_TOKEN]);
  });

  it("defaults both tokens' displayed amount to the string \"0\"", () => {
    expect(DEFAULT_AR_TOKEN.defaultDisplayAmount).toBe("0");
    expect(DEFAULT_AO_TOKEN.defaultDisplayAmount).toBe("0");
  });

  it("carries the fixed default AO process ID, not a placeholder", () => {
    expect(DEFAULT_AO_TOKEN.processId).toBe("0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc");
    expect(DEFAULT_AO_TOKEN.processId).toBe(DEFAULT_AO_PROCESS_ID);
  });

  it("AR carries no processId, since it is not an AO process-held token", () => {
    expect(DEFAULT_AR_TOKEN.processId).toBeNull();
  });

  it("AR and AO tickers match the rows they identify", () => {
    expect(DEFAULT_AR_TOKEN.ticker).toBe("AR");
    expect(DEFAULT_AO_TOKEN.ticker).toBe("AO");
  });

  it("bundles an inline icon for each, so neither depends on a gateway", () => {
    expect(DEFAULT_AR_TOKEN.logoUrl).toBe(AR_ICON_URL);
    expect(DEFAULT_AO_TOKEN.logoUrl).toBe(AO_ICON_URL);
    expect(decodeURIComponent(AR_ICON_URL.split(",")[1] ?? "")).toContain("<svg");
    expect(AO_ICON_URL.startsWith("data:image/png;base64,")).toBe(true);
  });
});
