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
import { estimateL1TransferFee, prepareL1TokenTransfer } from "@gleam/core/src/ao/l1-transfer.ts";
import { assertHoldsName, estimateNameTargetFee, prepareNameTarget } from "@gleam/core/src/ao/name-target.ts";
import {
  finishTransfer as finishAoTransfer,
  prepareTransfer as prepareAoTransfer,
} from "@gleam/core/src/ao/transfer.ts";
import { assessRecipient } from "@gleam/core/src/recipients/index.ts";
import {
  capabilityRefusal,
  collectibleSendRefusal,
  isHardwareWalletMethod,
  type ActivityEntry,
  type CollectibleSendDraft,
  type CollectibleSendRequest,
  type NameTargetDraft,
  type NameTargetRequest,
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
} from "@gleam/core";
import { updateStored } from "../storage-update";
import type { KeySession } from "./key-session";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { activityLogKey, loadActivityLog, loadNetworkSettings, loadWallets, parseActivityLog, requireWallet } from "../stored-data";
import { CONTACTS_KEY } from "../storage-keys";
import { dappError } from "../dapp-error";
import { assertNameTargetMatches, assertTransferMatches } from "./prepared-check";
import { readL1NodeUrls } from "../peers";

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
  /** `ApprovalHandler.requestNameTarget` behind the scenes. */
  requestNameTarget?(req: NameTargetRequest): Promise<{ txId: string }>;
}

/**
 * The fee the user saw, which an L1 send pays exactly. There is no fallback
 * to a fresh quote: that would let the gateway set the fee after the review.
 */
function approvedFee(req: { fee?: Winston | null }): Winston {
  // Checked by shape: arweave-js fetches its own price for an undefined reward.
  if (typeof req.fee !== "string" || !/^\d+$/.test(req.fee)) throw new Error(userErrorMessage("noApprovedFee"));
  return req.fee;
}

const FIRST_SEEN_LOOKUP_LIMIT = 100;

/** The collectibles cache a sent collectible is dropped from; `ReadsHandler` behind the scenes. */
export interface CollectibleCache {
  forgetCollectible(req: { address: string; id: string }): Promise<void>;
  /** Shows a name's new target before the next discovery reads it. */
  setCachedNameTarget?(req: { address: string; id: string; target: string }): Promise<void>;
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

  private loadNetworkSettings(): Promise<NetworkSettings> {
    return loadNetworkSettings(this.storage);
  }

  private async loadWallet(walletId: string): Promise<Wallet> {
    return requireWallet(await loadWallets(this.storage), walletId);
  }

  private async appendActivityLog(address: string, entry: ActivityEntry): Promise<void> {
    await updateStored(this.storage, activityLogKey(address), (raw) => [entry, ...parseActivityLog(raw)]);
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
      const [fee, balance] = await Promise.all([
        estimateL1TransferFee(settings.gatewayUrl, req.token),
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
      loadActivityLog(this.storage, address),
      queryActivityTransactions(address, settings.gatewayUrl, FIRST_SEEN_LOOKUP_LIMIT).catch(() => []),
    ]);
  }

  /** Contacts and the user's own wallets: addresses trusted without any history. */
  private async loadKnownAddresses(): Promise<string[]> {
    const [contacts, wallets] = await Promise.all([
      this.storage.get<unknown>(CONTACTS_KEY),
      loadWallets(this.storage),
    ]);
    const addresses: string[] = [];
    if (Array.isArray(contacts)) {
      for (const contact of contacts) {
        if (contact && typeof contact.address === "string") addresses.push(contact.address);
      }
    }
    addresses.push(...wallets.map((wallet) => wallet.address));
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
   * reward for a data-less transaction to the asset process, plus the
   * winston a process with no AR needs (`estimateL1TransferFee`). Fails early
   * when the wallet's AR can't pay it.
   */
  async estimateCollectibleSend(req: CollectibleSendDraft): Promise<TransferFeeQuote> {
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);
    refuseCollectibleSend(wallet.address, req.recipient, req.collectible.id);
    const [fee, balance] = await Promise.all([
      estimateL1TransferFee(settings.gatewayUrl, req.collectible.id),
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

  /** Where the carrier's live state is read: the gateway, the L1 token nodes, then the active peer. */
  private async carrierHosts(settings: NetworkSettings): Promise<string[]> {
    const nodes = await readL1NodeUrls(this.storage);
    return [...new Set([settings.gatewayUrl, ...nodes, ...(settings.activePeerUrl ? [settings.activePeerUrl] : [])])];
  }

  /** The review's quote for pointing a name elsewhere; fails early when the wallet's AR can't pay it. */
  async estimateNameTarget(req: NameTargetDraft): Promise<TransferFeeQuote> {
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);
    const [fee, balance] = await Promise.all([
      estimateNameTargetFee(settings.gatewayUrl, req.carrier),
      getArBalance(wallet.address, settings.gatewayUrl),
    ]);
    assertCoversNetworkFee(balance, fee);
    return { fee };
  }

  /**
   * Points a held name at `req.target`. A hardware wallet signs in the
   * approval window; a keyfile signs here, after the same build is read
   * back against the request.
   */
  async setNameTarget(req: NameTargetRequest): Promise<{ txId: string }> {
    const method = await this.keySession.getWalletMethod(req.walletId);
    const refusal = method === null ? null : capabilityRefusal(method, "signTransaction", "change a name's target");
    if (refusal) throw new Error(refusal);
    if (method !== null && isHardwareWalletMethod(method)) {
      if (!this.approvals?.requestNameTarget) throw new Error(dappError("Hardware wallet name changes aren't wired to the approval window."));
      return this.approvals.requestNameTarget(req);
    }
    const settings = await this.loadNetworkSettings();
    const signer = await this.signerFor(req.walletId);
    let txId: string;
    try {
      const unsigned = await this.prepareDeviceNameTarget(req, signer.owner);
      assertNameTargetMatches({ carrier: req.carrier, target: req.target, fee: approvedFee(req) }, unsigned);
      ({ txId } = await finishArweaveTransfer(
        settings.gatewayUrl,
        unsigned.transaction,
        await signTransactionWithSigner(unsigned.transaction, signer),
        signer.owner,
      ));
    } catch (error) {
      console.error(`setNameTarget failed (carrier=${req.carrier}):`, error);
      throw error;
    }
    await this.recordNameTarget(signer.address, req);
    return { txId };
  }

  /**
   * The unsigned `set` `ownerB64Url` signs. The carrier's state is read
   * live first: a name sold or listed since the gallery loaded is refused
   * before anything is signed.
   */
  async prepareDeviceNameTarget(req: NameTargetRequest, ownerB64Url: string): Promise<UnsignedPayload & { kind: "transaction" }> {
    const settings = await this.loadNetworkSettings();
    const wallet = await this.loadWallet(req.walletId);
    const fee = approvedFee(req);
    const [, balance] = await Promise.all([
      assertHoldsName(req.carrier, wallet.address, await this.carrierHosts(settings)),
      getArBalance(wallet.address, settings.gatewayUrl),
    ]);
    assertCoversNetworkFee(balance, fee);
    const transaction = await prepareNameTarget(settings.gatewayUrl, ownerB64Url, req.carrier, req.target, fee);
    return { kind: "transaction", transaction };
  }

  /** Posts a device-signed `set` and updates the cached name. */
  async finishDeviceNameTarget(
    req: NameTargetRequest,
    unsigned: UnsignedPayload,
    signature: Uint8Array,
    expectedOwner: string,
  ): Promise<{ txId: string }> {
    if (unsigned.kind !== "transaction") throw new Error(dappError("A name change is an L1 transaction."));
    const wallet = await this.loadWallet(req.walletId);
    const settings = await this.loadNetworkSettings();
    let txId: string;
    try {
      ({ txId } = await finishArweaveTransfer(settings.gatewayUrl, unsigned.transaction, signature, expectedOwner));
    } catch (error) {
      console.error(`Device name change failed (carrier=${req.carrier}):`, error);
      throw error;
    }
    await this.recordNameTarget(wallet.address, req);
    return { txId };
  }

  /** Never throws: the network has already accepted the change. */
  private async recordNameTarget(address: string, req: NameTargetRequest): Promise<void> {
    try {
      await this.collectibles?.setCachedNameTarget?.({ address, id: req.carrier, target: req.target });
    } catch (error) {
      console.error(`Couldn't update the cached name ${req.carrier}:`, error);
    }
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
    assertCoversNetworkFee(balance, approvedFee(req));
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
    assertCoversNetworkFee(balance, approvedFee(req));
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

  /**
   * Never throws: the network has already accepted the send, and an error
   * here would show it as failed and invite the user to send it again.
   */
  private async recordSend(address: string, req: SubmitTransferRequest, txId: string): Promise<void> {
    try {
      await this.writeSendRecord(address, req, txId);
    } catch (error) {
      console.error(`Couldn't record the accepted send ${txId}:`, error);
    }
  }

  private async writeSendRecord(address: string, req: SubmitTransferRequest, txId: string): Promise<void> {
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
