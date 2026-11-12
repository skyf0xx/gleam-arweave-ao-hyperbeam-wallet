import {
  estimateFee,
  finishTransfer as finishArweaveTransfer,
  prepareTransfer as prepareArweaveTransfer,
} from "@gleam/core/src/arweave/transfer.ts";
import { signDataItemWithSigner } from "@gleam/core/src/arweave/data-item.ts";
import { queryActivityTransactions } from "@gleam/core/src/arweave/graphql.ts";
import { getBalance as getArBalance } from "@gleam/core/src/arweave/balance.ts";
import { signTransactionWithSigner, type ArweaveTransactionJson } from "@gleam/core/src/arweave/transaction.ts";
import { assertCoversNetworkFee, prepareCollectibleTransfer } from "@gleam/core/src/ao/collectible-transfer.ts";
import { prepareL1TokenTransfer } from "@gleam/core/src/ao/l1-transfer.ts";
import {
  finishTransfer as finishAoTransfer,
  prepareTransfer as prepareAoTransfer,
} from "@gleam/core/src/ao/transfer.ts";
import { assessRecipient } from "@gleam/core/src/recipients/index.ts";
import {
  capabilityRefusal,
  collectibleSendRefusal,
  DEFAULT_HYPERBEAM_PEER_URLS,
  isHardwareWalletMethod,
  type ActivityEntry,
  type CollectibleSendDraft,
  type CollectibleSendRequest,
  type RecipientAssessment,
  type NetworkSettings,
  type Signer,
  type StoragePort,
  type TokenTransport,
  type TransferDraft,
  type UnsignedPayload,
  type TransferFeeQuote,
  type Wallet,
  type Winston,
  isValidNetworkSettings,
} from "@gleam/core";
import { updateStored } from "../storage-update";
import type { KeySession } from "./key-session";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { WALLETS_KEY, NETWORK_SETTINGS_KEY, CONTACTS_KEY, ACTIVITY_LOG_KEY_PREFIX } from "../storage-keys";
import { dappError } from "../dapp-error";
import { assertTransferMatches } from "./prepared-check";

/**
 * Background-side implementation of `ProtocolMap`'s `estimateTransfer`/
 * `submitTransfer`. Same constructor-injected-`StoragePort` shape as the
 * other handlers in this directory.
 *
 * Signing key source: a transfer signs through `key-session.ts`'s
 * `getSigner`, backed by the key cached by
 * `WalletLifecycleHandler.unlockWallet`, rather than requiring a password
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

/**
 * The fee the user saw, which an L1 send pays exactly. There is no fallback
 * to a fresh quote: that would let the gateway set the fee after the review.
 */
function approvedFee(req: SubmitTransferRequest): Winston {
  // Checked by shape: arweave-js fetches its own price for an undefined reward.
  if (typeof req.fee !== "string" || !/^\d+$/.test(req.fee)) throw new Error(userErrorMessage("noApprovedFee"));
  return req.fee;
}

const FIRST_SEEN_LOOKUP_LIMIT = 100;

const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  gatewayUrl: "https://arweave.net",
  peers: DEFAULT_HYPERBEAM_PEER_URLS.map((url) => ({ url, enabled: true })),
  activePeerUrl: DEFAULT_HYPERBEAM_PEER_URLS[0] ?? null,
};

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

/** The collectibles cache a sent collectible is dropped from; `ReadsHandler` behind the scenes. */
export interface CollectibleCache {
  forgetCollectible(req: { address: string; id: string }): Promise<void>;
}

/** Where a token's transfers go; `ReadsHandler` behind the scenes, which caches it with the token's metadata. */
export interface TokenRoutes {
  tokenTransport(req: { processId: string }): Promise<TokenTransport>;
}

export class TransferHandler {
  constructor(
    private readonly storage: StoragePort,
    private readonly keySession: Pick<KeySession, "getSigner" | "getWalletMethod">,
    private readonly approvals?: DeviceTransferApprovals,
    private readonly collectibles?: CollectibleCache,
    private readonly tokens?: TokenRoutes,
  ) {}

  /**
   * `"l1"` for an `arweave-scheduler@1.0` token, which takes a transfer as
   * an L1 transaction; `"mu"` for a legacy token, or AR.
   */
  private async transportOf(req: TransferDraft): Promise<TokenTransport> {
    if (req.collectible || req.token === null || !this.tokens) return "mu";
    return this.tokens.tokenTransport({ processId: req.token });
  }

  private async loadNetworkSettings(): Promise<NetworkSettings> {
    const raw = await this.storage.get<unknown>(NETWORK_SETTINGS_KEY);
    return isValidNetworkSettings(raw) ? raw : DEFAULT_NETWORK_SETTINGS;
  }

  private async loadWallet(walletId: string): Promise<Wallet> {
    const raw = await this.storage.get<unknown>(WALLETS_KEY);
    const wallets = Array.isArray(raw) ? raw.filter(isValidWallet) : [];
    const wallet = wallets.find((candidate) => candidate.id === walletId);
    if (!wallet) {
      throw new Error(userErrorMessage("noStoredWallet", { wallet: walletId }));
    }
    return wallet;
  }

  private async loadActivityLog(address: string): Promise<ActivityEntry[]> {
    const raw = await this.storage.get<unknown>(`${ACTIVITY_LOG_KEY_PREFIX}${address}`);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidActivityEntry);
  }

  private async appendActivityLog(address: string, entry: ActivityEntry): Promise<void> {
    await updateStored(this.storage, `${ACTIVITY_LOG_KEY_PREFIX}${address}`, (raw) => [
      entry,
      ...(Array.isArray(raw) ? raw.filter(isValidActivityEntry) : []),
    ]);
  }

  /** The unlocked wallet's signer. Throws if the wallet isn't currently unlocked. */
  private async signerFor(walletId: string): Promise<Signer> {
    const signer = await this.keySession.getSigner(walletId);
    if (!signer) {
      throw new Error(userErrorMessage("walletLocked", { wallet: walletId }));
    }
    return signer;
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
   * transfer, which has no sender-side fee (see `core/ao/transfer.ts`'s
   * `AO_TRANSFER_HAS_NO_FEE`) and returns `fee: null` rather than a
   * fabricated `0`, unless the token moves on L1. Only the fee: the
   * recipient checks read up to two pages of gateway GraphQL, which can
   * take many seconds, so the send screen asks `assessRecipient` for them
   * separately.
   */
  async estimateTransfer(req: EstimateTransferRequest): Promise<TransferFeeQuote> {
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);

    if (req.token !== null) {
      if ((await this.transportOf(req)) === "mu") return { fee: null };
      // An L1 token transfer costs an AR network reward, like a collectible send.
      const [{ fee }, balance] = await Promise.all([
        estimateFee(settings.gatewayUrl, req.token),
        getArBalance(wallet.address, settings.gatewayUrl),
      ]);
      assertCoversNetworkFee(balance, fee);
      return { fee };
    }

    const { fee } = await estimateFee(settings.gatewayUrl, req.recipient);
    return { fee };
  }

  private async loadRecipientHistory(settings: NetworkSettings, address: string): Promise<[ActivityEntry[], ActivityEntry[]]> {
    return Promise.all([
      this.loadActivityLog(address),
      queryActivityTransactions(address, settings.gatewayUrl, FIRST_SEEN_LOOKUP_LIMIT).catch(() => []),
    ]);
  }

  /** Contacts and the user's own wallets: addresses trusted without any history. */
  private async loadKnownAddresses(): Promise<string[]> {
    const [contacts, wallets] = await Promise.all([
      this.storage.get<unknown>(CONTACTS_KEY),
      this.storage.get<unknown>(WALLETS_KEY),
    ]);
    const addresses: string[] = [];
    if (Array.isArray(contacts)) {
      for (const contact of contacts) {
        if (contact && typeof contact.address === "string") addresses.push(contact.address);
      }
    }
    if (Array.isArray(wallets)) addresses.push(...wallets.filter(isValidWallet).map((wallet) => wallet.address));
    return addresses;
  }

  /** What the approval window shows for a recipient; reads the same history as the send screen. */
  async assessRecipient(req: { walletId: string; recipient: string }): Promise<RecipientAssessment> {
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);
    const [[localLog, gatewayEntries], known] = await Promise.all([
      this.loadRecipientHistory(settings, wallet.address),
      this.loadKnownAddresses(),
    ]);
    return assessRecipient(req.recipient, [...localLog, ...gatewayEntries], known);
  }

  /**
   * The review step's quote for sending a collectible: the AR network
   * reward for a data-less transaction to the asset process. Fails early
   * when the wallet's AR can't pay it.
   */
  async estimateCollectibleSend(req: CollectibleSendDraft): Promise<TransferFeeQuote> {
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);
    refuseCollectibleSend(wallet.address, req.recipient, req.collectible.id);
    const [{ fee }, balance] = await Promise.all([
      estimateFee(settings.gatewayUrl, req.collectible.id),
      getArBalance(wallet.address, settings.gatewayUrl),
    ]);
    assertCoversNetworkFee(balance, fee);
    return { fee };
  }

  /** Sends one collectible through `submitTransfer`, so a hardware wallet signs it in the approval window too. */
  async sendCollectible(req: CollectibleSendRequest): Promise<{ txId: string }> {
    return this.submitTransfer({
      walletId: req.walletId,
      recipient: req.recipient,
      token: null,
      amount: "0",
      fee: req.fee,
      collectible: {
        id: req.collectible.id,
        ...(req.collectible.name !== undefined ? { name: req.collectible.name } : {}),
        ...(req.collectible.imageUrl !== undefined ? { imageUrl: req.collectible.imageUrl } : {}),
      },
    });
  }

  /**
   * Builds a collectible send and checks the wallet's AR covers the approved
   * reward, before anything is signed.
   */
  private async prepareCollectibleSend(req: SubmitTransferRequest, ownerB64Url: string): Promise<ArweaveTransactionJson> {
    const collectible = req.collectible;
    if (!collectible) throw new Error(userErrorMessage("notCollectibleSend"));
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);
    refuseCollectibleSend(wallet.address, req.recipient, collectible.id);
    const [transaction, balance] = await Promise.all([
      prepareCollectibleTransfer(settings.gatewayUrl, ownerB64Url, collectible.id, req.recipient, approvedFee(req)),
      getArBalance(wallet.address, settings.gatewayUrl),
    ]);
    assertCoversNetworkFee(balance, transaction.reward);
    return transaction;
  }

  /** Builds an L1 token transfer and checks the wallet's AR covers its reward, before anything is signed. */
  private async prepareL1TokenSend(req: SubmitTransferRequest, ownerB64Url: string): Promise<ArweaveTransactionJson> {
    if (req.token === null) throw new Error(userErrorMessage("notTokenSend"));
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);
    const [transaction, balance] = await Promise.all([
      prepareL1TokenTransfer(settings.gatewayUrl, ownerB64Url, req.token, req.recipient, req.amount, approvedFee(req)),
      getArBalance(wallet.address, settings.gatewayUrl),
    ]);
    assertCoversNetworkFee(balance, transaction.reward);
    return transaction;
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
    const method = await this.keySession.getWalletMethod(req.walletId);
    const transport = await this.transportOf(req);
    // A legacy AO send is a data item, which not every hardware wallet can
    // sign. A collectible or L1 token send is an L1 transaction.
    const refusal =
      method === null
        ? null
        : req.collectible
          ? capabilityRefusal(method, "signTransaction", "send collectibles")
          : req.token !== null
            ? transport === "l1"
              ? capabilityRefusal(method, "signTransaction", "send this token")
              : capabilityRefusal(method, "signDataItem", "send AO tokens")
            : null;
    if (refusal) throw new Error(refusal);
    if (method !== null && isHardwareWalletMethod(method)) {
      if (!this.approvals) throw new Error(dappError("Hardware wallet sends aren't wired to the approval window."));
      return this.approvals.requestTransfer(req);
    }

    const settings = await this.loadNetworkSettings();
    const signer = await this.signerFor(req.walletId);
    const { address } = signer;

    let txId: string;
    try {
      // The same build a hardware wallet signs, read back against the
      // request before the keyfile signs it.
      const unsigned = await this.prepareDeviceTransfer(req, signer.owner);
      assertTransferMatches(
        {
          recipient: req.recipient,
          amount: req.amount,
          token: req.token,
          // An AO data item carries no fee; every transaction carries the approved one.
          fee: unsigned.kind === "transaction" ? approvedFee(req) : "",
          collectible: req.collectible,
        },
        unsigned,
      );
      if (unsigned.kind === "transaction") {
        ({ txId } = await finishArweaveTransfer(
          settings.gatewayUrl,
          unsigned.transaction,
          await signTransactionWithSigner(unsigned.transaction, signer),
          signer.owner,
        ));
      } else if (unsigned.kind === "dataItem") {
        ({ messageId: txId } = await finishAoTransfer(unsigned.raw, await signDataItemWithSigner(unsigned.raw, signer), signer.owner));
      } else {
        throw new Error(dappError("A transfer can't be signed as a message."));
      }
    } catch (error) {
      // Logged here, not just re-thrown: this runs in the background
      // service worker, a separate console from wherever the caller
      // (popup, or a connected dApp's approval flow) surfaces the error
      // message — without this, the full error/stack is only ever visible
      // by opening this worker's own devtools at the moment of failure.
      console.error(`submitTransfer failed (${describeSend(req)}):`, error);
      throw error;
    }

    await this.recordSend(address, req, txId);
    return { txId };
  }

  private async recordSend(address: string, req: SubmitTransferRequest, txId: string): Promise<void> {
    // A collectible send settles like an AR send, through the gateway
    // index, so it carries no `token` for the AO result check to read.
    await this.appendActivityLog(address, {
      txId,
      type: "send",
      status: "pending",
      address: req.recipient,
      amount: req.collectible ? null : req.amount,
      tags: [],
      timestamp: Date.now(),
      token: req.collectible ? null : req.token,
      ...(req.collectible ? { collectible: req.collectible } : {}),
    });
    if (req.collectible) await this.collectibles?.forgetCollectible({ address, id: req.collectible.id });
  }

  /** The unsigned AR transaction, collectible send or AO `Transfer` item `ownerB64Url` signs on its device. */
  async prepareDeviceTransfer(req: SubmitTransferRequest, ownerB64Url: string): Promise<UnsignedPayload> {
    if (req.collectible) {
      return { kind: "transaction", transaction: await this.prepareCollectibleSend(req, ownerB64Url) };
    }
    if (req.token === null) {
      const settings = await this.loadNetworkSettings();
      const transaction = await prepareArweaveTransfer(settings.gatewayUrl, ownerB64Url, req.recipient, req.amount, approvedFee(req));
      return { kind: "transaction", transaction };
    }
    if ((await this.transportOf(req)) === "l1") {
      return { kind: "transaction", transaction: await this.prepareL1TokenSend(req, ownerB64Url) };
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
      } else if (unsigned.kind === "dataItem") {
        ({ messageId: txId } = await finishAoTransfer(unsigned.raw, signature, expectedOwner));
      } else {
        throw new Error(dappError("A transfer can't finish with a message signature."));
      }
    } catch (error) {
      console.error(`Device transfer failed (${describeSend(req)}):`, error);
      throw error;
    }
    await this.recordSend(wallet.address, req, txId);
    return { txId };
  }
}

function refuseCollectibleSend(sender: string, recipient: string, assetId: string): void {
  const refusal = collectibleSendRefusal({ sender, recipient, assetId });
  if (refusal) throw new Error(refusal);
}

function describeSend(req: SubmitTransferRequest): string {
  return req.collectible ? `collectible=${req.collectible.id}` : `token=${req.token ?? "AR"}`;
}
