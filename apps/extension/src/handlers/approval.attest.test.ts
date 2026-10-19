import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addressFromOwner,
  bytesToBase64Url,
  signPayloadWithSigner,
  type ApprovalRequest,
  type DeviceSigningRequest,
  type JWKInterface,
  type ScanAttestationApprovalPreview,
  type StoragePort,
  type WindowPort,
} from "@gleam/core";
import { signerFromJwk, generateJWK } from "@gleam/core/signer";
import { buildAttestMessage, verifyPointsProof } from "@gleam/core/src/points/index.ts";
import { attestationId, parseAttestation, type Attestation, type ParsedAttestation } from "@gleam/core/src/scan/attestation.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import { ApprovalDeclinedError, ApprovalHandler, type ScanAttestationSubmitter } from "./approval";
import { cacheKey, clearKeyCache } from "./key-session";
import type { OwnershipProof } from "./points";

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

function createWatchableStorage(): StoragePort {
  const store = new Map<string, unknown>();
  const watchers = new Map<string, Set<(value: unknown) => void>>();
  return {
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
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
  focused: string[];
  userCloses(requestId: string): void;
} {
  const opened: string[] = [];
  const closed: string[] = [];
  const focused: string[] = [];
  const listeners = new Set<(requestId: string) => void>();
  return {
    opened,
    closed,
    focused,
    async createApprovalWindow(url: string) {
      opened.push(url);
    },
    async closeApprovalWindow(requestId: string) {
      closed.push(requestId);
    },
    async focusApprovalWindow(requestId: string) {
      focused.push(requestId);
    },
    onApprovalWindowClosed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    userCloses(requestId: string) {
      for (const listener of listeners) listener(requestId);
    },
  };
}

function requestIdOf(url: string): string {
  return decodeURIComponent(/requestId=([^&]+)/.exec(url)![1]!);
}

const SITE = "https://gleamwallet.app";
const KEYFILE_ID = "w-keyfile";
const HW_ID = "w-keystone";

const ATTESTATION: Attestation = {
  release: "1.4.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
  model: "claude-opus-5-5",
  challenge: "q7Xh2mB9kLp4Wz0RtY6uVa",
  answers: [
    { file: "packages/core/src/vault/encryption.ts", symbol: "decrypt", line: 120, check: "Refuses a ciphertext whose tag doesn't verify." },
    { file: "apps/extension/src/handlers/provider-params.ts", symbol: "readTransaction", line: 212, check: "Rejects a transaction with an unknown format." },
    { file: "apps/extension/src/handlers/approval.ts", symbol: "ApprovalHandler.resolveApproval", line: 300, check: "Ignores a resolution for an expired request." },
  ],
  result: "pass",
  report: "# Scan\n\n<script>alert(1)</script> Read the vault.\n",
};

function parsed(): ParsedAttestation {
  const result = parseAttestation(ATTESTATION);
  if (!result.ok) throw new Error("fixture is invalid");
  return result.attestation;
}

const PAID: SiteAttestResponse = { ok: true, attestationId: "x", points: "5000000000000", paid: true, unpaidReason: null, paidPlacesLeft: 19 };

let storage: StoragePort;
let windows: ReturnType<typeof createFakeWindows>;
let submitter: { attest: ReturnType<typeof vi.fn>; submitAttestation: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> };
let handler: ApprovalHandler;
let keyfileJwk: JWKInterface;
let deviceJwk: JWKInterface;
let message: string;

beforeEach(async () => {
  keySessionStore.clear();
  keyfileJwk = await generateJWK();
  deviceJwk = await generateJWK();
  const wallets = [
    {
      id: KEYFILE_ID,
      address: await addressFromOwner(keyfileJwk.n),
      name: "Main",
      method: "jwk",
      publicKey: keyfileJwk.n,
      createdAt: 0,
      updatedAt: 0,
      encryptedKeyfile: { version: 1, algorithm: "AES-GCM", kdf: "PBKDF2-HMAC-SHA256", iterations: 600000, salt: "s", iv: "i", ciphertext: "c" },
    },
    {
      id: HW_ID,
      address: await addressFromOwner(deviceJwk.n),
      name: "Keystone",
      method: "keystone",
      publicKey: deviceJwk.n,
      createdAt: 0,
      updatedAt: 0,
      backupConfirmedAt: null,
      encryptedKeyfile: null,
      device: { kind: "keystone", xfp: "12345678" },
    },
  ];
  keySessionStore.set("local:wallets", wallets);
  keySessionStore.set("session:unlockedSession", {
    unlockedAt: Date.now(),
    lastActivityAt: Date.now(),
    autoLockTimeout: "never",
    unlockedWalletIds: [KEYFILE_ID],
  });
  storage = createWatchableStorage();
  await storage.set("local:wallets", wallets);
  windows = createFakeWindows();
  submitter = { attest: vi.fn(async () => PAID), submitAttestation: vi.fn(async () => PAID), check: vi.fn(async () => ({ ok: true })) };
  // The active wallet is the hardware one, so a test that signs with the
  // keyfile proves the request keeps the wallet it was opened for.
  handler = new ApprovalHandler(
    storage,
    windows,
    undefined,
    undefined,
    async () => HW_ID,
    undefined,
    submitter as unknown as ScanAttestationSubmitter,
  );
  message = buildAttestMessage(ATTESTATION.release, await attestationId(parsed()));
}, 60_000);

afterEach(async () => {
  await clearKeyCache();
});

async function open(walletId: string) {
  const pending = handler.requestScanAttestation({ origin: SITE, walletId, address: "addr", attestation: parsed() });
  pending.catch(() => {});
  await vi.waitFor(() => expect(windows.opened.length).toBe(1));
  return { pending, requestId: requestIdOf(windows.opened[0]!) };
}

describe("ApprovalHandler: scan attestations", () => {
  it("shows the whole attestation, the attest message and the signing wallet", async () => {
    const { requestId } = await open(KEYFILE_ID);

    const request = await handler.getApproval({ requestId });

    expect(request).toMatchObject({ kind: "scanAttestation", origin: SITE });
    expect(request.preview).toEqual({
      kind: "scanAttestation",
      walletId: KEYFILE_ID,
      address: "addr",
      attestationId: await attestationId(parsed()),
      message,
      ...ATTESTATION,
    } satisfies ScanAttestationApprovalPreview);
  });

  it("a keyfile signs through PointsHandler, and the window stays open to show the result", async () => {
    await cacheKey(KEYFILE_ID, keyfileJwk, await addressFromOwner(keyfileJwk.n));
    const { pending, requestId } = await open(KEYFILE_ID);

    const shown = await handler.resolveApproval({ requestId, approved: true });

    expect(shown).toEqual({ shown: "scanAttestation", result: PAID });
    await expect(pending).resolves.toEqual(PAID);
    expect(submitter.attest).toHaveBeenCalledWith({ walletId: KEYFILE_ID, attestation: ATTESTATION });
    expect(windows.closed).not.toContain(requestId);
    await expect(handler.getApproval({ requestId })).rejects.toThrow(/No pending approval/);
  });

  it("checks the pending attestation with the points API, and refuses to check anything else", async () => {
    const { requestId } = await open(KEYFILE_ID);

    await expect(handler.checkScanAttestation({ requestId })).resolves.toEqual({ ok: true });
    expect(submitter.check).toHaveBeenCalledWith(ATTESTATION, await addressFromOwner(keyfileJwk.n));

    submitter.check = vi.fn(async () => ({ ok: false, error: "The scan's challenge expired." }));
    await expect(handler.checkScanAttestation({ requestId })).resolves.toEqual({ ok: false, error: "The scan's challenge expired." });
    await expect(handler.checkScanAttestation({ requestId: "nope" })).rejects.toThrow(/No pending approval/);
  });

  it("a refusal from the points API is shown too, not thrown", async () => {
    await cacheKey(KEYFILE_ID, keyfileJwk, await addressFromOwner(keyfileJwk.n));
    const refused: SiteAttestResponse = { ok: false, code: "already_attested", error: "Already." };
    submitter.attest.mockResolvedValueOnce(refused);
    const { pending, requestId } = await open(KEYFILE_ID);

    await expect(handler.resolveApproval({ requestId, approved: true })).resolves.toEqual({ shown: "scanAttestation", result: refused });
    await expect(pending).resolves.toEqual(refused);
  });

  it("a hardware wallet signs the ownership transaction for the attest message on the device", async () => {
    const { pending, requestId } = await open(HW_ID);

    const view = (await handler.resolveApproval({ requestId, approved: true })) as ApprovalRequest;
    const device = view.device as DeviceSigningRequest;
    expect(device.summaries).toEqual([{ kind: "transaction", recipient: null, quantity: "0", fee: "0", dataSize: "0" }]);
    expect(submitter.attest).not.toHaveBeenCalled();

    const [payload] = device.payloads;
    if (payload?.kind !== "transaction") throw new Error("expected the ownership transaction");
    const signatures = [bytesToBase64Url(await signPayloadWithSigner(payload, signerFromJwk(deviceJwk, "")))];
    const shown = await handler.submitDeviceSignature({ requestId, signatures });

    expect(shown).toEqual({ shown: "scanAttestation", result: PAID });
    await expect(pending).resolves.toEqual(PAID);
    const [attestation, proof] = submitter.submitAttestation.mock.calls[0] as [ParsedAttestation, OwnershipProof];
    expect(attestation).toEqual(ATTESTATION);
    expect(proof).toMatchObject({ owner: deviceJwk.n, message, proof: "transaction" });
    expect(await verifyPointsProof("transaction", proof.owner, message, proof.signature)).toBe(true);
    expect(windows.closed).not.toContain(requestId);
  });

  it("rejecting or closing the window rejects the site with ApprovalDeclinedError", async () => {
    const rejected = await open(KEYFILE_ID);
    await handler.resolveApproval({ requestId: rejected.requestId, approved: false });
    await expect(rejected.pending).rejects.toBeInstanceOf(ApprovalDeclinedError);
    expect(submitter.attest).not.toHaveBeenCalled();

    windows.opened.length = 0;
    const closed = await open(KEYFILE_ID);
    windows.userCloses(closed.requestId);
    await expect(closed.pending).rejects.toMatchObject({ name: "ApprovalDeclinedError", timedOut: false });
  });

  it("waits 20 minutes for an answer, not the usual 5, then times out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const { pending, requestId } = await open(KEYFILE_ID);
      const timedOut = expect(pending).rejects.toMatchObject({ name: "ApprovalDeclinedError", timedOut: true });

      await vi.advanceTimersByTimeAsync(19 * 60_000);
      await expect(handler.getApproval({ requestId })).resolves.toMatchObject({ kind: "scanAttestation" });

      await vi.advanceTimersByTimeAsync(61_000);
      await timedOut;
    } finally {
      vi.useRealTimers();
    }
  });

  it("signs with the wallet it was opened for after the user switches wallets", async () => {
    await cacheKey(KEYFILE_ID, keyfileJwk, await addressFromOwner(keyfileJwk.n));
    const { requestId } = await open(KEYFILE_ID);
    keySessionStore.set("local:activeWalletId", HW_ID);
    await storage.set("local:activeWalletId", HW_ID);

    await handler.resolveApproval({ requestId, approved: true });

    expect(submitter.attest).toHaveBeenCalledWith(expect.objectContaining({ walletId: KEYFILE_ID }));
    expect(submitter.submitAttestation).not.toHaveBeenCalled();
  });

  it("a device signature over anything but the prepared proof is refused, and the request keeps waiting", async () => {
    const { pending, requestId } = await open(HW_ID);
    const view = (await handler.resolveApproval({ requestId, approved: true })) as ApprovalRequest;
    const [payload] = view.device!.payloads;
    if (payload?.kind !== "transaction") throw new Error("expected the ownership transaction");
    const other = { ...payload, transaction: { ...payload.transaction, tags: [] } };

    const wrong = [bytesToBase64Url(await signPayloadWithSigner(other, signerFromJwk(deviceJwk, "")))];
    await expect(handler.submitDeviceSignature({ requestId, signatures: wrong })).rejects.toThrow(/doesn't match this wallet/);

    expect(submitter.submitAttestation).not.toHaveBeenCalled();
    expect((await handler.getApproval({ requestId })).device).toBeDefined();
    await handler.resolveApproval({ requestId, approved: false });
    await expect(pending).rejects.toBeInstanceOf(ApprovalDeclinedError);
  });

  it("refuses a request whose message isn't the attestation's, before any window opens", async () => {
    const other = `gleam-points:attest:v1:1.4.0:${"0".repeat(64)}`;
    await expect(
      handler.requestApproval({
        kind: "scanAttestation",
        origin: SITE,
        walletId: KEYFILE_ID,
        address: "addr",
        attestation: ATTESTATION,
        payload: new TextEncoder().encode(other),
      }),
    ).rejects.toThrow("The message to sign isn't this attestation's.");
    expect(windows.opened).toEqual([]);
  });

  it("allows one pending attestation: another focuses its window and gets busy", async () => {
    const { requestId } = await open(KEYFILE_ID);

    const second = await handler.requestScanAttestation({ origin: SITE, walletId: KEYFILE_ID, address: "addr", attestation: parsed() });

    expect(second).toMatchObject({ ok: false, code: "busy" });
    expect(windows.opened).toHaveLength(1);
    expect(windows.focused).toEqual([requestId]);
  });

  it("two attestations sent at once open one window", async () => {
    const first = handler.requestScanAttestation({ origin: SITE, walletId: KEYFILE_ID, address: "addr", attestation: parsed() });
    first.catch(() => {});
    const second = handler.requestScanAttestation({ origin: SITE, walletId: KEYFILE_ID, address: "addr", attestation: parsed() });

    expect(await second).toMatchObject({ ok: false, code: "busy" });
    await vi.waitFor(() => expect(windows.opened).toHaveLength(1));
  });
});
