import { estimateFee, submitTransfer as submitArweaveTransfer } from "@gleam/core/src/arweave/transfer.ts";
import { queryActivityTransactions } from "@gleam/core/src/arweave/graphql.ts";
import { isFirstSeenRecipient } from "@gleam/core/src/activity/index.ts";
import {
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
  peers: [],
  activePeerUrl: null,
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
  private signingKeyFor(walletId: string): { jwk: JWKInterface; address: string } {
    const cached = getCachedKey(walletId);
    if (!cached) {
      throw new Error(`Wallet "${walletId}" is locked. Unlock it to continue.`);
    }
    return cached;
  }

  /**
   * Only AR transfers (`token: null`) are implemented — an AO token
   * transfer requires dispatching a message to the token's process
   * rather than a plain value-transfer transaction, which is a different
   * request shape `core/ao` doesn't build yet (out of this task's
   * ALLOWED SCOPE: `core/ao` was scoped for balance reads only). Throws a
   * named, specific error rather than silently treating an AO transfer
   * like an AR one — see this task's final report.
   */
  async estimateTransfer(req: EstimateTransferRequest): Promise<FeeEstimate> {
    if (req.token !== null) {
      throw new Error(
        "Sending AO tokens isn't implemented yet — only AR transfers are supported.",
      );
    }

    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);

    const [{ fee }, localLog, gatewayEntries] = await Promise.all([
      estimateFee(settings.gatewayUrl, req.recipient),
      this.loadActivityLog(wallet.address),
      queryActivityTransactions(wallet.address, settings.gatewayUrl, FIRST_SEEN_LOOKUP_LIMIT).catch(
        () => [],
      ),
    ]);

    return {
      fee,
      firstSeenRecipient: isFirstSeenRecipient(req.recipient, localLog, gatewayEntries),
    };
  }

  /**
   * Writes an optimistic `ActivityEntry` immediately after a successful
   * submit, before gateway confirmation (PRD "Send submission writes an
   * optimistic activity entry immediately, before gateway confirmation")
   * — the entry is written here, synchronously with the response, not
   * fire-and-forgotten after it.
   */
  async submitTransfer(req: SubmitTransferRequest): Promise<{ txId: string }> {
    if (req.token !== null) {
      throw new Error(
        "Sending AO tokens isn't implemented yet — only AR transfers are supported.",
      );
    }

    const settings = await this.loadNetworkSettings();
    const { jwk, address } = this.signingKeyFor(req.walletId);

    const { txId } = await submitArweaveTransfer(settings.gatewayUrl, jwk, req.recipient, req.amount);

    await this.appendActivityLog(address, {
      txId,
      type: "send",
      status: "pending",
      address: req.recipient,
      amount: req.amount,
      tags: [],
      timestamp: Date.now(),
    });

    return { txId };
  }
}
