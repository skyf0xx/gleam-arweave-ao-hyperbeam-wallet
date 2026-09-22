import { estimateFee, submitTransfer as submitArweaveTransfer } from "@gleam/core/src/arweave/transfer.ts";
import { queryActivityTransactions } from "@gleam/core/src/arweave/graphql.ts";
import { submitTransfer as submitAoTransfer } from "@gleam/core/src/ao/transfer.ts";
import { isFirstSeenRecipient } from "@gleam/core/src/activity/index.ts";
import {
  DEFAULT_HYPERBEAM_PEER_URLS,
  type ActivityEntry,
  type FeeEstimate,
  type JWKInterface,
  type NetworkSettings,
  type StoragePort,
  type TransferDraft,
  type Wallet,
} from "@gleam/core";
import { getCachedKey } from "./key-session";

/**
 * Background-side implementation of `ProtocolMap`'s `estimateTransfer`/
 * `submitTransfer`. Same constructor-injected-`StoragePort` shape as the
 * other handlers in this directory.
 *
 * Signing key source: an AR transfer needs the decrypted JWK, which this
 * handler now reads from `key-session.ts`'s in-memory cache — populated by
 * `WalletLifecycleHandler.unlockWallet` — instead of requiring a password
 * on every request (this file's original resolution, superseded: see
 * `wallet-lifecycle.ts`'s doc comment for why "re-derive from a
 * freshly-typed password every call" was replaced). `submitTransfer`
 * throws a specific "wallet is locked" error if no key is cached for
 * `req.walletId` — the caller (`SendView`) has no password field to fall
 * back to asking for, so the UI's job is to route the user back to the
 * unlock screen when it sees that error, not to retry with a prompt here.
 *
 * Storage schema this handler owns:
 * - `local:activityLog:{address}` — see `ReadsHandler`'s doc comment;
 *   this handler is the writer, `ReadsHandler` the reader.
 */
export interface SubmitTransferRequest extends TransferDraft {
  walletId: string;
}

export type EstimateTransferRequest = SubmitTransferRequest;

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
  constructor(private readonly storage: StoragePort) {}

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
   * `token: null` is the AR path (unchanged). `token: <processId>` is an
   * AO token transfer: `firstSeenRecipient` is still computed against the
   * same merged local+gateway AR activity history the AR path uses (per
   * this task's packet — there is no separate AO-only recipient-history
   * source), but `fee` has no AO equivalent — see `core/ao/transfer.ts`'s
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
   * submit, before gateway/network confirmation (PRD "Send submission
   * writes an optimistic activity entry immediately, before gateway
   * confirmation") — the entry is written here, synchronously with the
   * response, not fire-and-forgotten after it.
   *
   * AO path (`req.token !== null`): "submitted" here means aoconnect's
   * `message()` resolved with a message id — the Messenger Unit accepted
   * and scheduled the signed data item, not that the token process has
   * executed the `Transfer` handler or that the recipient's balance has
   * updated yet. The entry is written `status: "pending"` on that
   * acceptance, same tier of certainty the AR path already commits to for
   * its own gateway-accepted-but-not-yet-mined case — see
   * `core/ao/transfer.ts`'s doc comment for the full distinction.
   */
  async submitTransfer(req: SubmitTransferRequest): Promise<{ txId: string }> {
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

    return { txId };
  }
}
