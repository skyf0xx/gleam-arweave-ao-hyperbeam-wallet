import { describe, expect, it, vi } from "vitest";
import type { RuntimePort } from "@gleam/core";
import { loadAddressIdentityKey, makeAddressIdentity, NO_ADDRESS_IDENTITY_KEY } from "./address-identity";

const ADDRESS = "weY8dOVhGi9BhGV3B-pkKVWA1ox_n8gzSKOHOJ14uFk";

function runtimeReturning(value: unknown): RuntimePort {
  return { send: vi.fn(async () => value) } as unknown as RuntimePort;
}

describe("address identity", () => {
  it("draws the same avatar for the same phrase in any case, and a different one without it", async () => {
    const willow = makeAddressIdentity(await loadAddressIdentityKey(runtimeReturning({ word: "Willow" })), () => {});
    const lower = makeAddressIdentity(await loadAddressIdentityKey(runtimeReturning({ word: "willow" })), () => {});
    const none = makeAddressIdentity(NO_ADDRESS_IDENTITY_KEY, () => {});

    expect(willow.avatarSvg(ADDRESS)).toBe(lower.avatarSvg(ADDRESS));
    expect(willow.emphasisPick).toBe(lower.emphasisPick);
    expect(willow.avatarSvg(ADDRESS)).not.toBe(none.avatarSvg(ADDRESS));
  });

  it("falls back to no phrase when it can't be read", async () => {
    const failing = { send: vi.fn(async () => Promise.reject(new Error("gone"))) } as unknown as RuntimePort;
    expect(await loadAddressIdentityKey(failing)).toEqual(NO_ADDRESS_IDENTITY_KEY);
    expect(await loadAddressIdentityKey(runtimeReturning(null))).toEqual(NO_ADDRESS_IDENTITY_KEY);
  });
});
