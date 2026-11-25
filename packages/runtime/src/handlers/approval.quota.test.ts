import { describe, expect, it, vi } from "vitest";
import { bytesToBase64, WALLET_APPROVAL_ORIGIN, type ApprovalPresenterPort, type StoragePort } from "@gleam/core";
import { generateJWK, Keyring } from "@gleam/core/signer";
import { ApprovalHandler } from "./approval";
import { utf8ByteLength } from "./pending-codec";
import { createKeySession } from "./key-session";

const QUOTA_BYTES = 10 * 1024 * 1024;

const encoder = new TextEncoder();
const utf8 = (string: string) => encoder.encode(string).length;

/**
 * Charges what `chrome.storage.session` does: the memory of the stored
 * value tree, a fixed cost for every value plus each string's UTF-8 length.
 */
function chargedBytes(value: unknown): number {
  if (typeof value === "string") return 32 + utf8(value);
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + chargedBytes(entry), 32);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).reduce<number>((sum, [key, entry]) => sum + utf8(key) + chargedBytes(entry), 32);
  }
  return 32;
}

function createQuotaStorage(): StoragePort {
  const store = new Map<string, unknown>();
  const watchers = new Map<string, Set<(value: unknown) => void>>();
  const used = () => [...store].reduce((sum, [key, value]) => sum + utf8(key) + chargedBytes(value), 0);
  return {
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      const stored: unknown = JSON.parse(JSON.stringify(value));
      const previous = store.get(key);
      store.set(key, stored);
      if (used() > QUOTA_BYTES) {
        store.set(key, previous);
        throw new Error("Session storage quota bytes exceeded. Values were not stored.");
      }
      for (const cb of watchers.get(key) ?? []) cb(stored);
    },
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) await this.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
      for (const cb of watchers.get(key) ?? []) cb(null);
    },
    watch<T>(key: string, cb: (value: T | null) => void) {
      const set = watchers.get(key) ?? new Set();
      set.add(cb as (value: unknown) => void);
      watchers.set(key, set);
      return () => {
        watchers.get(key)?.delete(cb as (value: unknown) => void);
      };
    },
  };
}

function createPresenter(): ApprovalPresenterPort & { presented: string[] } {
  const presented: string[] = [];
  return {
    presented,
    async present(requestId: string) {
      presented.push(requestId);
    },
    async dismiss() {},
    async focus() {},
    onDismissed() {
      return () => {};
    },
  };
}

const WALLET_ID = "wallet-1";
const SITE_A = "https://a.example";
const SITE_B = "https://b.example";

function setup() {
  const storage = createQuotaStorage();
  const presenter = createPresenter();
  const keySession = createKeySession({ sessionKeys: new Keyring(), storage });
  const handler = new ApprovalHandler(storage, keySession, presenter);
  return { storage, presenter, keySession, handler };
}

function signDataItem(handler: ApprovalHandler, origin: string, bytes: number, tagValue?: string): Promise<unknown> {
  const payload = new Uint8Array(bytes);
  const pending = handler.requestApproval({
    kind: "signDataItem",
    origin,
    walletId: WALLET_ID,
    payload,
    dataItems: [{ data: bytesToBase64(payload), tags: tagValue === undefined ? [] : [{ name: "Note", value: tagValue }] }],
  });
  pending.catch(() => {});
  return pending;
}

describe("ApprovalHandler: pending requests stay within session storage", () => {
  it("one site's waiting data items leave room for another site's request", async () => {
    const { handler, presenter } = setup();

    void signDataItem(handler, SITE_A, 100_000);
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(1));
    void signDataItem(handler, SITE_A, 200_000);
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(2));

    void signDataItem(handler, SITE_B, 10_000);
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(3));
  });

  it("refuses a request too large to hold for review before any window opens", async () => {
    const { handler, presenter } = setup();

    await expect(signDataItem(handler, SITE_A, 1_000_000)).rejects.toThrow(/too large/);
    expect(presenter.presented).toHaveLength(0);

    void signDataItem(handler, SITE_B, 10);
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(1));
  });

  it("holds 1 MB of text for review, showing only its start", async () => {
    const { handler, presenter } = setup();
    const pending = handler.requestApproval({
      kind: "dispatch",
      origin: SITE_A,
      walletId: WALLET_ID,
      payload: encoder.encode("x".repeat(1_000_000)),
      gatewayUrl: "https://arweave.net",
    });
    pending.catch(() => {});

    await vi.waitFor(() => expect(presenter.presented).toHaveLength(1));
    const { preview } = await handler.getApproval({ requestId: presenter.presented[0]! });
    expect(preview).toMatchObject({ decodedData: `${"x".repeat(4096)}…` });
  });

  it("never cuts a preview inside a character", async () => {
    const { handler, presenter } = setup();
    const pending = handler.requestApproval({
      kind: "dispatch",
      origin: SITE_A,
      walletId: WALLET_ID,
      payload: encoder.encode(`${"x".repeat(4095)}😀${"x".repeat(10)}`),
      gatewayUrl: "https://arweave.net",
    });
    pending.catch(() => {});

    await vi.waitFor(() => expect(presenter.presented).toHaveLength(1));
    const { preview } = await handler.getApproval({ requestId: presenter.presented[0]! });
    expect(preview).toMatchObject({ decodedData: `${"x".repeat(4095)}…` });
  });

  it("refuses a site more waiting data than its share, and still opens another site's request", async () => {
    const { handler, presenter } = setup();

    void signDataItem(handler, SITE_A, 400_000);
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(1));
    await expect(signDataItem(handler, SITE_A, 400_000)).rejects.toThrow(/waiting for approval/);
    expect(presenter.presented).toHaveLength(1);

    void signDataItem(handler, SITE_B, 400_000);
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(2));
  });

  it("still opens Gleam's own request when sites have filled the pool", async () => {
    const { handler, presenter } = setup();
    let refused = 0;
    let attempts = 0;
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      for (let i = 0; i < 4; i += 1) {
        attempts += 1;
        signDataItem(handler, `https://${name}.example`, 400_000).catch(() => {
          refused += 1;
        });
        await vi.waitFor(() => expect(presenter.presented.length + refused).toBe(attempts));
      }
    }
    await expect(signDataItem(handler, "https://g.example", 400_000)).rejects.toThrow(/waiting for approval/);

    const opened = presenter.presented.length;
    void signDataItem(handler, WALLET_APPROVAL_ORIGIN, 400_000);
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(opened + 1));
  });

  it("approves a large waiting data item and frees its space", async () => {
    const { handler, presenter, keySession, storage } = setup();
    await storage.set("session:unlockedSession", {
      unlockedAt: Date.now(),
      lastActivityAt: Date.now(),
      autoLockTimeout: "never",
      unlockedWalletIds: [WALLET_ID],
    });
    await keySession.cacheKey(WALLET_ID, await generateJWK(), "abc-address");
    await storage.set("local:grants", [
      { origin: SITE_A, walletId: WALLET_ID, permissions: ["SIGNATURE"], createdAt: 0, expiresAt: null, budget: null },
    ]);

    const pending = signDataItem(handler, SITE_A, 400_000);
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(1));
    await handler.resolveApproval({ requestId: presenter.presented[0]!, approved: true });
    const raw = (await pending) as ArrayBuffer;
    expect(raw.byteLength).toBeGreaterThan(400_000);

    expect(await storage.get("session:pendingApprovals")).toEqual([]);
  });
});

describe("utf8ByteLength", () => {
  it("counts each string's UTF-8 bytes", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("\u00e9")).toBe(2);
    expect(utf8ByteLength("\u07ff")).toBe(2);
    expect(utf8ByteLength("\u20ac")).toBe(3);
    expect(utf8ByteLength("\uffff")).toBe(3);
    expect(utf8ByteLength("\u{1f600}")).toBe(4);
    expect(utf8ByteLength("\ud800")).toBe(3);
    expect(utf8ByteLength("\udc00x")).toBe(4);
    expect(utf8ByteLength("\ud800\ud800\udc00")).toBe(7);
  });

  it("matches TextEncoder", () => {
    const sample = "a\u00e9\u20ac\u{1f600}\ud800z\udfff\ud83d";
    expect(utf8ByteLength(sample)).toBe(utf8(sample));
  });
});

describe("ApprovalHandler: pending requests are measured in UTF-8", () => {
  // Each data item's tags are stored more than once in a record, so these
  // values fit under 2 MiB by UTF-16 count but not by UTF-8 bytes.
  it("refuses a request whose 3-byte characters exceed a site's share", async () => {
    const { handler, presenter } = setup();

    await expect(signDataItem(handler, SITE_A, 10, "\u20ac".repeat(600_000))).rejects.toThrow(/too large/);
    await expect(signDataItem(handler, SITE_A, 10, "\uffff".repeat(600_000))).rejects.toThrow(/too large/);
    expect(presenter.presented).toHaveLength(0);
  });

  it("refuses a site's second 3-byte request that UTF-16 would let through", async () => {
    const { handler, presenter } = setup();

    void signDataItem(handler, SITE_A, 10, "\u20ac".repeat(300_000));
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(1));
    await expect(signDataItem(handler, SITE_A, 10, "\u20ac".repeat(300_000))).rejects.toThrow(/waiting for approval/);
    expect(presenter.presented).toHaveLength(1);
  });

  it("still holds the same requests in ASCII", async () => {
    const { handler, presenter } = setup();

    void signDataItem(handler, SITE_A, 10, "e".repeat(600_000));
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(1));
    void signDataItem(handler, SITE_A, 10, "e".repeat(300_000));
    await vi.waitFor(() => expect(presenter.presented).toHaveLength(2));
  });
});
