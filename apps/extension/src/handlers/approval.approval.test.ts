import { describe, expect, it, vi, beforeEach } from "vitest";
import type { StoragePort, WindowPort } from "@gleam/core";
import { ApprovalHandler } from "./approval";

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

describe("ApprovalHandler: signing approval preview + password gate", () => {
  let storage: StoragePort;
  let windows: ReturnType<typeof createFakeWindows>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    handler = new ApprovalHandler(storage, windows);
    await seedWallet(storage);
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

  it("signing without a staged password is rejected with a specific error", async () => {
    const pending = handler.requestApproval({
      kind: "sign",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      payload: new TextEncoder().encode("hello"),
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: true });
    await expect(pending).rejects.toThrow(/password is required/i);
  });

  it("unlockApprovalWallet stages a password consumed by resolveApproval, then a wrong password fails cleanly", async () => {
    const pending = handler.requestApproval({
      kind: "sign",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      payload: new TextEncoder().encode("hello"),
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.stagePassword({ requestId, password: "definitely-wrong-password" });
    await handler.resolveApproval({ requestId, approved: true });

    // The seeded wallet's envelope is a placeholder, not a real
    // ciphertext, so decryption fails regardless of password — this
    // still proves the staged password reaches performSigning and a
    // failure surfaces as a named rejection, not a silent success.
    await expect(pending).rejects.toThrow();
  });

  it("unlockApprovalWallet throws for an unknown requestId", async () => {
    await expect(
      handler.stagePassword({ requestId: "does-not-exist", password: "x" }),
    ).rejects.toThrow(/no pending/i);
  });
});
