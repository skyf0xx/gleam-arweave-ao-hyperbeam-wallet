import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DeviceKey, StoragePort } from "@gleam/core";
import {
  deviceKeyThumbprint,
  parseRedeemMessage,
  verifyDeviceSignature,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import {
  POINTS_INVITE_UNLOCK_KEY,
  POINTS_MEMBERSHIPS_KEY,
  POINTS_PENDING_INVITE_KEY,
  PointsHandler,
} from "./handlers/points";
import { dispatchSiteMessage } from "./dispatch/site";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { redeemSiteInvite, type InviteRedeemer } from "./points-invite";
import { SITE_ORIGIN } from "@gleam/core/src/models/site-origin.ts";

/** What `runtime.onMessageExternal` attests: the sender's origin, or nothing. */
function externalCallerContext({ origin }: { origin?: string }): CallerContext | null {
  return typeof origin === "string" ? { tier: "site", origin } : null;
}


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
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  };
}

/** What the background does with an external message: the site dispatcher, then the invite handler. */
function acceptSiteInvite(message: unknown, origin: string | undefined, storage: StoragePort, redeemer: InviteRedeemer, dev = true) {
  return dispatchSiteMessage(message, externalCallerContext({ origin }), {
    "gleam-points:invite": (invite) => redeemSiteInvite(invite, storage, redeemer),
    "gleam-points:attest": async () => {
      throw new Error("not an invite");
    },
    "gleam-points:attest-status": async () => {
      throw new Error("not an invite");
    },
  }, dev);
}

const INVITE = { type: "gleam-points:invite", code: "FRIEND42" };
const NOW = Date.UTC(2026, 9, 8, 12);

let device: DeviceKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey: DevicePublicJwk = { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y! };
  device = { id: await deviceKeyThumbprint(publicKey), publicKey, privateKey: pair.privateKey };
});

function setup(initial: Record<string, unknown> = {}, reply: () => Response | Promise<Response> = () => json({ result: "ok" })) {
  const storage = createFakeStorage(initial);
  const fetchImpl = vi.fn<typeof fetch>(async () => reply());
  const points = new PointsHandler({
    storage,
    deviceKey: { loadOrCreate: async () => device },
    apiUrl: "https://points.test",
    signer: async () => null,
    walletMethod: async () => null,
    badge: { setDot: async () => {} },
    fetchImpl,
    now: () => NOW,
  });
  return { storage, fetchImpl, points };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("acceptSiteInvite", () => {
  it.each(["ok", "full", "unknown"] as const)("redeems the code and replies %s", async (result) => {
    const { storage, points } = setup({}, () => json({ result }));

    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points)).toEqual({ ok: true, redeem: result });
    expect(storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(result === "ok");
    expect(storage.store.get(POINTS_INVITE_UNLOCK_KEY)).toEqual({ code: "FRIEND42", result, at: NOW });
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a rate limit", () => json({ error: "slow down" }, 429)],
    ["a server error", () => json({ error: "boom" }, 503)],
  ])("stores offline and keeps the code after %s", async (_label, reply) => {
    const { storage, points } = setup({}, reply);

    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points)).toEqual({ ok: true, redeem: "offline" });
    expect(storage.store.get(POINTS_INVITE_UNLOCK_KEY)).toEqual({ code: "FRIEND42", result: "offline", at: NOW });
    expect(storage.store.get(POINTS_PENDING_INVITE_KEY)).toBe("FRIEND42");
  });

  it("holds a member code as pending but not a drop code", async () => {
    const member = setup({}, () => json({ result: "ok", kind: "member" }));
    await acceptSiteInvite(INVITE, SITE_ORIGIN, member.storage, member.points);
    expect(member.storage.store.get(POINTS_PENDING_INVITE_KEY)).toBe("FRIEND42");

    const drop = setup({}, () => json({ result: "ok", kind: "drop" }));
    await acceptSiteInvite({ ...INVITE, code: "GLEAMDROP7" }, SITE_ORIGIN, drop.storage, drop.points);
    expect(drop.storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(false);
  });

  it("signs the redeem message with the device key", async () => {
    const { storage, fetchImpl, points } = setup();

    await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://points.test/invite/redeem");
    const body = JSON.parse(String(init?.body)) as {
      code: string;
      message: string;
      signature: string;
      devicePublicKey: DevicePublicJwk;
    };
    expect(body.code).toBe("FRIEND42");
    expect(body.devicePublicKey).toEqual(device.publicKey);
    expect(parseRedeemMessage(body.message)).toEqual({ code: "FRIEND42", issuedAt: Math.floor(NOW / 1000) });
    expect(await verifyDeviceSignature(body.devicePublicKey, body.message, body.signature)).toBe(true);
  });

  it("doesn't redeem again once unlocked", async () => {
    const { storage, fetchImpl, points } = setup();

    await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points);
    const again = await acceptSiteInvite({ ...INVITE, code: "OTHER99" }, SITE_ORIGIN, storage, points);

    expect(again).toEqual({ ok: true, redeem: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(storage.store.get(POINTS_INVITE_UNLOCK_KEY)).toMatchObject({ code: "FRIEND42", result: "ok" });
  });

  it("tries again after an offline result", async () => {
    let calls = 0;
    const { storage, fetchImpl, points } = setup({}, () => (++calls === 1 ? json({}, 503) : json({ result: "ok" })));

    await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points);
    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points)).toEqual({ ok: true, redeem: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips redemption on an install that already has a wallet in", async () => {
    const { storage, fetchImpl, points } = setup({ [POINTS_MEMBERSHIPS_KEY]: { w1: {} } });

    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points)).toEqual({ ok: true, redeem: "ok" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(false);
    expect(storage.store.has(POINTS_INVITE_UNLOCK_KEY)).toBe(false);
  });

  it("ignores any other origin", async () => {
    const { storage, fetchImpl, points } = setup();

    expect(await acceptSiteInvite(INVITE, "https://evil.example", storage, points)).toEqual({ ok: false });
    expect(await acceptSiteInvite(INVITE, undefined, storage, points)).toEqual({ ok: false });
    expect(storage.store.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["another type", { type: "other", code: "FRIEND42" }],
    ["a lowercase code", { type: "gleam-points:invite", code: "friend42" }],
    ["a non-string code", { type: "gleam-points:invite", code: 42 }],
    ["no body", null],
  ])("rejects %s", async (_label, message) => {
    const { storage, fetchImpl, points } = setup();

    expect(await acceptSiteInvite(message, SITE_ORIGIN, storage, points)).toEqual({ ok: false });
    expect(storage.store.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a local copy of the site in a production build", async () => {
    const { storage, fetchImpl, points } = setup();
    expect(await acceptSiteInvite(INVITE, "http://localhost:8000", storage, points, false)).toEqual({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe("refuses hostile messages without writing anything", () => {
    it.each([
      ["no origin", undefined],
      ["another site", "https://evil.example"],
      ["the site over plain http", "http://gleamwallet.app"],
      ["a subdomain", "https://www.gleamwallet.app"],
      ["a lookalike suffix", "https://gleamwallet.app.evil.example"],
      ["a lookalike host", "https://gIeamwallet.app"],
      ["a punycode lookalike", "https://xn--gleamwallt-r7a.app"],
      ["another port", "https://gleamwallet.app:8443"],
      ["a URL, not an origin", "https://gleamwallet.app/"],
      ["an opaque origin", "null"],
      ["an empty origin", ""],
    ])("from %s", async (_label, origin) => {
      const { storage, fetchImpl, points } = setup();

      expect(await acceptSiteInvite(INVITE, origin, storage, points)).toEqual({ ok: false });
      expect(storage.store.size).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
      ["undefined", undefined],
      ["a bare string", "FRIEND42"],
      ["a number", 42],
      ["an array", ["gleam-points:invite", "FRIEND42"]],
      ["an array holding the invite", [INVITE]],
      ["an extra field", { ...INVITE, walletId: "w1" }],
      ["an extra method field", { ...INVITE, method: "downloadKeyfile" }],
      ["only a code", { code: "FRIEND42" }],
      ["only the type", { type: "gleam-points:invite" }],
      ["fields inherited, not its own", Object.create(INVITE) as unknown],
      ["a request for a wallet method", { type: "downloadKeyfile", code: "FRIEND42" }],
      ["a provider call", { type: "providerCall", method: "sign", params: {} }],
      ["a key read", { type: "getState" }],
      ["a code too short", { ...INVITE, code: "ABC12" }],
      ["a code too long", { ...INVITE, code: "A".repeat(17) }],
      ["an oversized code", { ...INVITE, code: "A".repeat(1_000_000) }],
      ["an empty code", { ...INVITE, code: "" }],
      ["a code with spaces", { ...INVITE, code: " FRIEND42 " }],
      ["a code with a trailing newline", { ...INVITE, code: "FRIEND42\n" }],
      ["a code with full-width digits", { ...INVITE, code: "FRIEND４２" }],
      ["a code with an accented letter", { ...INVITE, code: "FRIÉND42" }],
      ["a code with a zero-width space", { ...INVITE, code: "FRIEND​42" }],
      ["a code with markup", { ...INVITE, code: "<img src=x>" }],
      ["an object code", { ...INVITE, code: { toString: () => "FRIEND42" } }],
      ["an array code", { ...INVITE, code: ["FRIEND42"] }],
      ["a null code", { ...INVITE, code: null }],
      ["a boolean type", { type: true, code: "FRIEND42" }],
      [
        "an own __proto__ key",
        JSON.parse('{"type":"gleam-points:invite","code":"FRIEND42","__proto__":{"polluted":true}}') as unknown,
      ],
      [
        "an own constructor key",
        JSON.parse('{"type":"gleam-points:invite","code":"FRIEND42","constructor":{"prototype":{"polluted":true}}}') as unknown,
      ],
      ["a __proto__ code", { ...INVITE, code: "__proto__" }],
    ])("carrying %s", async (_label, message) => {
      const { storage, fetchImpl, points } = setup();

      expect(await acceptSiteInvite(message, SITE_ORIGIN, storage, points)).toEqual({ ok: false });
      expect(storage.store.size).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("replies with the redeem outcome only, never wallet data", async () => {
      const { storage, points } = setup({ [POINTS_MEMBERSHIPS_KEY]: { w1: { address: "addr-1" } } });

      const reply = await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points);
      expect(reply).toEqual({ ok: true, redeem: "ok" });
      expect(Object.keys(reply as object)).toEqual(["ok", "redeem"]);
    });
  });
});
