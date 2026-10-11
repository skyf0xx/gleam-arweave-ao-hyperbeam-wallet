import {
  estimateFee,
  finishTransfer as finishArweaveTransfer,
  prepareTransfer as prepareArweaveTransfer,
  submitTransfer as submitArweaveTransfer,
} from "@gleam/core/src/arweave/transfer.ts";
import { queryActivityTransactions } from "@gleam/core/src/arweave/graphql.ts";
import {
  finishTransfer as finishAoTransfer,
  prepareTransfer as prepareAoTransfer,
  submitTransfer as submitAoTransfer,
} from "@gleam/core/src/ao/transfer.ts";
import { isFirstSeenRecipient } from "@gleam/core/src/activity/index.ts";
import {
  DEFAULT_HYPERBEAM_PEER_URLS,
  isHardwareWalletMethod,
  type ActivityEntry,
  type FeeEstimate,
  type JWKInterface,
  type NetworkSettings,
  type StoragePort,
  type TransferDraft,
  type UnsignedPayload,
  type Wallet,
  type Winston,
} from "@gleam/core";
import { getCachedKey, getWalletMethod } from "./key-session";

/**
 * Background-side implementation of `ProtocolMap`'s `estimateTransfer`/
 * `submitTransfer`. Same constructor-injected-`StoragePort` shape as the
 * other handlers in this directory.
 *
 * Signing key source: an AR transfer needs the decrypted JWK, which this
 * handler reads from `key-session.ts`'s in-memory cache — populated by
 * `WalletLifecycleHandler.unlockWallet` — rather than requiring a password
 * on every request. `submitTransfer`
 * throws a specific "wallet is locked" error if no key is cached for
 * `req.walletId` — the caller (`SendView`) has no password field to fall
 * back to asking for, so the UI's job is to route the user back to the
 * unlock screen when it sees that error, not to retry with a prompt here.
 *
 * A hardware wallet signs in the approval window, never here: its
 * `submitTransfer` opens that window through `DeviceTransferApprovals`
 * and resolves once the device-signed transfer is posted. The approval
 * handler builds and posts it with `prepareDeviceTransfer`/
 * `finishDeviceTransfer`, which write the same activity entry.
 *
 * Storage schema this handler owns:
 * - `local:activityLog:{address}` — see `ReadsHandler`'s doc comment;
 *   this handler is the writer, `ReadsHandler` the reader.
 */
export interface SubmitTransferRequest extends TransferDraft {
  walletId: string;
}

export type EstimateTransferRequest = SubmitTransferRequest;

/** Opens the approval window for a hardware wallet's send; `ApprovalHandler.requestWalletTransfer` behind the scenes. */
export interface DeviceTransferApprovals {
  requestTransfer(req: SubmitTransferRequest): Promise<{ txId: string }>;
}

const NETWORK_SETTINGS_KEY = "local:networkSettings";
const WALLETS_KEY = "local:wallets";
const ACTIVITY_LOG_KEY_PREFIX = "local:activityLog:";
const FIRST_SEEN_LOOKUP_LIMIT = 100;

const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  gatewayUrl: "https://arweave.net",
  peers: DEFAULT_HYPERBEAM_PEER_URLS.map((url) => ({ url, enabled: true })),
  activePeerUrl: DEFAULT_HYPERBEAM_PEER_URLS[0] ?? null,
};

function isValidNetworkSettings(value: unknown): value is NetworkSettings {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.gatewayUrl === "string" && Array.isArray(candidate.peers);
}

function isValidWallet(value: unknown): value is Wallet {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.address === "string";
}

function isValidActivityEntry(value: unknown): value is ActivityEntry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.txId === "string" && typeof candidate.timestamp === "number";
}

export class TransferHandler {
  constructor(
    private readonly storage: StoragePort,
    private readonly approvals?: DeviceTransferApprovals,
  ) {}

  private async loadNetworkSettings(): Promise<NetworkSettings> {
    const raw = await this.storage.get<unknown>(NETWORK_SETTINGS_KEY);
    return isValidNetworkSettings(raw) ? raw : DEFAULT_NETWORK_SETTINGS;
  }

  private async loadWallet(walletId: string): Promise<Wallet> {
    const raw = await this.storage.get<unknown>(WALLETS_KEY);
    const wallets = Array.isArray(raw) ? raw.filter(isValidWallet) : [];
    const wallet = wallets.find((candidate) => candidate.id === walletId);
    if (!wallet) {
      throw new Error(`No stored wallet with id "${walletId}".`);
    }
    return wallet;
  }

  private async loadActivityLog(address: string): Promise<ActivityEntry[]> {
    const raw = await this.storage.get<unknown>(`${ACTIVITY_LOG_KEY_PREFIX}${address}`);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidActivityEntry);
  }

  private async appendActivityLog(address: string, entry: ActivityEntry): Promise<void> {
    const existing = await this.loadActivityLog(address);
    await this.storage.set(`${ACTIVITY_LOG_KEY_PREFIX}${address}`, [entry, ...existing]);
  }

  /** Reads a wallet's signing key from the unlocked-session cache. Throws if the wallet isn't currently unlocked. */
  private async signingKeyFor(walletId: string): Promise<{ jwk: JWKInterface; address: string }> {
    const cached = await getCachedKey(walletId);
    if (!cached) {
      throw new Error(`Wallet "${walletId}" is locked. Unlock it to continue.`);
    }
    return cached;
  }

  /**
   * A rough, recipient-less fee quote for the compose step's "Max"
   * affordance, computed before a recipient is filled in. Underestimates
   * for a first-seen recipient (the gateway adds a new-wallet fee once a
   * target is known) — `estimateTransfer`'s recipient-specific quote is
   * the one actually enforced before submission.
   */
  async getArFee(): Promise<Winston> {
    const settings = await this.loadNetworkSettings();
    const { fee } = await estimateFee(settings.gatewayUrl);
    return fee;
  }

  /**
   * `token: null` is the AR path. `token: <processId>` is an AO token
   * transfer: `firstSeenRecipient` is still computed against the same
   * merged local+gateway AR activity history the AR path uses (there is
   * no separate AO-only recipient-history source), but `fee` has no AO
   * equivalent — see `core/ao/transfer.ts`'s
   * `AO_TRANSFER_HAS_NO_FEE` doc comment for why an AO `Transfer` message
   * has no sender-side fee quote the way an AR value-transfer does.
   * Returned as `fee: null` rather than a fabricated `0`, matching
   * `TransferDraft.fee`'s `Winston | null` shape.
   */
  async estimateTransfer(req: EstimateTransferRequest): Promise<FeeEstimate> {
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);

    const [localLog, gatewayEntries] = await Promise.all([
      this.loadActivityLog(wallet.address),
      queryActivityTransactions(wallet.address, settings.gatewayUrl, FIRST_SEEN_LOOKUP_LIMIT).catch(
        () => [],
      ),
    ]);
    const firstSeenRecipient = isFirstSeenRecipient(req.recipient, localLog, gatewayEntries);

    if (req.token !== null) {
      return { fee: null, firstSeenRecipient };
    }

    const { fee } = await estimateFee(settings.gatewayUrl, req.recipient);
    return { fee, firstSeenRecipient };
  }

  /**
   * Writes an optimistic `ActivityEntry` immediately after a successful
   * submit, before gateway/network confirmation — the entry is written
   * here, synchronously with the response, not fire-and-forgotten after it.
   *
   * AO path (`req.token !== null`): "submitted" here means the
   * Messenger Unit accepted and scheduled the signed data item, not that the token process has
   * executed the `Transfer` handler or that the recipient's balance has
   * updated yet. The entry is written `status: "pending"` on that
   * acceptance, same tier of certainty the AR path already commits to for
   * its own gateway-accepted-but-not-yet-mined case — see
   * `core/ao/transfer.ts`'s doc comment for the full distinction.
   */
  async submitTransfer(req: SubmitTransferRequest): Promise<{ txId: string }> {
    const method = await getWalletMethod(req.walletId);
    if (method !== null && isHardwareWalletMethod(method)) {
      if (!this.approvals) throw new Error("Hardware wallet sends aren't wired to the approval window.");
      return this.approvals.requestTransfer(req);
    }

    const settings = await this.loadNetworkSettings();
    const { jwk, address } = await this.signingKeyFor(req.walletId);

    let txId: string;
    try {
      if (req.token === null) {
        ({ txId } = await submitArweaveTransfer(settings.gatewayUrl, jwk, req.recipient, req.amount));
      } else {
        const { messageId } = await submitAoTransfer(jwk, req.token, req.recipient, req.amount);
        txId = messageId;
      }
    } catch (error) {
      // Logged here, not just re-thrown: this runs in the background
      // service worker, a separate console from wherever the caller
      // (popup, or a connected dApp's approval flow) surfaces the error
      // message — without this, the full error/stack is only ever visible
      // by opening this worker's own devtools at the moment of failure.
      console.error(`submitTransfer failed (token=${req.token ?? "AR"}):`, error);
      throw error;
    }

    await this.recordSend(address, req, txId);
    return { txId };
  }

  private async recordSend(address: string, req: SubmitTransferRequest, txId: string): Promise<void> {
    await this.appendActivityLog(address, {
      txId,
      type: "send",
      status: "pending",
      address: req.recipient,
      amount: req.amount,
      tags: [],
      timestamp: Date.now(),
      token: req.token,
    });
  }

  /** The unsigned AR transaction or AO `Transfer` item `ownerB64Url` signs on its device. */
  async prepareDeviceTransfer(req: SubmitTransferRequest, ownerB64Url: string): Promise<UnsignedPayload> {
    if (req.token === null) {
      const settings = await this.loadNetworkSettings();
      const transaction = await prepareArweaveTransfer(settings.gatewayUrl, ownerB64Url, req.recipient, req.amount);
      return { kind: "transaction", transaction };
    }
    return { kind: "dataItem", raw: prepareAoTransfer(ownerB64Url, req.token, req.recipient, req.amount) };
  }

  /** Applies the device's signature, posts the transfer, and writes the same activity entry `submitTransfer` does. */
  async finishDeviceTransfer(
    req: SubmitTransferRequest,
    unsigned: UnsignedPayload,
    signature: Uint8Array,
    expectedOwner: string,
  ): Promise<{ txId: string }> {
    const wallet = await this.loadWallet(req.walletId);
    let txId: string;
    try {
      if (unsigned.kind === "transaction") {
        const settings = await this.loadNetworkSettings();
        ({ txId } = await finishArweaveTransfer(settings.gatewayUrl, unsigned.transaction, signature, expectedOwner));
      } else {
        ({ messageId: txId } = await finishAoTransfer(unsigned.raw, signature, expectedOwner));
      }
    } catch (error) {
      console.error(`Device transfer failed (token=${req.token ?? "AR"}):`, error);
      throw error;
    }
    await this.recordSend(wallet.address, req, txId);
    return { txId };
  }
}
