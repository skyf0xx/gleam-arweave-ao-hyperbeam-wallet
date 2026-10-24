import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  addressFromOwner,
  decrypt,
  verifyMessage,
  type JWKInterface,
  type StoragePort,
  type ApprovalPresenterPort,
} from "@gleam/core";
import { signerFromJwk, generateJWK, Keyring } from "@gleam/core/signer";
import { ApprovalHandler } from "./approval";
import { createKeySession } from "./key-session";

let jwkPromise: Promise<JWKInterface> | null = null;

/** One generated key for the tests that need an unlocked wallet but never check what it signs. */
function sharedJwk(): Promise<JWKInterface> {
  jwkPromise ??= generateJWK();
  return jwkPromise;
}

/**
 * Real key/value store backing `keySession` below — not an in-process
 * cache, so tests exercise the same "read fresh from storage" behavior
 * `key-session.ts` relies on.
 */
const keySessionStore = new Map<string, unknown>();

const keySession = createKeySession({
  sessionKeys: new Keyring(),
  storage: {
    async get<T>(key: string) {
      return keySessionStore.has(key) ? (keySessionStore.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      keySessionStore.set(key, value);
    },
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) keySessionStore.set(key, value);
    },
    async remove(key: string) {
      keySessionStore.delete(key);
    },
    watch() {
      return () => {};
    },
  },
});
const { cacheKey, clearKeyCache } = keySession;

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
    async setMany(entries: Record<string, unknown>) {
      const stored = Object.entries(entries).map(([key, value]) => [key, JSON.parse(JSON.stringify(value)) as unknown] as const);
      for (const [key, value] of stored) store.set(key, value);
      for (const [key, value] of stored) for (const cb of watchers.get(key) ?? []) cb(value);
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

function createFakePresenter(): ApprovalPresenterPort & {
  presented: string[];
  dismissed: string[];
  focused: string[];
  /** Simulates the user dismissing the approval UI themselves. */
  userDismisses(requestId: string): void;
} {
  const presented: string[] = [];
  const dismissed: string[] = [];
  const focused: string[] = [];
  const listeners = new Set<(requestId: string) => void>();
  return {
    presented,
    dismissed,
    focused,
    async present(requestId: string) {
      presented.push(requestId);
    },
    async dismiss(requestId: string) {
      dismissed.push(requestId);
    },
    async focus(requestId: string) {
      focused.push(requestId);
    },
    onDismissed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    userDismisses(requestId: string) {
      for (const listener of listeners) listener(requestId);
    },
  };
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
  let presenter: ReturnType<typeof createFakePresenter>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    presenter = createFakePresenter();
    handler = new ApprovalHandler(storage, keySession, presenter);
    await seedWallet(storage);
  });

  it("presents the pending request by its id before resolution", async () => {
    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });

    // let requestApproval's synchronous setup (pending write + present) flush
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;
    await expect(handler.getApproval({ requestId })).resolves.toMatchObject({ requestId, kind: "connect" });

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    await handler.resolveApproval({ requestId, approved: true });
    await pending;

    expect(presenter.dismissed).toEqual([requestId]);
  });

  it("a second connect() from the same origin replaces the prior Grant, not duplicates it", async () => {
    const first = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    await handler.resolveApproval({ requestId: presenter.presented[0]!, approved: true });
    await first;

    const second = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS", "ACCESS_TOKENS"],
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBe(2));
    await handler.resolveApproval({ requestId: presenter.presented[1]!, approved: true });
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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    await handler.resolveApproval({ requestId: presenter.presented[0]!, approved: true });

    await expect(pending).resolves.toEqual({ granted: ["ACCESS_ADDRESS", "SIGNATURE", "ACCESS_TOKENS"] });
    const grants = await handler.getConnectedApps();
    expect(grants).toHaveLength(1);
    expect(grants[0]?.permissions).toEqual(["ACCESS_ADDRESS", "SIGNATURE", "ACCESS_TOKENS"]);
  });

  it("two requests fired together both stay pending and both resolve", async () => {
    const first = handler.requestApproval({
      kind: "connect",
      origin: "https://a.test",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    const second = handler.requestApproval({
      kind: "connect",
      origin: "https://b.test",
      walletId: WALLET_ID,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBe(2));
    const [firstId, secondId] = presenter.presented;

    await expect(handler.getApproval({ requestId: firstId! })).resolves.toMatchObject({ origin: "https://a.test" });
    await expect(handler.getApproval({ requestId: secondId! })).resolves.toMatchObject({ origin: "https://b.test" });

    await Promise.all([
      handler.resolveApproval({ requestId: firstId!, approved: true }),
      handler.resolveApproval({ requestId: secondId!, approved: false }),
    ]);
    await expect(first).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
    await expect(second).rejects.toThrow(/rejected/i);
    expect(await storage.get("session:pendingApprovals")).toEqual([]);
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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    await handler.resolveApproval({ requestId: presenter.presented[0]!, approved: true });

    await expect(pending).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
  });
});

describe("ApprovalHandler: connect() before any wallet exists", () => {
  it("grants the wallet that is active when the user approves", async () => {
    const storage = createWatchableStorage();
    const presenter = createFakePresenter();
    let active: string | null = null;
    const handler = new ApprovalHandler(storage, keySession, presenter, undefined, undefined, async () => active);

    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: null,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;
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
    const presenter = createFakePresenter();
    const handler = new ApprovalHandler(storage, keySession, presenter, undefined, undefined, async () => null);

    const pending = handler.requestApproval({
      kind: "connect",
      origin: "https://bazar.arweave.net",
      walletId: null,
      requestedPermissions: ["ACCESS_ADDRESS"],
    });
    const settled = pending.catch((error: unknown) => error);
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/no wallet to connect/i);
    expect(await settled).toBeInstanceOf(Error);
    expect(await handler.getConnectedApps()).toEqual([]);
  });
});

describe("ApprovalHandler: an abandoned approval window", () => {
  let storage: StoragePort;
  let presenter: ReturnType<typeof createFakePresenter>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    presenter = createFakePresenter();
    handler = new ApprovalHandler(storage, keySession, presenter);
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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    presenter.userDismisses(requestId);

    await assertion;
    await expect(handler.getApproval({ requestId })).rejects.toThrow(/No pending approval/);
    expect(await handler.getConnectedApps()).toEqual([]);
  });

  it("a dismissal reported after the request settled changes nothing", async () => {
    const first = requestConnect();
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const firstId = presenter.presented[0]!;
    await handler.resolveApproval({ requestId: firstId, approved: false });
    await expect(first).rejects.toThrow(/request was rejected/i);
    expect(presenter.dismissed).toEqual([firstId]);

    const second = requestConnect();
    await vi.waitFor(() => expect(presenter.presented.length).toBe(2));
    const secondId = presenter.presented[1]!;
    presenter.userDismisses(firstId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(handler.getApproval({ requestId: secondId })).resolves.toMatchObject({ requestId: secondId });
    await handler.resolveApproval({ requestId: secondId, approved: true });
    await expect(second).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
  });

  it("drops a record nothing awaits any more, such as one left by a service-worker restart", async () => {
    const orphan = { requestId: "orphan", kind: "connect", origin: "https://x.test", createdAt: 0, preview: { kind: "connect", requestedPermissions: [] } };
    await storage.set("session:pendingApprovals", [{ request: orphan, walletId: WALLET_ID, signingInput: null }]);

    presenter.userDismisses("orphan");

    await vi.waitFor(async () => expect(await storage.get("session:pendingApprovals")).toEqual([]));
  });

  it("closing the window while an approved request is being finalized doesn't reject it", async () => {
    let finishTransfer: (value: { txId: string }) => void = () => {};
    const transfers = {
      submitTransfer: vi.fn(() => new Promise<{ txId: string }>((resolve) => (finishTransfer = resolve))),
    };
    await cacheKey(WALLET_ID, await sharedJwk(), "abc-address");
    presenter = createFakePresenter();
    handler = new ApprovalHandler(storage, keySession, presenter, transfers);

    const pending = handler.requestApproval({
      kind: "transferAoTokens",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient",
      amount: "1",
      token: "token-process",
      payload: new Uint8Array(),
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    const resolving = handler.resolveApproval({ requestId, approved: true });
    await vi.waitFor(() => expect(transfers.submitTransfer).toHaveBeenCalled());
    presenter.userDismisses(requestId);
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
    await cacheKey(WALLET_ID, await sharedJwk(), "abc-address");
    presenter = createFakePresenter();
    handler = new ApprovalHandler(storage, keySession, presenter, transfers);

    const pending = handler.requestApproval({
      kind: "transferAoTokens",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      recipient: "recipient",
      amount: "1",
      token: "token-process",
      payload: new Uint8Array(),
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    await assertion;
    expect(presenter.dismissed).toContain(requestId);
  });
});

describe("ApprovalHandler: revocation ends access", () => {
  let storage: StoragePort;
  let presenter: ReturnType<typeof createFakePresenter>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    presenter = createFakePresenter();
    handler = new ApprovalHandler(storage, keySession, presenter);
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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;
    await handler.resolveApproval({ requestId, approved: true });
    await pending;

    expect(await handler.findActiveGrant("https://bazar.arweave.net")).not.toBeNull();
  });
});

describe("ApprovalHandler: removing wallets", () => {
  const OTHER_WALLET_ID = "wallet-2";
  let storage: StoragePort;
  let presenter: ReturnType<typeof createFakePresenter>;
  let handler: ApprovalHandler;

  function grantFor(origin: string, walletId: string) {
    return { origin, walletId, permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null };
  }

  function requestConnect(origin: string, walletId: string) {
    return handler.requestApproval({ kind: "connect", origin, walletId, requestedPermissions: ["ACCESS_ADDRESS"] });
  }

  beforeEach(async () => {
    storage = createWatchableStorage();
    presenter = createFakePresenter();
    handler = new ApprovalHandler(storage, keySession, presenter);
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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const other = requestConnect("https://e.test", OTHER_WALLET_ID);
    await vi.waitFor(() => expect(presenter.presented.length).toBe(2));
    const [mineId, otherId] = presenter.presented;

    await handler.rejectWalletApprovals(WALLET_ID);

    await mineRejected;
    expect(presenter.dismissed).toEqual([mineId]);
    await expect(handler.getApproval({ requestId: mineId! })).rejects.toThrow(/No pending approval/);
    await handler.resolveApproval({ requestId: otherId!, approved: true });
    await expect(other).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
  });

  it("revokeAllAccess removes every grant and rejects every pending approval", async () => {
    const pending = requestConnect("https://d.test", OTHER_WALLET_ID);
    const rejected = expect(pending).rejects.toThrow(/wallet was reset/i);
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));

    const revoked = await handler.revokeAllAccess();

    await rejected;
    expect(revoked).toEqual(["https://a.test", "https://b.test", "https://c.test"]);
    expect(await handler.getConnectedApps()).toEqual([]);
    expect(await storage.get("session:pendingApprovals")).toEqual([]);
    expect(presenter.dismissed).toEqual([presenter.presented[0]!]);
  });

  it("revokeAllAccess rejects pending approvals with the reason it is given", async () => {
    const pending = requestConnect("https://d.test", WALLET_ID);
    const rejected = expect(pending).rejects.toThrow("The wallet was removed.");
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));

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
  let presenter: ReturnType<typeof createFakePresenter>;
  let handler: ApprovalHandler;

  beforeEach(async () => {
    storage = createWatchableStorage();
    presenter = createFakePresenter();
    handler = new ApprovalHandler(storage, keySession, presenter);
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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    const request = await handler.getApproval({ requestId });
    expect(request.kind).toBe("sign");
    expect(request.origin).toBe("https://bazar.arweave.net");
    if (request.preview.kind !== "connect" && request.preview.kind !== "addToken" && request.preview.kind !== "scanAttestation") {
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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    const dappRejected = expect(pending).rejects.toThrow(/locked/i);
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/locked/i);
    await dappRejected;
    // The window stays open to show the error instead of closing as if signed.
    expect(presenter.dismissed).not.toContain(requestId);
    await expect(handler.getApproval({ requestId })).rejects.toThrow(/No pending approval/);
  });

  it("signing after the auto-lock timeout has passed is rejected as locked and wipes the key", async () => {
    // Only Date is faked, so the handler's own timers and waitFor still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    keySessionStore.set("session:unlockedSession", {
      unlockedAt: Date.now(),
      lastActivityAt: Date.now(),
      autoLockTimeout: "immediate",
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
      await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
      const requestId = presenter.presented[0]!;

      vi.advanceTimersByTime(60 * 1000 + 1);
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
    await cacheKey(WALLET_ID, await sharedJwk(), "abc-address");

    const pending = handler.requestApproval({
      kind: "sign",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      payload: new TextEncoder().encode("hello"),
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    await handler.resolveApproval({ requestId: presenter.presented[0]!, approved: true });

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    await handler.resolveApproval({ requestId, approved: true });

    const signature = (await pending) as Uint8Array;
    expect(ArrayBuffer.isView(signature)).toBe(true);
    expect(signature.byteLength).toBe(512);
    await expect(
      verifyMessage(jwk.n, message.buffer, signature.slice().buffer, "SHA-384"),
    ).resolves.toBe(true);
  });

  async function approveCrypto(
    kind: "encrypt" | "decrypt",
    payload: Uint8Array,
    walletId: string,
    encryptAlgorithm: { name: "RSA-OAEP"; label?: ArrayBuffer } = { name: "RSA-OAEP" },
  ): Promise<Uint8Array> {
    const pending = handler.requestApproval({
      kind,
      origin: "https://bazar.arweave.net",
      walletId,
      payload,
      encryptAlgorithm,
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBeGreaterThan(0));
    const requestId = presenter.presented.pop()!;
    await handler.resolveApproval({ requestId, approved: true });
    return (await pending) as Uint8Array;
  }

  /** Wallet records are read through `key-session.ts`, so they go in its store. */
  async function storeWallet(walletId: string, publicKey: string, extra: Record<string, unknown> = {}) {
    const existing = (keySessionStore.get("local:wallets") as Record<string, unknown>[] | undefined) ?? [];
    keySessionStore.set("local:wallets", [
      ...existing.filter((wallet) => wallet.id !== walletId),
      { id: walletId, method: "jwk", address: await addressFromOwner(publicKey), publicKey, ...extra },
    ]);
  }

  it("encrypt and decrypt survive the storage round trip, including an RSA-OAEP label", async () => {
    const jwk = await generateJWK();
    await storeWallet(WALLET_ID, jwk.n);
    await cacheKey(WALLET_ID, jwk, "abc-address");
    const plaintext = new TextEncoder().encode("secret");
    const algorithm = { name: "RSA-OAEP" as const, label: new Uint8Array(12).fill(7).buffer };

    const ciphertext = await approveCrypto("encrypt", plaintext, WALLET_ID, algorithm);
    expect(ArrayBuffer.isView(ciphertext)).toBe(true);
    const decrypted = await approveCrypto("decrypt", ciphertext, WALLET_ID, algorithm);
    expect(new TextDecoder().decode(decrypted)).toBe("secret");
  });

  it("encrypts to a hardware wallet's stored public key without a cached key", async () => {
    const deviceKey = await generateJWK();
    await storeWallet("hw-1", deviceKey.n, {
      method: "ledger",
      encryptedKeyfile: null,
      device: { kind: "ledger" },
    });

    const ciphertext = await approveCrypto("encrypt", new TextEncoder().encode("secret"), "hw-1");

    // Only the device's private key can open it.
    const decrypted = await decrypt(signerFromJwk(deviceKey, ""), ciphertext as Uint8Array<ArrayBuffer>, { name: "RSA-OAEP" });
    expect(new TextDecoder().decode(decrypted)).toBe("secret");
  });

  it("refuses to encrypt when the stored public key doesn't match the wallet's address", async () => {
    const realKey = await generateJWK();
    const otherKey = await generateJWK();
    await storeWallet("hw-1", otherKey.n, { method: "ledger", address: await addressFromOwner(realKey.n) });

    const pending = handler.requestApproval({
      kind: "encrypt",
      origin: "https://bazar.arweave.net",
      walletId: "hw-1",
      payload: new TextEncoder().encode("secret"),
      encryptAlgorithm: { name: "RSA-OAEP" },
    });
    await vi.waitFor(() => expect(presenter.presented.length).toBeGreaterThan(0));
    const requestId = presenter.presented.pop()!;

    const message = "This wallet's stored public key doesn't match its address. Encryption was refused.";
    const dappRejected = expect(pending).rejects.toThrow(message);
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(message);
    await dappRejected;
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
      await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
      // Failures reach the test through `pending`; resolveApproval throws the same error.
      pending.catch(() => {});
      await bundlingHandler
        .resolveApproval({ requestId: presenter.presented[0]!, approved: true })
        .catch(() => {});
      return pending;
    }

    it("posts the signed item to the handler's bundler and resolves to its id", async () => {
      await cacheKey(WALLET_ID, await generateJWK(), "abc-address");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

      const result = (await dispatchLarge(new ApprovalHandler(storage, keySession, presenter, undefined, BUNDLER))) as {
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

      await expect(dispatchLarge(new ApprovalHandler(storage, keySession, presenter, undefined, BUNDLER))).rejects.toThrow(
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
      await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
      await handler.resolveApproval({ requestId: presenter.presented[0]!, approved: true });
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
      await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
      const requestId = presenter.presented[0]!;

      const request = await handler.getApproval({ requestId });
      if (request.preview.kind === "connect" || request.preview.kind === "addToken" || request.preview.kind === "scanAttestation") {
        throw new Error("expected a signing preview");
      }
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
      await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
      const requestId = presenter.presented[0]!;

      const request = await handler.getApproval({ requestId });
      if (request.preview.kind === "connect" || request.preview.kind === "addToken" || request.preview.kind === "scanAttestation") {
        throw new Error("expected a signing preview");
      }
      expect(request.preview.items).toBeNull();
      expect(request.preview.decodedData).toBe("hello");

      await handler.resolveApproval({ requestId, approved: false });
      await expect(pending).rejects.toThrow();
    });
  });
});

describe("ApprovalHandler: transferAoTokens signing approval", () => {
  let storage: StoragePort;
  let presenter: ReturnType<typeof createFakePresenter>;

  afterEach(async () => {
    await clearKeyCache();
  });

  it("finalizes an approved transferAoTokens request via the injected AoTransferSubmitter, returning { id }", async () => {
    storage = createWatchableStorage();
    presenter = createFakePresenter();
    const submitTransfer = vi.fn().mockResolvedValue({ txId: "ao-message-id-123" });
    const handler = new ApprovalHandler(storage, keySession, presenter, { submitTransfer });
    await seedWallet(storage);
    await cacheKey(WALLET_ID, await sharedJwk(), "abc-address");

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

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
    presenter = createFakePresenter();
    const submitTransfer = vi.fn().mockResolvedValue({ txId: "should-not-be-called" });
    const handler = new ApprovalHandler(storage, keySession, presenter, { submitTransfer });
    await seedWallet(storage);
    await cacheKey(WALLET_ID, await sharedJwk(), "abc-address");

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    await handler.resolveApproval({ requestId, approved: false });
    await expect(pending).rejects.toThrow(/rejected/i);
    expect(submitTransfer).not.toHaveBeenCalled();
  });

  it("a locked wallet is rejected before the submitter is ever reached", async () => {
    storage = createWatchableStorage();
    presenter = createFakePresenter();
    const submitTransfer = vi.fn();
    const handler = new ApprovalHandler(storage, keySession, presenter, { submitTransfer });
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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    const dappRejected = expect(pending).rejects.toThrow(/locked/i);
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/locked/i);
    await dappRejected;
    expect(submitTransfer).not.toHaveBeenCalled();
  });

  it("without an injected AoTransferSubmitter, throws a named wiring error rather than silently succeeding", async () => {
    storage = createWatchableStorage();
    presenter = createFakePresenter();
    const handler = new ApprovalHandler(storage, keySession, presenter);
    await seedWallet(storage);
    await cacheKey(WALLET_ID, await sharedJwk(), "abc-address");

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
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    const dappRejected = expect(pending).rejects.toThrow(/not wired to a transfer submitter/i);
    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(
      /not wired to a transfer submitter/i,
    );
    await dappRejected;
  });
});

describe("ApprovalHandler: addToken approval", () => {
  const PROCESS_ID = "p".repeat(43);

  function requestAddToken(handler: ApprovalHandler) {
    return handler.requestApproval({
      kind: "addToken",
      origin: "https://bazar.arweave.net",
      walletId: WALLET_ID,
      address: "abc-address",
      processId: PROCESS_ID,
      ticker: "TKN",
      name: "Token",
    });
  }

  it("previews the token and the address it joins, without needing a signing key", async () => {
    const storage = createWatchableStorage();
    const presenter = createFakePresenter();
    const addWatchedToken = vi.fn().mockResolvedValue(undefined);
    const handler = new ApprovalHandler(storage, keySession, presenter, undefined, undefined, undefined, { addWatchedToken });
    keySessionStore.clear();

    const pending = requestAddToken(handler);
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    const requestId = presenter.presented[0]!;

    const request = await handler.getApproval({ requestId });
    expect(request.kind).toBe("addToken");
    expect(request.preview).toEqual({
      kind: "addToken",
      processId: PROCESS_ID,
      ticker: "TKN",
      name: "Token",
      address: "abc-address",
    });

    await handler.resolveApproval({ requestId, approved: true });
    await expect(pending).resolves.toBeUndefined();
    expect(addWatchedToken).toHaveBeenCalledWith({ address: "abc-address", processId: PROCESS_ID });
  });

  it("adds nothing when rejected", async () => {
    const storage = createWatchableStorage();
    const presenter = createFakePresenter();
    const addWatchedToken = vi.fn();
    const handler = new ApprovalHandler(storage, keySession, presenter, undefined, undefined, undefined, { addWatchedToken });

    const pending = requestAddToken(handler);
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    await handler.resolveApproval({ requestId: presenter.presented[0]!, approved: false });

    await expect(pending).rejects.toThrow(/rejected/);
    expect(addWatchedToken).not.toHaveBeenCalled();
  });

  it("rejects the dApp with the error when the token can't be stored", async () => {
    const storage = createWatchableStorage();
    const presenter = createFakePresenter();
    const addWatchedToken = vi.fn().mockRejectedValue(new Error("No HyperBEAM peer configured."));
    const handler = new ApprovalHandler(storage, keySession, presenter, undefined, undefined, undefined, { addWatchedToken });

    const pending = requestAddToken(handler);
    await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
    await expect(
      handler.resolveApproval({ requestId: presenter.presented[0]!, approved: true }),
    ).rejects.toThrow(/No HyperBEAM peer/);
    await expect(pending).rejects.toThrow(/No HyperBEAM peer/);
  });
});
