import {
  bundlerUrlOf,
  bytesToBase64,
  capabilitiesFor,
  dispatchesViaBundler,
  HARDWARE_MESSAGE_HASH,
  isHardwareWalletMethod,
  isWatchWalletMethod,
  verifyMessage,
  type Grant,
  type ProviderMethod,
  type WalletState,
  type Winston,
  WATCH_ONLY_CONNECT_REFUSAL,
} from "@gleam/core";
import { estimateFee } from "@gleam/core/src/arweave/transfer.ts";
import { readAoTransferMessage } from "@gleam/core/src/ao/transfer-message.ts";
import { readL1TokenTransfer } from "@gleam/core/src/ao/l1-transfer.ts";
import { COLLECTIBLE_TRANSFER_QUANTITY } from "@gleam/core/src/ao/collectible-transfer.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import {
  PROVIDER_EVENT,
  type ConnectEventPayload,
  type DisconnectEventPayload,
  type ProviderEventName,
  type WalletSwitchEventPayload,
} from "@gleam/messaging/src/page-protocol.ts";
import type { PAGE_METHODS, PageParams } from "../dispatch/methods";
import { dappError } from "../dapp-error";
import type { ApprovalHandler } from "./approval";
import type { ProviderDataItem, ProviderTransaction } from "./provider-params";
import type { ReadsHandler } from "./reads";
import type { SiteWalletHandler } from "./site-wallet";
import type { WalletLifecycleHandler } from "./wallet-lifecycle";

/**
 * ArConnect's `getArweaveConfig()` shape, derived from the wallet's own
 * `NetworkSettings.gatewayUrl` rather than a dApp-supplied `connect(...,
 * gateway)` hint — a dApp doesn't get to redirect a connected wallet's
 * reads to a gateway of its choosing.
 */
function arweaveConfigFromGatewayUrl(gatewayUrl: string): { protocol: string; host: string; port: number } {
  const url = new URL(gatewayUrl);
  const protocol = url.protocol.replace(":", "");
  const port = url.port ? Number(url.port) : protocol === "https" ? 443 : 80;
  return { protocol, host: url.hostname, port };
}

/** What a provider handler gets once the dispatcher has checked the origin's grant. */
export interface GrantedCall {
  origin: string;
  grant: Grant;
  state: WalletState;
  /**
   * The wallet the user has switched to. A grant belongs to the origin, not
   * to one wallet: every read and signing request follows the active
   * wallet, the address the `walletSwitch` event already announced.
   * `grant.walletId` only records which wallet approved the connection.
   */
  wallet: WalletState["wallets"][number] | null;
  activeWalletId(): string;
}

/**
 * How a provider handler opens an approval window. Only a method whose
 * `PAGE_METHODS` entry says `approval: true` gets it, so the table's flag
 * is what decides whether a page call can put a window in front of the
 * user. This module never receives the approval handler itself, only
 * `ProviderDeps.grants`, and dependency-cruiser holds it to type-only
 * imports of `approval.ts`.
 */
export interface ApprovalCall {
  requestApproval: ApprovalHandler["requestApproval"];
}

export type ProviderHandlers = {
  [M in ProviderMethod]: (
    params: PageParams<M>,
    call: ((typeof PAGE_METHODS)[M]["grant"] extends true ? GrantedCall : { origin: string }) &
      ((typeof PAGE_METHODS)[M]["approval"] extends true ? ApprovalCall : object),
  ) => Promise<unknown>;
};

export type ProviderEventData<TName extends ProviderEventName> = TName extends typeof PROVIDER_EVENT.CONNECT
  ? ConnectEventPayload
  : TName extends typeof PROVIDER_EVENT.DISCONNECT
    ? DisconnectEventPayload
    : WalletSwitchEventPayload;

export interface TokenPreview {
  tokenDenomination: number | null;
  tokenTicker: string | null;
  collectible: boolean;
}

/**
 * What the page handlers may reach. Grants come as two functions, not the
 * approval handler: a window opens only through the `requestApproval` a
 * call carries, which the dispatcher hands only to `approval: true` methods.
 */
export interface ProviderDeps {
  lifecycle: Pick<WalletLifecycleHandler, "getState">;
  reads: Pick<
    ReadsHandler,
    "getNetworkSettings" | "getBalance" | "tokenBalance" | "userTokens" | "isTokenAdded" | "previewWatchedToken"
  >;
  siteWallet: Pick<SiteWalletHandler, "setUseGleam">;
  grants: {
    findActiveGrant(origin: string): Promise<Grant | null>;
    revokeGrant(req: { origin: string }): Promise<void>;
  };
  favIconFor(origin: string): Promise<string | null>;
  readableActiveAddress(origin: string): Promise<string | null>;
  emitProviderEventToOrigin<TName extends ProviderEventName>(
    origin: string,
    event: TName,
    data: ProviderEventData<TName>,
  ): Promise<void>;
  pushSiteWalletMode(origin: string, useGleam: boolean): Promise<void>;
  resolveTokenPreview(address: string, processId: string): Promise<TokenPreview>;
  quoteTokenTransferFee(processId: string): Promise<Winston | null>;
}

export function createProviderHandlers(deps: ProviderDeps): ProviderHandlers {
  const {
    lifecycle,
    reads,
    siteWallet,
    grants,
    favIconFor,
    readableActiveAddress,
    emitProviderEventToOrigin,
    pushSiteWalletMode,
    resolveTokenPreview,
    quoteTokenTransferFee,
  } = deps;

  /**
   * The work behind each `PAGE_METHODS` entry. Params arrive parsed, and
   * for every method but `connect`/`disconnect` the origin's active grant
   * and permissions have been checked, so no handler here exposes an
   * address to an origin without a grant.
   */
  const handlers: ProviderHandlers = {
    async connect({ permissions: wanted, appInfo }, { origin, requestApproval }) {
      const state = await lifecycle.getState();
      const active = state.wallets.find((candidate) => candidate.id === state.activeWalletId);
      if (active && isWatchWalletMethod(active.method)) throw new Error(WATCH_ONLY_CONNECT_REFUSAL);

      // Many dApps call connect() on every page load. An origin whose grant
      // already covers the request resolves without a prompt; otherwise only
      // the missing permissions are asked for, and approval merges them in.
      // Without a wallet there is nothing to connect to, so a leftover grant
      // never short-circuits onboarding.
      const existing = state.activeWalletId ? await grants.findActiveGrant(origin) : null;
      const newPermissions = existing
        ? wanted.filter((permission) => !existing.permissions.includes(permission))
        : wanted;
      if (existing && newPermissions.length === 0) {
        return { granted: existing.permissions };
      }

      // With no wallet yet, the approval window runs onboarding before it
      // shows the request, and the grant goes to the wallet created there.
      // A locked wallet is unlocked in that window the same way.
      const result = await requestApproval({
        kind: "connect",
        origin,
        walletId: state.activeWalletId,
        requestedPermissions: newPermissions,
        appInfo,
        favIconUrl: await favIconFor(origin),
      });

      // Reached only once the user approved: a rejected or timed-out request
      // throws. ArConnect fires `connect` once connect() resolves.
      const activeAddress = await readableActiveAddress(origin);
      if (activeAddress) void emitProviderEventToOrigin(origin, PROVIDER_EVENT.CONNECT, { activeAddress });
      // A site that connected through `window.gleam` chose Gleam, so its
      // `window.arweaveWallet` stops forwarding to another installed wallet.
      await siteWallet.setUseGleam(origin, true);
      void pushSiteWalletMode(origin, true);

      return result;
    },

    async disconnect(_params, { origin }) {
      await grants.revokeGrant({ origin });
      void emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});
      return undefined;
    },

    async getPermissions(_params, { grant }) {
      return grant.permissions;
    },
    async getActiveAddress(_params, { wallet }) {
      return wallet?.address ?? null;
    },
    async getAllAddresses(_params, { state }) {
      return state.wallets.map((candidate) => candidate.address);
    },
    async getActivePublicKey(_params, { wallet }) {
      return wallet?.publicKey ?? null;
    },
    async getWalletNames(_params, { state }) {
      return Object.fromEntries(state.wallets.map((candidate) => [candidate.address, candidate.name]));
    },
    async getArweaveConfig() {
      const { gatewayUrl } = await reads.getNetworkSettings();
      return arweaveConfigFromGatewayUrl(gatewayUrl);
    },
    async getBalances(_params, { wallet }) {
      if (!wallet) throw new Error(userErrorMessage("noActiveWalletBalances"));
      return { ar: await reads.getBalance({ address: wallet.address }) };
    },

    sign: ({ transaction }, call) => requestTransactionApproval("sign", transaction, call),
    dispatch: ({ transaction }, call) => requestTransactionApproval("dispatch", transaction, call),

    signDataItem: ({ dataItem }, call) => requestDataItemApproval("signDataItem", [dataItem], call),
    batchSignDataItem: ({ dataItems }, call) => requestDataItemApproval("batchSignDataItem", dataItems, call),

    async encrypt({ data, options }, { origin, activeWalletId, requestApproval }) {
      return requestApproval({ kind: "encrypt", origin, walletId: activeWalletId(), payload: data, encryptAlgorithm: options });
    },
    async decrypt({ data, options }, { origin, activeWalletId, requestApproval }) {
      return requestApproval({ kind: "decrypt", origin, walletId: activeWalletId(), payload: data, encryptAlgorithm: options });
    },

    async transferAoTokens({ token, recipient, amount }, { origin, wallet, activeWalletId, requestApproval }) {
      if (!wallet) throw new Error(userErrorMessage("noActiveWalletSign"));

      // Best-effort: the same denomination/ticker read the token list uses
      // for balances, so the approval amount can render scaled with its
      // ticker instead of as a raw atomic integer. A failed, unresolvable,
      // or hanging lookup (unconfigured peer, unreachable HyperBEAM node)
      // must never block or delay showing the approval — raced against
      // `TOKEN_METADATA_LOOKUP_TIMEOUT_MS` so a hung peer can't stall the
      // window open. `formatAmount`/`formatAmountUnit` fall back to the raw
      // amount and a "smallest units" label when either comes back `null`.
      // A collectible's transfer of 1 shows as that collectible, as the
      // L1 path already does, not as 1 unit of an unknown token.
      const [{ tokenDenomination, tokenTicker, collectible }, fee] = await Promise.all([
        resolveTokenPreview(wallet.address, token),
        quoteTokenTransferFee(token),
      ]);
      const collectibleRef =
        collectible && amount === COLLECTIBLE_TRANSFER_QUANTITY ? { id: token } : null;

      return requestApproval({
        kind: "transferAoTokens",
        origin,
        walletId: activeWalletId(),
        recipient,
        amount,
        fee,
        token,
        tokenDenomination,
        tokenTicker,
        ...(collectibleRef ? { collectible: collectibleRef } : {}),
        payload: new Uint8Array(),
        tags: [],
      });
    },

    async signMessage({ data, options: hashAlgorithm }, { origin, wallet, activeWalletId, requestApproval }) {
      if (
        wallet &&
        isHardwareWalletMethod(wallet.method) &&
        (hashAlgorithm ?? HARDWARE_MESSAGE_HASH) !== HARDWARE_MESSAGE_HASH
      ) {
        throw new Error(dappError(`A hardware wallet signs messages with ${HARDWARE_MESSAGE_HASH} only, not ${hashAlgorithm}.`));
      }
      return requestApproval({ kind: "signMessage", origin, walletId: activeWalletId(), payload: data, hashAlgorithm });
    },

    async verifyMessage({ data, signature, publicKey: givenKey, options: hashAlgorithm }, { wallet }) {
      // Verification uses only public material, so it needs no approval.
      const publicKey = givenKey ?? wallet?.publicKey;
      if (typeof publicKey !== "string" || publicKey.length === 0) {
        throw new Error(dappError("verifyMessage needs a publicKey when no wallet is active."));
      }
      return verifyMessage(publicKey, data.buffer, signature.buffer, hashAlgorithm);
    },

    async tokenBalance({ id }, { wallet }) {
      if (!wallet) throw new Error(userErrorMessage("noActiveWalletTokenBalance"));
      return reads.tokenBalance({ address: wallet.address, id });
    },

    async userTokens({ options }, { wallet }) {
      if (!wallet) throw new Error(userErrorMessage("noActiveWalletTokens"));
      return reads.userTokens({ address: wallet.address, options });
    },

    async isTokenAdded({ id: processId }, { wallet }) {
      if (!wallet) throw new Error(userErrorMessage("noActiveWalletCheckTokens"));
      return reads.isTokenAdded({ address: wallet.address, processId });
    },

    async addToken({ id: processId }, { origin, wallet, requestApproval }) {
      if (!wallet) throw new Error(userErrorMessage("noActiveWalletAddToken"));
      // Already listed: nothing to ask the user.
      if (await reads.isTokenAdded({ address: wallet.address, processId })) return undefined;
      // Resolving first proves the id answers as a token, and gives the
      // prompt a ticker and name to show instead of only the id.
      const token = await reads.previewWatchedToken({ address: wallet.address, processId });
      return requestApproval({
        kind: "addToken",
        origin,
        walletId: wallet.id,
        address: wallet.address,
        processId,
        // `getTokenBalance` echoes the process id when it finds no ticker.
        ticker: token.ticker === processId ? null : token.ticker,
        name: token.name,
      });
    },
  };

  async function requestTransactionApproval(
    kind: "sign" | "dispatch",
    transaction: ProviderTransaction,
    { origin, wallet, activeWalletId, requestApproval }: GrantedCall & ApprovalCall,
  ): Promise<unknown> {
    const settings = await reads.getNetworkSettings();
    const { gatewayUrl } = settings;
    // A token transfer to an arweave-scheduler process moves no AR, so it
    // shows as the token it sends, read from the transaction's own tags.
    // One that can't be read cleanly shows as the plain transaction, warned.
    const reading = transaction.target
      ? readL1TokenTransfer({
          target: transaction.target,
          quantity: transaction.quantity ?? "0",
          data_size: String(transaction.data.byteLength),
          tags: transaction.tags,
        })
      : null;
    const tokenTransfer = reading?.kind === "transfer" ? reading : null;
    const tokenMetadata =
      tokenTransfer && wallet ? await resolveTokenPreview(wallet.address, tokenTransfer.processId) : null;
    // A collectible's transfer of 1 shows as that collectible, as the
    // hardware-wallet step already does, not as 1 unit of an unknown token.
    const collectible =
      tokenTransfer && tokenMetadata?.collectible && tokenTransfer.quantity === COLLECTIBLE_TRANSFER_QUANTITY
        ? { id: tokenTransfer.processId }
        : null;
    // The dApp's reward is the fee actually charged. Without one, the quote
    // the preview shows becomes the reward, so a gateway can't charge more
    // than the user approved. A bundled dispatch carries no reward at all,
    // so its preview shows no fee.
    const bundled =
      kind === "dispatch" &&
      dispatchesViaBundler(transaction, transaction.data.byteLength, {
        viaBundler: capabilitiesFor(wallet?.method ?? "jwk").dispatchViaBundler,
      });
    const fee = bundled
      ? null
      : (transaction.reward ?? (await estimateFee(gatewayUrl, transaction.target, transaction.data.byteLength)).fee);
    return requestApproval({
      kind,
      origin,
      walletId: activeWalletId(),
      ...(collectible && tokenTransfer
        ? { recipient: tokenTransfer.recipient, amount: tokenTransfer.quantity, token: collectible.id, collectible }
        : tokenTransfer
        ? {
            recipient: tokenTransfer.recipient,
            amount: tokenTransfer.quantity,
            token: tokenTransfer.processId,
            tokenDenomination: tokenMetadata?.tokenDenomination ?? null,
            tokenTicker: tokenMetadata?.tokenTicker ?? null,
          }
        : {
            recipient: transaction.target ?? null,
            amount: transaction.target ? (transaction.quantity ?? "0") : null,
            ...(reading ? { unreadableTokenTransfer: true } : {}),
          }),
      fee,
      payload: transaction.data,
      tags: transaction.tags,
      gatewayUrl,
      ...(bundled ? { bundlerUrl: bundlerUrlOf(settings) } : {}),
      target: transaction.target,
      quantity: transaction.quantity,
      reward: fee ?? undefined,
      last_tx: transaction.last_tx,
    });
  }

  async function requestDataItemApproval(
    kind: "signDataItem" | "batchSignDataItem",
    items: ProviderDataItem[],
    { origin, wallet, activeWalletId, requestApproval }: GrantedCall & ApprovalCall,
  ): Promise<unknown> {
    const [first] = items;
    const signed = kind === "signDataItem" ? items.slice(0, 1) : items;
    // Scale and ticker for each AO transfer, so it shows like a
    // `transferAoTokens` request. Unresolved metadata shows raw units; a
    // collectible's transfer of 1 shows as that collectible, as the L1
    // path already does. The full preview is carried, not the
    // denom/ticker-only wrapper, so the flag survives.
    const itemTokenMetadata = await Promise.all(
      signed.map((item) => {
        const transfer = readAoTransferMessage({ target: item.target, tags: item.tags });
        return transfer?.kind === "transfer" && wallet ? resolveTokenPreview(wallet.address, transfer.processId) : null;
      }),
    );
    return requestApproval({
      kind,
      origin,
      walletId: activeWalletId(),
      payload: first!.data,
      tags: first!.tags,
      dataItems: items.map((item) => ({
        data: bytesToBase64(item.data),
        tags: item.tags,
        target: item.target,
        anchor: item.anchor,
      })),
      itemTokenMetadata,
    });
  }

  return handlers;
}
