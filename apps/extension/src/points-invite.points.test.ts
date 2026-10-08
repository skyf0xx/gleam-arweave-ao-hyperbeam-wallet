import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";
import { POINTS_MEMBERSHIPS_KEY, POINTS_PENDING_INVITE_KEY } from "./handlers/points";
import { SITE_ORIGIN, acceptSiteInvite } from "./points-invite";

vi.mock("wxt/browser", () => ({ browser: {} }));

function createFakeStorage(initial: Record<string, unknown> = {}): StoragePort & { store: Map<string, unknown> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  };
}

const INVITE = { type: "gleam-points:invite", code: "FRIEND42" };

describe("acceptSiteInvite", () => {
  it("keeps a well-formed code from the site", async () => {
    const storage = createFakeStorage();

    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage)).toEqual({ ok: true });
    expect(storage.store.get(POINTS_PENDING_INVITE_KEY)).toBe("FRIEND42");
  });

  it("ignores any other origin", async () => {
    const storage = createFakeStorage();

    expect(await acceptSiteInvite(INVITE, "https://evil.example", storage)).toEqual({ ok: false });
    expect(await acceptSiteInvite(INVITE, undefined, storage)).toEqual({ ok: false });
    expect(storage.store.size).toBe(0);
  });

  it.each([
    ["another type", { type: "other", code: "FRIEND42" }],
    ["a lowercase code", { type: "gleam-points:invite", code: "friend42" }],
    ["a non-string code", { type: "gleam-points:invite", code: 42 }],
    ["no body", null],
  ])("rejects %s", async (_label, message) => {
    const storage = createFakeStorage();

    expect(await acceptSiteInvite(message, SITE_ORIGIN, storage)).toEqual({ ok: false });
    expect(storage.store.size).toBe(0);
  });

  it("acknowledges but doesn't keep a code once a wallet has joined", async () => {
    const storage = createFakeStorage({ [POINTS_MEMBERSHIPS_KEY]: { w1: {} } });

    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage)).toEqual({ ok: true });
    expect(storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(false);
  });
});
