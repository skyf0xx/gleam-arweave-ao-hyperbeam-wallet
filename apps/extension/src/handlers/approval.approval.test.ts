import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { generateJWK, verifyMessage, type StoragePort, type WindowPort } from "@gleam/core";
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
  // getCachedKey only returns keys for wallets an unexpired session lists.
  keySessionStore.set("session:unlockedSession", {
    unlockedAt: Date.now(),
    lastActivityAt: Date.now(),
    autoLockTimeout: "never",
    unlockedWalletIds: [WALLET_ID],
  });
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
      // chrome.storage keeps only JSON-shaped data: a Uint8Array comes
      // back as a plain object, so the fake must lose it the same way.
      const stored: unknown = JSON.parse(JSON.stringify(value));
      store.set(key, stored);
      for (const cb of watchers.get(key) ?? []) cb(stored);
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
  /** Simulates the user closing the window with its own close button. */
  userCloses(requestId: string): void;
} {
  const opened: string[] = [];
  const closed: string[] = [];
  const listeners = new Set<(requestId: string) => void>();
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
    onApprovalWindowClosed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    userCloses(requestId: string) {
      for (const listener of listeners) listener(requestId);
    },
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

  it("approving new permissions adds them to the origin's grant instead of replacing it", async () => {
    const origin = "https://bazar.arweave.net";
    await storage.set("local:grants", [
      { origin, walletId: WALLET_ID, permissions: ["ACCESS_ADDRESS", "SIGNATURE"], createdAt: 0, expiresAt: null, budget: null },
    ]);

    const pending = handler.requestApproval({
      kind: "connect",
      origin,
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_TOKENS"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    await handler.resolveApproval({ requestId: extractRequestId(windows.opened[0]!), approved: true });

    await expect(pending).resolves.toEqual({ granted: ["ACCESS_ADDRESS", "SIGNATURE", "ACCESS_TOKENS"] });
    const grants = await handler.getConnectedApps();
    expect(grants).toHaveLength(1);
    expect(grants[0]?.permissions).toEqual(["ACCESS_ADDRESS", "SIGNATURE", "ACCESS_TOKENS"]);
  });

  it("an expired grant's permissions are not carried into the new one", async () => {
    const origin = "https://bazar.arweave.net";
    await storage.set("local:grants", [
      { origin, walletId: WALLET_ID, permissions: ["SIGNATURE"], createdAt: 0, expiresAt: 1, budget: null },
    ]);

    const pending = handler.requestApproval({
      kind: "connect",
      origin,
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    await handler.resolveApproval({ requestId: extractRequestId(windows.opened[0]!), approved: true });

    await expect(pending).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
  });
});

describe("ApprovalHandler: connect() before any wallet exists", () => {
  it("grants the wallet that is active when the user approves", async () => {
    const storage = createWatchableStorage();
    const windows = createFakeWindows();
    let active: string | null = null;
    const handler = new ApprovalHandler(storage, windows, undefined, undefined, async () => active);

    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: null,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);
    // The approval window reads the request before onboarding runs.
    await expect(handler.getApproval({ requestId })).resolves.toMatchObject({ kind: "connect" });

    active = "wallet-new";
    await handler.resolveApproval({ requestId, approved: true });

    await expect(pending).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
    expect(await handler.getConnectedApps()).toEqual([
      expect.objectContaining({ origin: "https://bazar.arweave.net", walletId: "wallet-new" }),
    ]);
  });

  it("rejects the dApp and grants nothing if approved while still no wallet exists", async () => {
    const storage = createWatchableStorage();
    const windows = createFakeWindows();
    const handler = new ApprovalHandler(storage, windows, undefined, undefined, async () => null);

    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: null,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    const settled = pending.catch((error: unknown) => error);
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/no wallet to connect/i);
    expect(await settled).toBeInstanceOf(Error);
    expect(await handler.getConnectedApps()).toEqual([]);
  });
});

describe("ApprovalHandler: an abandoned approval window", () => {
  let storage: StoragePort;
  let windows: ReturnType<typeof createFakeWindows>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    handler = new ApprovalHandler(storage, windows);
    await seedWallet(storage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function requestConnect() {
    return handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
  }

  it("closing the window rejects the request at once and drops it", async () => {
    const pending = requestConnect();
    const assertion = expect(pending).rejects.toThrow(/approval window was closed/i);
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    windows.userCloses(requestId);

    await assertion;
    await expect(handler.getApproval({ requestId })).rejects.toThrow(/No pending approval/);
    expect(await handler.getConnectedApps()).toEqual([]);
  });

  it("drops a record nothing awaits any more, such as one left by a service-worker restart", async () => {
    const orphan = { requestId: "orphan", kind: "connect", origin: "https://x.test", createdAt: 0, preview: { kind: "connect", requestedPermissions: [] } };
    await storage.set("session:pendingApprovals", [{ request: orphan, walletId: WALLET_ID, signingInput: null }]);

    windows.userCloses("orphan");

    await vi.waitFor(async () => expect(await storage.get("session:pendingApprovals")).toEqual([]));
  });

  it("closing the window while an approved request is being finalized doesn't reject it", async () => {
    let finishTransfer: (value: { txId: string }) => void = () => {};
    const transfers = {
      submitTransfer: vi.fn(() => new Promise<{ txId: string }>((resolve) => (finishTransfer = resolve))),
    };
    await cacheKey(WALLET_ID, { kty: "RSA", n: "n", e: "e" } as never, "abc-address");
    windows = createFakeWindows();
    handler = new ApprovalHandler(storage, windows, transfers);

    const pending = handler.requestApproval({
      kind: "transferAoTokens",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient",
      amount: "1",
      token: "token-process",
      payload: new Uint8Array(),
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    const resolving = handler.resolveApproval({ requestId, approved: true });
    await vi.waitFor(() => expect(transfers.submitTransfer).toHaveBeenCalled());
    windows.userCloses(requestId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishTransfer({ txId: "tx-1" });

    await resolving;
    await expect(pending).resolves.toEqual({ id: "tx-1" });
  });

  it("a second resolveApproval for a request already being resolved is refused", async () => {
    let finishTransfer: (value: { txId: string }) => void = () => {};
    const transfers = {
      submitTransfer: vi.fn(() => new Promise<{ txId: string }>((resolve) => (finishTransfer = resolve))),
    };
    await cacheKey(WALLET_ID, { kty: "RSA", n: "n", e: "e" } as never, "abc-address");
    windows = createFakeWindows();
    handler = new ApprovalHandler(storage, windows, transfers);

    const pending = handler.requestApproval({
      kind: "transferAoTokens",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient",
      amount: "1",
      token: "token-process",
      payload: new Uint8Array(),
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    const first = handler.resolveApproval({ requestId, approved: true });
    await vi.waitFor(() => expect(transfers.submitTransfer).toHaveBeenCalled());
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/already being resolved/);
    finishTransfer({ txId: "tx-1" });

    await first;
    await expect(pending).resolves.toEqual({ id: "tx-1" });
    expect(transfers.submitTransfer).toHaveBeenCalledTimes(1);
  });

  it("a timed-out request closes its window", async () => {
    vi.useFakeTimers();
    const pending = requestConnect();
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    await assertion;
    expect(windows.closed).toContain(requestId);
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

describe("ApprovalHandler: removing wallets", () => {
  const OTHER_WALLET_ID = "wallet-2";
  let storage: StoragePort;
  let windows: ReturnType<typeof createFakeWindows>;
  let handler: ApprovalHandler;

  function grantFor(origin: string, walletId: string) {
    return { origin, walletId, permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null };
  }

  function requestConnect(origin: string, walletId: string) {
    return handler.requestApproval({ kind: "connect", origin, walletId, requestedPermissions: ["ACCESS_ADDRESS"] });
  }

  beforeEach(async () => {
    storage = createWatchableStorage();
    windows = createFakeWindows();
    handler = new ApprovalHandler(storage, windows);
    await seedWallet(storage);
    await storage.set("local:grants", [
      grantFor("https://a.test", WALLET_ID),
      grantFor("https://b.test", OTHER_WALLET_ID),
      grantFor("https://c.test", WALLET_ID),
    ]);
  });

  it("rejectWalletApprovals leaves every grant in place", async () => {
    await handler.rejectWalletApprovals(WALLET_ID);

    expect((await handler.getConnectedApps()).map((grant) => grant.origin)).toEqual([
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);
    expect(await handler.findActiveGrant("https://a.test")).not.toBeNull();
  });

  it("rejectWalletApprovals rejects that wallet's pending approvals and closes their windows", async () => {
    const mine = requestConnect("https://d.test", WALLET_ID);
    const mineRejected = expect(mine).rejects.toThrow(/wallet was removed/i);
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const other = requestConnect("https://e.test", OTHER_WALLET_ID);
    await vi.waitFor(() => expect(windows.opened.length).toBe(2));
    const [mineId, otherId] = windows.opened.map(extractRequestId);

    await handler.rejectWalletApprovals(WALLET_ID);

    await mineRejected;
    expect(windows.closed).toEqual([mineId]);
    await expect(handler.getApproval({ requestId: mineId! })).rejects.toThrow(/No pending approval/);
    await handler.resolveApproval({ requestId: otherId!, approved: true });
    await expect(other).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
  });

  it("revokeAllAccess removes every grant and rejects every pending approval", async () => {
    const pending = requestConnect("https://d.test", OTHER_WALLET_ID);
    const rejected = expect(pending).rejects.toThrow(/wallet was reset/i);
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));

    const revoked = await handler.revokeAllAccess();

    await rejected;
    expect(revoked).toEqual(["https://a.test", "https://b.test", "https://c.test"]);
    expect(await handler.getConnectedApps()).toEqual([]);
    expect(await storage.get("session:pendingApprovals")).toEqual([]);
    expect(windows.closed).toEqual([extractRequestId(windows.opened[0]!)]);
  });

  it("revokeAllAccess rejects pending approvals with the reason it is given", async () => {
    const pending = requestConnect("https://d.test", WALLET_ID);
    const rejected = expect(pending).rejects.toThrow("The wallet was removed.");
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));

    await handler.revokeAllAccess("The wallet was removed.");

    await rejected;
  });

  it("revokeAllAccess leaves nothing a new wallet could inherit", async () => {
    await handler.revokeAllAccess();

    for (const origin of ["https://a.test", "https://b.test", "https://c.test"]) {
      expect(await handler.findActiveGrant(origin)).toBeNull();
    }
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

    const dappRejected = expect(pending).rejects.toThrow(/locked/i);
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/locked/i);
    await dappRejected;
    // The window stays open to show the error instead of closing as if signed.
    expect(windows.closed).not.toContain(requestId);
    await expect(handler.getApproval({ requestId })).rejects.toThrow(/No pending approval/);
  });

  it("signing after the auto-lock timeout has passed is rejected as locked and wipes the key", async () => {
    // Only Date is faked, so the handler's own timers and waitFor still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    keySessionStore.set("session:unlockedSession", {
      unlockedAt: Date.now(),
      lastActivityAt: Date.now(),
      autoLockTimeout: "5min",
      unlockedWalletIds: [WALLET_ID],
    });
    await cacheKey(WALLET_ID, await generateJWK(), "abc-address");
    try {
      const pending = handler.requestApproval({
        kind: "signMessage",
        origin: "https://bazar.arweave.net",
        walletId: WALLET_ID,
        payload: new TextEncoder().encode("hello"),
      });
      await vi.waitFor(() => expect(windows.opened.length).toBe(1));
      const requestId = extractRequestId(windows.opened[0]!);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      const dappRejected = expect(pending).rejects.toThrow(/locked/i);
      await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/locked/i);
      await dappRejected;
      expect(keySessionStore.has(`session:key:${WALLET_ID}`)).toBe(false);
      expect(keySessionStore.has("session:unlockedSession")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signing with a cached key but no gatewayUrl fails with a named gateway error (not a locked-wallet error)", async () => {
    await cacheKey(WALLET_ID, { kty: "RSA", n: "n", e: "e" } as never, "abc-address");

    const pending = handler.requestApproval({
      kind: "sign",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      payload: new TextEncoder().encode("hello"),
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    const dappRejected = expect(pending).rejects.toThrow(/gateway url/i);
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/gateway url/i);

    // Proves the cached key was found (no "locked" error) and the flow
    // reached real signing logic, which then fails honestly because this
    // request carries no gatewayUrl (the dispatcher always supplies one
    // via ReadsHandler.getNetworkSettings() in the real extension).
    await dappRejected;
  });

  it("sign resolves to the signed transaction fields arweave-js copies back, built from the dApp's fields", async () => {
    const jwk = await generateJWK();
    await cacheKey(WALLET_ID, jwk, "abc-address");
    const target = "a".repeat(43);

    const pending = handler.requestApproval({
      kind: "sign",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: target,
      amount: "1000",
      payload: new TextEncoder().encode("hello"),
      tags: [{ name: "App-Name", value: "Gleam" }],
      gatewayUrl: "https://arweave.net",
      target,
      quantity: "1000",
      reward: "5000",
      last_tx: "b".repeat(64),
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    await handler.resolveApproval({ requestId: extractRequestId(windows.opened[0]!), approved: true });

    const signed = (await pending) as Record<string, unknown>;
    expect(signed).toMatchObject({
      owner: jwk.n,
      target,
      quantity: "1000",
      reward: "5000",
      last_tx: "b".repeat(64),
      data_size: "5",
      tags: [{ name: "QXBwLU5hbWU", value: "R2xlYW0" }],
    });
    expect(signed.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signed.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(signed).not.toHaveProperty("signedTransaction");
  });

  it("signMessage returns the signature bytes, which verify against the wallet's public key", async () => {
    const jwk = await generateJWK();
    await cacheKey(WALLET_ID, jwk, "abc-address");
    const message = new TextEncoder().encode("hello");

    const pending = handler.requestApproval({
      kind: "signMessage",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      payload: message,
      hashAlgorithm: "SHA-384",
    });
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = extractRequestId(windows.opened[0]!);

    await handler.resolveApproval({ requestId, approved: true });

    const signature = (await pending) as Uint8Array;
    expect(ArrayBuffer.isView(signature)).toBe(true);
    expect(signature.byteLength).toBe(512);
    await expect(
      verifyMessage(jwk.n, message.buffer, signature.slice().buffer, "SHA-384"),
    ).resolves.toBe(true);
  });

  it("encrypt and decrypt survive the storage round trip, including an AES IV", async () => {
    const jwk = await generateJWK();
    await cacheKey(WALLET_ID, jwk, "abc-address");
    const plaintext = new TextEncoder().encode("secret");
    const iv = new Uint8Array(12).fill(7);

    async function approve(kind: "encrypt" | "decrypt", payload: Uint8Array): Promise<Uint8Array> {
      const pending = handler.requestApproval({
        kind,
        origin: "https://bazar.arweave.net",
        walletId: WALLET_ID,
        payload,
        encryptAlgorithm: { name: "AES-GCM", iv: iv.buffer },
      });
      await vi.waitFor(() => expect(windows.opened.length).toBeGreaterThan(0));
      const requestId = extractRequestId(windows.opened.pop()!);
      await handler.resolveApproval({ requestId, approved: true });
      return (await pending) as Uint8Array;
    }

    const ciphertext = await approve("encrypt", plaintext);
    expect(ArrayBuffer.isView(ciphertext)).toBe(true);
    const decrypted = await approve("decrypt", ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe("secret");
  });

  describe("dispatch of a payload large enough to bundle", () => {
    const BUNDLER = "https://bundler.example";

    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function dispatchLarge(bundlingHandler: ApprovalHandler): Promise<unknown> {
      const pending = bundlingHandler.requestApproval({
        kind: "dispatch",
        origin: "https://bazar.arweave.net",
        walletId: WALLET_ID,
        payload: new Uint8Array(150 * 1024).fill(1),
        gatewayUrl: "https://arweave.net",
      });
      await vi.waitFor(() => expect(windows.opened.length).toBe(1));
      // Failures reach the test through `pending`; resolveApproval throws the same error.
      pending.catch(() => {});
      await bundlingHandler
        .resolveApproval({ requestId: extractRequestId(windows.opened[0]!), approved: true })
        .catch(() => {});
      return pending;
    }

    it("posts the signed item to the handler's bundler and resolves to its id", async () => {
      await cacheKey(WALLET_ID, await generateJWK(), "abc-address");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

      const result = (await dispatchLarge(new ApprovalHandler(storage, windows, undefined, BUNDLER))) as {
        id: string;
        type: string;
      };

      expect(result.type).toBe("BUNDLED");
      expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(`${BUNDLER}/tx`);
    });

    it("rejects the dApp's request when the bundler refuses the item", async () => {
      await cacheKey(WALLET_ID, await generateJWK(), "abc-address");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500, statusText: "Server Error" }));

      await expect(dispatchLarge(new ApprovalHandler(storage, windows, undefined, BUNDLER))).rejects.toThrow(
        /bundler.*HTTP 500/,
      );
    });
  });

  describe("data items", () => {
    const toBase64 = (text: string) => btoa(text);
    const endsWith = (raw: ArrayBuffer, text: string) =>
      new TextDecoder().decode(new Uint8Array(raw).slice(-text.length)) === text;

    async function approve(
      kind: "signDataItem" | "batchSignDataItem",
      texts: string[],
    ): Promise<unknown> {
      const jwk = await generateJWK();
      await cacheKey(WALLET_ID, jwk, "abc-address");
      const pending = handler.requestApproval({
        kind,
        origin: "https://bazar.arweave.net",
        walletId: WALLET_ID,
        payload: new TextEncoder().encode(texts[0]!),
        dataItems: texts.map((text) => ({ data: toBase64(text), tags: [{ name: "Action", value: "Eval" }] })),
      });
      await vi.waitFor(() => expect(windows.opened.length).toBe(1));
      await handler.resolveApproval({ requestId: extractRequestId(windows.opened[0]!), approved: true });
      return pending;
    }

    it("signDataItem resolves to the raw signed item as an ArrayBuffer", async () => {
      const raw = await approve("signDataItem", ["hello"]);
      expect(Object.prototype.toString.call(raw)).toBe("[object ArrayBuffer]");
      // ANS-104 signature type 1 (Arweave), little-endian.
      expect(Array.from(new Uint8Array(raw as ArrayBuffer).slice(0, 2))).toEqual([1, 0]);
      expect(endsWith(raw as ArrayBuffer, "hello")).toBe(true);
    });

    it("batchSignDataItem resolves to one ArrayBuffer per item, in order", async () => {
      const raws = (await approve("batchSignDataItem", ["first", "second"])) as ArrayBuffer[];
      expect(raws).toHaveLength(2);
      expect(raws.every((raw) => Object.prototype.toString.call(raw) === "[object ArrayBuffer]")).toBe(true);
      expect(endsWith(raws[0]!, "first")).toBe(true);
      expect(endsWith(raws[1]!, "second")).toBe(true);
    });

    it("batchSignDataItem's preview carries every item's decoded data and tags, not just item 1's", async () => {
      const pending = handler.requestApproval({
        kind: "batchSignDataItem",
        origin: "https://bazar.arweave.net",
        walletId: WALLET_ID,
        payload: new TextEncoder().encode("first"),
        dataItems: [
          { data: toBase64("first"), tags: [{ name: "Action", value: "Eval" }] },
          { data: toBase64("second"), tags: [{ name: "Action", value: "Notify" }], target: "b".repeat(43) },
          { data: toBase64("third"), tags: [] },
        ],
      });
      await vi.waitFor(() => expect(windows.opened.length).toBe(1));
      const requestId = extractRequestId(windows.opened[0]!);

      const request = await handler.getApproval({ requestId });
      if (request.preview.kind === "connect") throw new Error("expected a signing preview");
      const { items } = request.preview;
      expect(items).toHaveLength(3);
      expect(items?.[0]).toMatchObject({ decodedData: "first", tags: [{ name: "Action", value: "Eval" }], target: null });
      expect(items?.[1]).toMatchObject({
        decodedData: "second",
        tags: [{ name: "Action", value: "Notify" }],
        target: "b".repeat(43),
      });
      expect(items?.[2]).toMatchObject({ decodedData: "third", tags: [], target: null });
      expect(items?.every((item) => /^[0-9a-f]{64}$/.test(item.payloadHash))).toBe(true);

      await handler.resolveApproval({ requestId, approved: false });
      await expect(pending).rejects.toThrow();
    });

    it("signDataItem's preview has no items list, and keeps the single-item preview fields", async () => {
      const pending = handler.requestApproval({
        kind: "signDataItem",
        origin: "https://bazar.arweave.net",
        walletId: WALLET_ID,
        payload: new TextEncoder().encode("hello"),
        tags: [{ name: "Action", value: "Eval" }],
        dataItems: [{ data: toBase64("hello"), tags: [{ name: "Action", value: "Eval" }] }],
      });
      await vi.waitFor(() => expect(windows.opened.length).toBe(1));
      const requestId = extractRequestId(windows.opened[0]!);

      const request = await handler.getApproval({ requestId });
      if (request.preview.kind === "connect") throw new Error("expected a signing preview");
      expect(request.preview.items).toBeNull();
      expect(request.preview.decodedData).toBe("hello");

      await handler.resolveApproval({ requestId, approved: false });
      await expect(pending).rejects.toThrow();
    });
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

    const dappRejected = expect(pending).rejects.toThrow(/locked/i);
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/locked/i);
    await dappRejected;
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

    const dappRejected = expect(pending).rejects.toThrow(/not wired to a transfer submitter/i);
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(
      /not wired to a transfer submitter/i,
    );
    await dappRejected;
  });
});
