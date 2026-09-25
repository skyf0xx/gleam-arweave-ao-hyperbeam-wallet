import { defineExtensionMessaging } from "@webext-core/messaging";
import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import {
  DEFAULT_BUNDLER_URL,
  PERMISSION_TYPES,
  PROVIDER_METHODS,
  bytesToBase64,
  missingPermissions,
  verifyMessage,
  type ConnectAppInfo,
  type NetworkSettings,
  type PermissionType,
  type WalletSummary,
} from "@gleam/core";
import { resolveInitialGatewayUrl } from "@gleam/core/src/arweave/first-run-gateway.ts";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import {
  PROVIDER_EVENT,
  PROVIDER_SURFACE_METHODS,
  type ConnectEventPayload,
  type DisconnectEventPayload,
  type ProviderEventName,
  type ProviderSurfaceMethod,
  type WalletSwitchEventPayload,
} from "@gleam/messaging/src/page-protocol.ts";
import { WxtStoragePort } from "@/src/adapters/storage";
import { WxtWindowPort } from "@/src/adapters/windows";
import { WalletLifecycleHandler } from "@/src/handlers/wallet-lifecycle";
import { ReadsHandler, registerActivityPromotionAlarm } from "@/src/handlers/reads";
import { ContactsHandler } from "@/src/handlers/contacts";
import { TransferHandler } from "@/src/handlers/transfer";
import { UploadHandler } from "@/src/handlers/upload";
import { ApprovalHandler } from "@/src/handlers/approval";
import {
  decodeProviderParams,
  encodeProviderResult,
  readBytes,
  readDataItem,
  readDataItems,
  readEncryptAlgorithm,
  readHashAlgorithm,
  readProcessId,
  readSaltLength,
  readTransaction,
  type ProviderArgs,
} from "@/src/handlers/provider-params";
import { contentScriptOrigin, isExtensionPageSender } from "@/src/sender";
import { estimateFee } from "@gleam/core/src/arweave/transfer.ts";

/**
 * The background service worker: builds the adapters and handlers and
 * registers every `ProtocolMap` method.
 *
 * Every message is checked against Chrome's `sender`, never against
 * anything the message body claims. `providerCall` is the only method a
 * content script may send, and its origin is the sending frame's origin.
 * Every other method (key export, wallet creation, approval resolution,
 * settings) is accepted only from this extension's own pages. Within
 * `providerCall`, the method must also be in `PROVIDER_METHODS`, which is
 * disjoint from the approval and key tiers.
 */
const messenger = defineExtensionMessaging<ProtocolMap>();
const extensionBaseUrl = browser.runtime.getURL("");

/**
 * `onMessage` for methods only this extension's pages may call. A content
 * script shares the extension's messaging channel, so without this check a
 * compromised page's content script could export keys or approve its own
 * requests.
 */
const onExtensionMessage: typeof messenger.onMessage = (type, onReceived) =>
  messenger.onMessage(type, (message) => {
    if (!isExtensionPageSender(message.sender, extensionBaseUrl)) {
      throw new Error(`"${String(type)}" can only be called from the Gleam extension.`);
    }
    return onReceived(message);
  });

const storage = new WxtStoragePort();
const windows = new WxtWindowPort(storage);

const lifecycle = new WalletLifecycleHandler(storage);
const reads = new ReadsHandler(storage);
const transfer = new TransferHandler(storage);
const upload = new UploadHandler(storage);
const contacts = new ContactsHandler(storage);
const approval = new ApprovalHandler(
  storage,
  windows,
  transfer,
  DEFAULT_BUNDLER_URL,
  async () => (await lifecycle.getState()).activeWalletId,
  reads,
);

// Advances locally-pending activity entries to confirmed on a background
// interval, independent of any popup being open — see reads.ts's own
// doc comment on registerActivityPromotionAlarm.
registerActivityPromotionAlarm(reads);

// No runtime.onSuspend handler clears the key cache. onSuspend fires when
// the worker idles out (~30s), not only on browser shutdown, so clearing
// there locked every wallet behind the user's back.
// The cache lives in chrome.storage.session, which is memory-only and
// dropped when the browser closes; lockWallet and auto-lock clear it.

/**
 * Finds every open tab whose URL origin matches `origin` exactly, since
 * nothing about `providerEvent`'s wire shape itself carries an origin
 * check. `browser.tabs.query`'s own `url` match pattern can't express
 * "exact origin, any path" directly, so this filters candidate tabs
 * (queried broadly by scheme) down to an exact
 * `new URL(tab.url).origin === origin` match by hand.
 */
async function findTabsForOrigin(origin: string): Promise<number[]> {
  const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
  const ids: number[] = [];
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || !tab.url) continue;
    try {
      if (new URL(tab.url).origin === origin) ids.push(tab.id);
    } catch {
      // Not a parseable URL — never a candidate.
    }
  }
  return ids;
}

/**
 * Sends a `providerEvent` push to every tab currently showing `origin` —
 * never a broadcast to every open tab. Each `sendMessage` targets one
 * `tabId` at a time (`@webext-core/messaging`'s targeted-send overload);
 * a tab with no content script listening (e.g. mid-navigation) simply
 * rejects that one send, which is swallowed here rather than failing the
 * caller — a missed push is not itself an error the connect/disconnect/
 * switchWallet flow should surface.
 */
async function emitProviderEventToOrigin<TName extends ProviderEventName>(
  origin: string,
  event: TName,
  data: TName extends typeof PROVIDER_EVENT.CONNECT
    ? ConnectEventPayload
    : TName extends typeof PROVIDER_EVENT.DISCONNECT
      ? DisconnectEventPayload
      : WalletSwitchEventPayload,
): Promise<void> {
  const tabIds = await findTabsForOrigin(origin);
  await Promise.all(
    tabIds.map((tabId) =>
      messenger.sendMessage("providerEvent", { event, data }, tabId).catch(() => undefined),
    ),
  );
}

/**
 * `walletSwitch` broadcast for an active-account change: unlike
 * connect/disconnect (inherently one-origin actions), a wallet switch
 * affects the whole extension, so every origin currently holding an
 * active `Grant` gets the push — never every open tab.
 * `getConnectedApps` is unfiltered by expiry, so this re-checks
 * `findActiveGrant` per origin so an expired Grant is silently excluded
 * rather than pushed to.
 */
async function broadcastWalletSwitch(address: string): Promise<void> {
  const grants = await approval.getConnectedApps();
  const origins = [...new Set(grants.map((grant) => grant.origin))];
  await Promise.all(
    origins.map(async (origin) => {
      const activeGrant = await approval.findActiveGrant(origin);
      if (!activeGrant) return;
      await emitProviderEventToOrigin(origin, PROVIDER_EVENT.WALLET_SWITCH, { address });
    }),
  );
}

/**
 * The dApp's own claim of who it is, passed to `connect(permissions,
 * appInfo)` per ArConnect's `AppInfo` shape. Untrusted input — only the
 * two display fields are kept, and only when they're strings, so a
 * malformed or hostile payload degrades to `null` (the approval screen's
 * origin-derived fallback) instead of throwing or storing garbage.
 */
/** Caps `appInfo.name` so an unbounded dApp-supplied string can't break the approval screen's layout. */
const APP_INFO_NAME_MAX_LENGTH = 64;

function readAppInfo(value: unknown): ConnectAppInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { name?: unknown; logo?: unknown };
  const trimmedName = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const name = trimmedName.length > 0 ? trimmedName.slice(0, APP_INFO_NAME_MAX_LENGTH) : null;
  const logo = typeof candidate.logo === "string" ? candidate.logo : null;
  if (name === null && logo === null) return null;
  return { name, logo };
}

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

/**
 * A hung HyperBEAM peer (or gateway metadata lookup) must not delay opening
 * a `transferAoTokens` approval — the user is waiting on a signing prompt,
 * not a balance read. Races `ReadsHandler.previewWatchedToken` against this
 * timeout, resolving to "unresolved" either way rather than ever rejecting.
 */
const TOKEN_METADATA_LOOKUP_TIMEOUT_MS = 3_000;

async function resolveTokenDenominationAndTicker(
  address: string,
  processId: string,
): Promise<{ tokenDenomination: number | null; tokenTicker: string | null }> {
  const UNRESOLVED = { tokenDenomination: null, tokenTicker: null };
  const lookup = reads
    .previewWatchedToken({ address, processId })
    .then((balance) => (balance.available === false ? UNRESOLVED : { tokenDenomination: balance.denomination, tokenTicker: balance.ticker }))
    .catch(() => UNRESOLVED);
  const timeout = new Promise<typeof UNRESOLVED>((resolve) =>
    setTimeout(() => resolve(UNRESOLVED), TOKEN_METADATA_LOOKUP_TIMEOUT_MS),
  );
  return Promise.race([lookup, timeout]);
}

/**
 * Maps a `PROVIDER_SURFACE_METHODS` name + already-origin-checked params
 * into the actual read/approval-flow work, distinct from `providerCall`'s
 * own job (the privilege-tier gate). No `WalletState` read here ever
 * exposes an address for an origin without an active `Grant` — every
 * branch below either reads through `approval.findActiveGrant` first or
 * is itself the `connect` call that creates one.
 */
async function handleProviderCall(
  origin: string,
  method: ProviderSurfaceMethod,
  params: ProviderArgs,
): Promise<unknown> {
  if (method === "connect") {
    const requested = Array.isArray((params as { permissions?: unknown } | undefined)?.permissions)
      ? ((params as { permissions: unknown[] }).permissions.filter(
          (value): value is PermissionType =>
            typeof value === "string" && (PERMISSION_TYPES as readonly string[]).includes(value),
        ) as PermissionType[])
      : [];

    const wanted: PermissionType[] = requested.length > 0 ? requested : ["ACCESS_ADDRESS"];
    const appInfo = readAppInfo((params as { appInfo?: unknown } | undefined)?.appInfo);
    const state = await lifecycle.getState();

    // Many dApps call connect() on every page load. An origin whose grant
    // already covers the request resolves without a prompt; otherwise only
    // the missing permissions are asked for, and approval merges them in.
    // Without a wallet there is nothing to connect to, so a leftover grant
    // never short-circuits onboarding.
    const existing = state.activeWalletId ? await approval.findActiveGrant(origin) : null;
    const newPermissions = existing
      ? wanted.filter((permission) => !existing.permissions.includes(permission))
      : wanted;
    if (existing && newPermissions.length === 0) {
      return { granted: existing.permissions };
    }

    // With no wallet yet, the approval window runs onboarding before it
    // shows the request, and the grant goes to the wallet created there.
    // A locked wallet is unlocked in that window the same way.
    const result = await approval.requestApproval({
      kind: "connect",
      origin,
      walletId: state.activeWalletId,
      requestedPermissions: newPermissions,
      appInfo,
    });

    // Reached only once the user approved: a rejected or timed-out request
    // throws. ArConnect fires `connect` once connect() resolves.
    const connectedState = await lifecycle.getState();
    const connectedWallet = connectedState.wallets.find(
      (candidate) => candidate.id === connectedState.activeWalletId,
    );
    if (connectedWallet) {
      void emitProviderEventToOrigin(origin, PROVIDER_EVENT.CONNECT, {
        activeAddress: connectedWallet.address,
      });
    }

    return result;
  }

  if (method === "disconnect") {
    await approval.revokeGrant({ origin });
    void emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});
    return undefined;
  }

  const grant = await approval.findActiveGrant(origin);
  if (!grant) {
    throw new Error(`"${origin}" is not connected. Call connect() first.`);
  }

  const missing = missingPermissions(method, grant.permissions);
  if (missing.length > 0) {
    throw new Error(`Missing permission(s) for "${method}": ${missing.join(", ")}`);
  }

  // A grant belongs to the origin, not to one wallet: every read and
  // signing request follows the wallet the user has switched to, which is
  // the address the `walletSwitch` event already announced.
  // `grant.walletId` only records which wallet approved the connection.
  const state = await lifecycle.getState();
  const wallet = state.wallets.find((candidate) => candidate.id === state.activeWalletId) ?? null;
  const activeWalletId = (): string => {
    if (!wallet) throw new Error("No active wallet to sign with.");
    return wallet.id;
  };

  switch (method) {
    case "getPermissions":
      return grant.permissions;
    case "getActiveAddress":
      return wallet?.address ?? null;
    case "getAllAddresses":
      return state.wallets.map((candidate) => candidate.address);
    case "getActivePublicKey":
      return wallet?.publicKey ?? null;
    case "getWalletNames":
      return Object.fromEntries(state.wallets.map((candidate) => [candidate.address, candidate.name]));
    case "getArweaveConfig": {
      const { gatewayUrl } = await reads.getNetworkSettings();
      return arweaveConfigFromGatewayUrl(gatewayUrl);
    }
    case "getBalances":
      if (!wallet) throw new Error("No active wallet to read balances for.");
      return { ar: await reads.getBalance({ address: wallet.address }) };

    case "sign":
    case "dispatch": {
      const transaction = readTransaction(params.transaction, method);
      const { gatewayUrl } = await reads.getNetworkSettings();
      // The dApp's reward is the fee actually charged; only fall back to a
      // fresh quote (matching `signTransaction`/`dispatchTransaction`'s own
      // arweave-js default) when it left the field out, so the preview
      // never shows a fee different from what gets signed.
      const fee =
        transaction.reward ?? (await estimateFee(gatewayUrl, transaction.target, transaction.data.byteLength)).fee;
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: activeWalletId(),
        recipient: transaction.target ?? null,
        amount: transaction.target ? (transaction.quantity ?? "0") : null,
        fee,
        payload: transaction.data,
        tags: transaction.tags,
        gatewayUrl,
        target: transaction.target,
        quantity: transaction.quantity,
        reward: transaction.reward,
        last_tx: transaction.last_tx,
      });
    }

    case "signDataItem":
    case "batchSignDataItem": {
      const items =
        method === "signDataItem"
          ? [readDataItem(params.dataItem, method)]
          : readDataItems(params.dataItems);
      const [first] = items;
      return approval.requestApproval({
        kind: method,
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
      });
    }

    case "encrypt":
    case "decrypt":
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: activeWalletId(),
        payload: readBytes(params.data, "data", method === "encrypt" ? "utf8" : "reject"),
        encryptAlgorithm: readEncryptAlgorithm(params.options, method),
      });

    case "transferAoTokens": {
      const transferParams = params as { token?: string; recipient?: string; amount?: string };
      if (!transferParams.token || !transferParams.recipient || !transferParams.amount) {
        throw new Error("transferAoTokens requires token, recipient, and amount.");
      }
      if (!wallet) throw new Error("No active wallet to sign with.");

      // Best-effort: the same denomination/ticker read the token list uses
      // for balances, so the approval amount can render scaled with its
      // ticker instead of as a raw atomic integer. A failed, unresolvable,
      // or hanging lookup (unconfigured peer, unreachable HyperBEAM node)
      // must never block or delay showing the approval — raced against
      // `TOKEN_METADATA_LOOKUP_TIMEOUT_MS` so a hung peer can't stall the
      // window open. `formatAmount`/`formatAmountUnit` fall back to the raw
      // amount and a "smallest units" label when either comes back `null`.
      const { tokenDenomination, tokenTicker } = await resolveTokenDenominationAndTicker(
        wallet.address,
        transferParams.token,
      );

      return approval.requestApproval({
        kind: "transferAoTokens",
        origin,
        walletId: activeWalletId(),
        recipient: transferParams.recipient,
        amount: transferParams.amount,
        fee: null,
        token: transferParams.token,
        tokenDenomination,
        tokenTicker,
        payload: new Uint8Array(),
        tags: [],
      });
    }

    case "signature":
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: activeWalletId(),
        payload: readBytes(params.data, "data"),
        saltLength: readSaltLength(params.options, method),
      });

    case "signMessage":
    case "privateHash":
      return approval.requestApproval({
        kind: method,
        origin,
        walletId: activeWalletId(),
        payload: readBytes(params.data, "data"),
        hashAlgorithm: readHashAlgorithm(params.options, method),
      });

    case "verifyMessage": {
      // Verification uses only public material, so it needs no approval.
      // Wander defaults `publicKey` to the active wallet's key.
      const data = readBytes(params.data, "data");
      const signature = readBytes(params.signature, "signature", "base64url");
      const publicKey = params.publicKey ?? wallet?.publicKey;
      if (typeof publicKey !== "string" || publicKey.length === 0) {
        throw new Error("verifyMessage needs a publicKey when no wallet is active.");
      }
      return verifyMessage(
        publicKey,
        data.buffer,
        signature.buffer,
        readHashAlgorithm(params.options, "verifyMessage"),
      );
    }

    case "tokenBalance": {
      if (!wallet) throw new Error("No active wallet to read a token balance for.");
      // The id becomes a path segment of the HyperBEAM URL.
      return reads.tokenBalance({ address: wallet.address, id: readProcessId(params.id, method) });
    }

    case "userTokens": {
      if (!wallet) throw new Error("No active wallet to read tokens for.");
      const options = params.options as { fetchBalance?: unknown } | null | undefined;
      return reads.userTokens({ address: wallet.address, options: { fetchBalance: options?.fetchBalance === true } });
    }

    case "isTokenAdded": {
      if (!wallet) throw new Error("No active wallet to check tokens for.");
      return reads.isTokenAdded({ address: wallet.address, processId: readProcessId(params.id, method) });
    }

    case "addToken": {
      if (!wallet) throw new Error("No active wallet to add a token to.");
      const processId = readProcessId(params.id, method);
      // Already listed: nothing to ask the user.
      if (await reads.isTokenAdded({ address: wallet.address, processId })) return undefined;
      // Resolving first proves the id answers as a token, and gives the
      // prompt a ticker and name to show instead of only the id.
      const token = await reads.previewWatchedToken({ address: wallet.address, processId });
      return approval.requestApproval({
        kind: "addToken",
        origin,
        walletId: wallet.id,
        address: wallet.address,
        processId,
        // `getTokenBalance` echoes the process id when it finds no ticker.
        ticker: token.ticker === processId ? null : token.ticker,
        name: token.name,
      });
    }

    default:
      // Not a `never`-exhaustive check: `ProviderSurfaceMethod` can grow
      // ahead of this switch being updated to handle a new method, so an
      // unhandled method is a named runtime failure here rather than a
      // compile error.
      throw new Error(`Provider method "${String(method)}" is not implemented yet.`);
  }
}

async function setLockedIcon(locked: boolean) {
  const suffix = locked ? '-locked' : ''

  await browser.action.setIcon({
    path: {
      16: `/icon/16${suffix}.png`,
      32: `/icon/32${suffix}.png`,
      48: `/icon/48${suffix}.png`,
      128: `/icon/128${suffix}.png`,
    },
  })
}

// wallet lifecycle
// A new wallet becomes the active one. Connected dApps follow the active
// wallet, so they hear about it; with no earlier wallet there is nothing
// connected to tell.
async function addWallet(add: () => Promise<WalletSummary>): Promise<WalletSummary> {
  const before = await lifecycle.getState();
  const summary = await add();
  if (before.activeWalletId !== null) void broadcastWalletSwitch(summary.address);
  return summary;
}
onExtensionMessage("createWallet", (message) => addWallet(() => lifecycle.createWallet(message.data)));
onExtensionMessage("importWallet", (message) => addWallet(() => lifecycle.importWallet(message.data)));
onExtensionMessage("deleteWallet", async (message) => {
  const { walletId } = message.data;
  const before = await lifecycle.getState();
  const isLastWallet = before.wallets.every((candidate) => candidate.id === walletId);

  // Grants follow the active wallet, so they only go when no wallet is left
  // to follow, as on reset.
  let revoked: string[] = [];
  if (isLastWallet) {
    revoked = await approval.revokeAllAccess("The wallet was removed.");
  } else {
    await approval.rejectWalletApprovals(walletId);
  }
  await lifecycle.deleteWallet(message.data);
  for (const origin of revoked) void emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});

  const after = await lifecycle.getState();
  if (after.activeWalletId !== before.activeWalletId) {
    const active = after.wallets.find((candidate) => candidate.id === after.activeWalletId);
    if (active) void broadcastWalletSwitch(active.address);
  }
});
onExtensionMessage("renameWallet", (message) => lifecycle.renameWallet(message.data));
onExtensionMessage("switchWallet", async (message) => {
  await lifecycle.switchWallet(message.data);
  // `switchWallet`'s locked signature returns `void`, so the resulting
  // active address is derived here from `getState()` after the call
  // resolves.
  const state = await lifecycle.getState();
  const active = state.wallets.find((candidate) => candidate.id === state.activeWalletId);
  if (active) {
    void broadcastWalletSwitch(active.address);
  }
});
onExtensionMessage("exportWallet", (message) => lifecycle.exportWallet(message.data));
onExtensionMessage("confirmWalletBackup", (message) => lifecycle.confirmWalletBackup(message.data));
onExtensionMessage("lockWallet", async () => {
  await lifecycle.lockWallet();
  void setLockedIcon(true);
});
onExtensionMessage("unlockWallet", async (message) => {
  const result = await lifecycle.unlockWallet(message.data);
  void setLockedIcon(false);
  return result;
});
onExtensionMessage("resetAllWallets", async () => {
  // Grants go first, here and when deleteWallet removes the last wallet: a
  // removal that fails part-way must not leave a dApp connected to nothing.
  const revoked = await approval.revokeAllAccess();
  await lifecycle.resetAllWallets();
  for (const origin of revoked) void emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});
});

// reads
onExtensionMessage("getState", () => lifecycle.getState());
onExtensionMessage("getBalance", (message) => reads.getBalance(message.data));
onExtensionMessage("getArFee", () => transfer.getArFee());
onExtensionMessage("getTokenBalances", (message) => reads.getTokenBalances(message.data));
onExtensionMessage("getWatchedTokens", (message) => reads.getWatchedTokens(message.data));
onExtensionMessage("previewWatchedToken", (message) => reads.previewWatchedToken(message.data));
onExtensionMessage("addWatchedToken", (message) => reads.addWatchedToken(message.data));
onExtensionMessage("removeWatchedToken", (message) => reads.removeWatchedToken(message.data));
onExtensionMessage("getActivity", (message) => reads.getActivity(message.data));
onExtensionMessage("getPortfolioHistory", (message) => reads.getPortfolioHistory(message.data));
onExtensionMessage("getTokenPrices", () => reads.getTokenPrices());
onExtensionMessage("getConnectedApps", () => approval.getConnectedApps());
onExtensionMessage("listContacts", () => contacts.listContacts());

/**
 * `TransferDraft`/`UploadDraft` type `walletId` as optional. Every real
 * caller (`SendView`/`UploadView`) always supplies it, but the wire type
 * itself can't promise that — this guard turns a missing field into a
 * named rejection rather than `undefined` silently reaching the
 * key-session lookup as a wallet id. The request carries no signing
 * material — see `key-session.ts`.
 */
function requireWalletId<T extends { walletId?: string }>(draft: T): T & { walletId: string } {
  if (!draft.walletId) {
    throw new Error("This action requires a wallet id.");
  }
  return draft as T & { walletId: string };
}

// actions
onExtensionMessage("estimateTransfer", (message) => transfer.estimateTransfer(requireWalletId(message.data)));
onExtensionMessage("submitTransfer", (message) => transfer.submitTransfer(requireWalletId(message.data)));
onExtensionMessage("reviewUpload", (message) => upload.reviewUpload(message.data));
onExtensionMessage("submitUpload", (message) => upload.submitUpload(requireWalletId(message.data)));

// approvals
onExtensionMessage("getApproval", (message) => approval.getApproval(message.data));
onExtensionMessage("resolveApproval", (message) => approval.resolveApproval(message.data));

// settings
onExtensionMessage("getNetworkSettings", () => reads.getNetworkSettings());
onExtensionMessage("setNetworkSettings", (message) => storage.set("local:networkSettings", message.data));
onExtensionMessage("getLockSettings", () => lifecycle.getLockSettings());
onExtensionMessage("setLockSettings", (message) => lifecycle.setLockSettings(message.data));
onExtensionMessage("getThemePreference", () => lifecycle.getThemePreference());
onExtensionMessage("setThemePreference", (message) => lifecycle.setThemePreference(message.data));
onExtensionMessage("revokeGrant", async (message) => {
  await approval.revokeGrant(message.data);
  void emitProviderEventToOrigin(message.data.origin, PROVIDER_EVENT.DISCONNECT, {});
});
onExtensionMessage("saveContact", (message) => contacts.saveContact(message.data));
onExtensionMessage("deleteContact", (message) => contacts.deleteContact(message.data));

// The only method a web page can reach, through the content script.
messenger.onMessage("providerCall", (message) => {
  const origin = contentScriptOrigin(message.sender, extensionBaseUrl);
  if (!origin) {
    throw new Error("providerCall is only accepted from a web page's content script.");
  }
  const { method, params } = message.data;
  if (!PROVIDER_METHODS.includes(method as (typeof PROVIDER_METHODS)[number])) {
    throw new Error(`Provider method "${method}" is not reachable from a web page.`);
  }
  if (!PROVIDER_SURFACE_METHODS.includes(method)) {
    throw new Error(`Unknown provider method "${method}".`);
  }
  return (async () =>
    encodeProviderResult(await handleProviderCall(origin, method, decodeProviderParams(params))))();
});

const NETWORK_SETTINGS_KEY = "local:networkSettings";

/**
 * First-run gateway fallback: if `local:networkSettings` has never been
 * written, checks whether `arweave.net` actually answers as a gateway
 * and, if not, tries `FALLBACK_GATEWAY_URLS` in order
 * (`resolveInitialGatewayUrl` — pure, given `fetch`). Only ever writes
 * `NETWORK_SETTINGS_KEY` when it was previously empty, so a user's own
 * gateway choice is never touched. Errors are swallowed: this must never
 * block startup, and `reads.ts`'s own `DEFAULT_NETWORK_SETTINGS` fallback
 * already covers "nothing was ever written" for every other read path.
 */
async function initializeNetworkSettingsIfMissing(): Promise<void> {
  try {
    const existing = await storage.get<NetworkSettings>(NETWORK_SETTINGS_KEY);
    if (existing !== null) return;

    const gatewayUrl = await resolveInitialGatewayUrl();
    const settings = await reads.getNetworkSettings();
    await storage.set(NETWORK_SETTINGS_KEY, { ...settings, gatewayUrl });
  } catch {
    // Never block startup over a first-run gateway probe.
  }
}

export default defineBackground(() => {
  // Registration above runs at module-evaluation time: `onMessage` must
  // be called once per JS context, not per `defineBackground` invocation,
  // since MV3 service workers only evaluate this module once per
  // wake-up.
  //
  // `runtime.onInstalled` fires once, on first install (not on every
  // service-worker wake-up), which is exactly when
  // `initializeNetworkSettingsIfMissing`'s "nothing written yet" check is
  // meaningful — after that, a written NetworkSettings (default or
  // user-edited) always short-circuits it anyway.
  browser.runtime.onInstalled.addListener(() => {
    void initializeNetworkSettingsIfMissing();
  });
});
