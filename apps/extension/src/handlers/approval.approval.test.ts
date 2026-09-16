import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { StoragePort, WindowPort } from "@gleam/core";
import { ApprovalHandler } from "./approval";
import { cacheKey, clearKeyCache } from "./key-session";

/**
 * Real key/value store standing in for `adapters/storage.ts`'s
 * `storagePort`, backing `key-session.ts`'s accessors — not an in-process
 * cache, so tests exercise the same "read fresh from storage" behavior
 * `key-session.ts` relies on.
 */
const keySessionStore = new Map<string, unknown>();

vi.mock("../adapters/storage", () => ({
  storagePort: {
    async get(key: string) {
      return keySessionStore.has(key) ? keySessionStore.get(key) : null;
    },
    async set(key: string, value: unknown) {
      keySessionStore.set(key, value);
    },
    async remove(key: string) {
      keySessionStore.delete(key);
    },
    watch() {
      return () => {};
    },
  },
}));

beforeEach(() => {
  keySessionStore.clear();
});

/**
 * A `StoragePort` fake whose `watch` genuinely fires on every `set`
 * (unlike the pass-through stub other handlers' test files use) —
 * required here since `ApprovalHandler.requestApproval`'s resolution is
 * driven entirely by `watch` observing `resolveApproval`'s write, per
 * this handler's own doc comment.
 */
function createWatchableStorage(): StoragePort {
  const store = new Map<string, unknown>();
  const watchers = new Map<string, Set<(value: unknown) => void>>();

  return {
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
      for (const cb of watchers.get(key) ?? []) cb(value);
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

function createFakeWindows(): WindowPort & {
  opened: string[];
  closed: string[];
} {
  const opened: string[] = [];
  const closed: string[] = [];
  return {
    opened,
    closed,
    async createApprovalWindow(url: string) {
      opened.push(url);
    },
    async closeApprovalWindow(requestId: string) {
      closed.push(requestId);
    },
    async focusApprovalWindow() {},
  };
}

function extractRequestId(url: string): string {
  const match = /requestId=([^&]+)/.exec(url);
  if (!match) throw new Error(`No requestId in url: ${url}`);
  return decodeURIComponent(match[1]!);
}

const WALLET_ID = "wallet-1";

async function seedWallet(storage: StoragePort) {
  await storage.set("local:wallets", [
    {
      id: WALLET_ID,
      address: "abc-address",
      name: "Main",
      method: "jwk",
      publicKey: "pub",
      createdAt: 0,
      updatedAt: 0,
      encryptedKeyfile: { version: 1, algorithm: "AES-GCM", kdf: "PBKDF2-HMAC-SHA256", iterations: 600000, salt: "s", iv: "i", ciphertext: "c" },
    },
  ]);
}

describe("ApprovalHandler: connect() -> Grant", () => {
  let storage: StoragePort;
  let windows: ReturnType<typeof createFakeWindows>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    handler = new ApprovalHandler(storage, windows);
    await seedWallet(storage);
  });

  it("opens a dedicated approval window (never inline), never blank before resolution", async () => {
    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });

    // let requestApproval's synchronous setup (window open + pending write) flush
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    expect(windows.opened[0]).toMatch(/^\/approval\.html\?requestId=/);

    const requestId = extractRequestId(windows.opened[0]!);
    await handler.resolveApproval({ requestId, approved: true });
    await expect(pending).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
  });

  it("creates and persists a real Grant on approval, readable via getConnectedApps", async () => {
    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: true });
    await pending;

    const grants = await handler.getConnectedApps();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      permissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
      expiresAt: null,
      budget: null,
    });

    // Storage schema documented on ApprovalHandler: local:grants, a plain
    // Grant[] a future getConnectedApps() stub-replacement can read directly.
    const raw = await storage.get<unknown[]>("local:grants");
    expect(Array.isArray(raw)).toBe(true);
    expect(raw).toHaveLength(1);
  });

  it("rejecting a connect request creates no Grant", async () => {
    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://untrusted.example",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: false });
    await expect(pending).rejects.toThrow(/rejected/i);

    expect(await handler.getConnectedApps()).toEqual([]);
  });

  it("closes the approval window once resolved", async () => {
    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: true });
    await pending;

    expect(windows.closed).toEqual([requestId]);
  });

  it("a second connect() from the same origin replaces the prior Grant, not duplicates it", async () => {
    const first = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    await handler.resolveApproval({ requestId: extractRequestId(windows.opened[0]!), approved: true });
    await first;

    const second = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS", "ACCESS_TOKENS"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(2));
    await handler.resolveApproval({ requestId: extractRequestId(windows.opened[1]!), approved: true });
    await second;

    const grants = await handler.getConnectedApps();
    expect(grants).toHaveLength(1);
    expect(grants[0]?.permissions).toEqual(["ACCESS_ADDRESS", "ACCESS_TOKENS"]);
  });
});

describe("ApprovalHandler: revocation ends access", () => {
  let storage: StoragePort;
  let windows: ReturnType<typeof createFakeWindows>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    handler = new ApprovalHandler(storage, windows);
    await seedWallet(storage);
    await storage.set("local:grants", [
      {
        origin: "https://bazar.arweave.net",
        walletId: WALLET_ID,
        permissions: ["ACCESS_ADDRESS"],
        createdAt: 0,
        expiresAt: null,
        budget: null,
      },
    ]);
  });

  it("findActiveGrant finds a stored, unexpired Grant", async () => {
    const grant = await handler.findActiveGrant("https://bazar.arweave.net");
    expect(grant).not.toBeNull();
    expect(grant?.origin).toBe("https://bazar.arweave.net");
  });

  it("revokeGrant removes the Grant entirely", async () => {
    await handler.revokeGrant({ origin: "https://bazar.arweave.net" });

    expect(await handler.findActiveGrant("https://bazar.arweave.net")).toBeNull();
    expect(await handler.getConnectedApps()).toEqual([]);
  });

  it("an expired Grant is treated as inactive even though it's still stored", async () => {
    await storage.set("local:grants", [
      {
        origin: "https://expired.example",
        walletId: WALLET_ID,
        permissions: ["ACCESS_ADDRESS"],
        createdAt: 0,
        expiresAt: Date.now() - 1000,
        budget: null,
      },
    ]);

    expect(await handler.findActiveGrant("https://expired.example")).toBeNull();
  });

  it("a revoked origin must be re-approved before any further provider call succeeds", async () => {
    await handler.revokeGrant({ origin: "https://bazar.arweave.net" });
    expect(await handler.findActiveGrant("https://bazar.arweave.net")).toBeNull();

    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = /requestId=([^&]+)/.exec(windows.opened[0]!)![1]!;
    await handler.resolveApproval({ requestId, approved: true });
    await pending;

    expect(await handler.findActiveGrant("https://bazar.arweave.net")).not.toBeNull();
  });
});

describe("ApprovalHandler: signing approval preview + unlocked-session gate", () => {
  let storage: StoragePort;
  let windows: ReturnType<typeof createFakeWindows>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    handler = new ApprovalHandler(storage, windows);
    await seedWallet(storage);
  });

  afterEach(async () => {
    await clearKeyCache();
  });

  it("getApproval returns the exact pending ApprovalRequest for a requestId", async () => {
    const pending = handler.requestApproval({
      kind: "sign",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient-address",
      amount: "1000",
      fee: "10",
      payload: new TextEncoder().encode("hello"),
      tags: [{ name: "Action", value: "Transfer" }],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    const request = await handler.getApproval({ requestId });
    expect(request.kind).toBe("sign");
    expect(request.origin).toBe("https://bazar.arweave.net");
    if (request.preview.kind !== "connect") {
      expect(request.preview.recipient).toBe("recipient-address");
      expect(request.preview.amount).toBe("1000");
      expect(request.preview.decodedData).toBe("hello");
      expect(request.preview.tags).toEqual([{ name: "Action", value: "Transfer" }]);
      expect(request.preview.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    }

    await handler.resolveApproval({ requestId, approved: false });
    await expect(pending).rejects.toThrow();
  });

  it("getApproval throws for an unknown requestId", async () => {
    await expect(handler.getApproval({ requestId: "does-not-exist" })).rejects.toThrow(/no pending/i);
  });

  it("signing when the wallet has no cached key (locked) is rejected with a specific error", async () => {
    const pending = handler.requestApproval({
      kind: "sign",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      payload: new TextEncoder().encode("hello"),
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: true });
    await expect(pending).rejects.toThrow(/locked/i);
  });

  it("signing with a cached key reaches performSigning (not-implemented, not a locked-wallet error)", async () => {
    await cacheKey(WALLET_ID, { kty: "RSA", n: "n", e: "e" } as never, "abc-address");

    const pending = handler.requestApproval({
      kind: "sign",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      payload: new TextEncoder().encode("hello"),
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: true });

    // A real signature isn't implemented yet (see performSigning's doc
    // comment) — this proves the cached key was found (no "locked" error)
    // and the flow reached the honest not-implemented failure instead.
    await expect(pending).rejects.toThrow(/not implemented/i);
  });
});

describe("ApprovalHandler: transferAoTokens signing approval", () => {
  let storage: StoragePort;
  let windows: ReturnType<typeof createFakeWindows>;

  afterEach(async () => {
    await clearKeyCache();
  });

  it("finalizes an approved transferAoTokens request via the injected AoTransferSubmitter, returning { id }", async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    const submitTransfer = vi.fn().mockResolvedValue({ txId: "ao-message-id-123" });
    const handler = new ApprovalHandler(storage, windows, { submitTransfer });
    await seedWallet(storage);
    await cacheKey(WALLET_ID, { kty: "RSA", n: "n", e: "e" } as never, "abc-address");

    const pending = handler.requestApproval({
      kind: "transferAoTokens",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient-addr",
      amount: "1000",
      fee: null,
      token: "ao-process-id",
      payload: new Uint8Array(),
      tags: [],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    const request = await handler.getApproval({ requestId });
    expect(request.preview).toMatchObject({
      kind: "transferAoTokens",
      recipient: "recipient-addr",
      amount: "1000",
      token: "ao-process-id",
    });

    await handler.resolveApproval({ requestId, approved: true });

    await expect(pending).resolves.toEqual({ id: "ao-message-id-123" });
    expect(submitTransfer).toHaveBeenCalledWith({
      token: "ao-process-id",
      recipient: "recipient-addr",
      amount: "1000",
      fee: null,
      walletId: WALLET_ID,
    });
  });

  it("rejecting a transferAoTokens request never calls the submitter", async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    const submitTransfer = vi.fn().mockResolvedValue({ txId: "should-not-be-called" });
    const handler = new ApprovalHandler(storage, windows, { submitTransfer });
    await seedWallet(storage);
    await cacheKey(WALLET_ID, { kty: "RSA", n: "n", e: "e" } as never, "abc-address");

    const pending = handler.requestApproval({
      kind: "transferAoTokens",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient-addr",
      amount: "1000",
      fee: null,
      token: "ao-process-id",
      payload: new Uint8Array(),
      tags: [],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: false });
    await expect(pending).rejects.toThrow(/rejected/i);
    expect(submitTransfer).not.toHaveBeenCalled();
  });

  it("a locked wallet is rejected before the submitter is ever reached", async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    const submitTransfer = vi.fn();
    const handler = new ApprovalHandler(storage, windows, { submitTransfer });
    await seedWallet(storage);

    const pending = handler.requestApproval({
      kind: "transferAoTokens",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient-addr",
      amount: "1000",
      fee: null,
      token: "ao-process-id",
      payload: new Uint8Array(),
      tags: [],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: true });
    await expect(pending).rejects.toThrow(/locked/i);
    expect(submitTransfer).not.toHaveBeenCalled();
  });

  it("without an injected AoTransferSubmitter, throws a named wiring error rather than silently succeeding", async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    const handler = new ApprovalHandler(storage, windows);
    await seedWallet(storage);
    await cacheKey(WALLET_ID, { kty: "RSA", n: "n", e: "e" } as never, "abc-address");

    const pending = handler.requestApproval({
      kind: "transferAoTokens",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient-addr",
      amount: "1000",
      fee: null,
      token: "ao-process-id",
      payload: new Uint8Array(),
      tags: [],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: true });
    await expect(pending).rejects.toThrow(/not wired to a transfer submitter/i);
  });
});
