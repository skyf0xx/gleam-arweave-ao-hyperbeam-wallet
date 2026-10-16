import {
  defineExtensionMessaging,
  type GetDataType,
  type GetReturnType,
  type MaybePromise,
} from "@webext-core/messaging";
import type { z } from "zod";
import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import {
  DEFAULT_BUNDLER_URL,
  POINTS_API_URL,
  REFUSED_PROVIDER_METHODS,
  bytesToBase64,
  missingPermissions,
  HARDWARE_MESSAGE_HASH,
  isHardwareWalletMethod,
  providerMethodRefusal,
  verifyMessage,
  type Grant,
  type NetworkSettings,
  type ProviderMethod,
  type WalletState,
  type WalletSummary,
  vaultHasPassword,
} from "@gleam/core";
import { resolveInitialGatewayUrl } from "@gleam/core/src/arweave/first-run-gateway.ts";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import {
  PROVIDER_EVENT,
  type ConnectEventPayload,
  type DisconnectEventPayload,
  type ProviderEventName,
  type WalletSwitchEventPayload,
} from "@gleam/messaging/src/page-protocol.ts";
import { WxtStoragePort } from "@/src/adapters/storage";
import { listenForKeyringConnections } from "@/src/adapters/session-key-store";
import { WxtWindowPort } from "@/src/adapters/windows";
import { restrictSessionStorageToTrustedContexts } from "@/src/adapters/session-access";
import { WalletLifecycleHandler } from "@/src/handlers/wallet-lifecycle";
import { PasskeyHandler } from "@/src/handlers/passkey";
import { ReadsHandler, registerActivityPromotionAlarm } from "@/src/handlers/reads";
import { ContactsHandler } from "@/src/handlers/contacts";
import { TransferHandler } from "@/src/handlers/transfer";
import { UploadHandler } from "@/src/handlers/upload";
import { ApprovalHandler } from "@/src/handlers/approval";
import { AnnouncementsHandler } from "@/src/handlers/announcements";
import { SiteWalletHandler } from "@/src/handlers/site-wallet";
import { SecurityPhraseHandler } from "@/src/handlers/security-phrase";
import { PointsHandler, registerPointsHeartbeatAlarm } from "@/src/handlers/points";
import { loadOrCreateDeviceKey } from "@/src/adapters/device-key";
import { actionBadge } from "@/src/adapters/badge";
import { browserDownloads, watchDownloadHistory } from "@/src/adapters/downloads";
import {
  clearKeyCache,
  enforceAutoLock,
  getSigner,
  getStoredWallet,
  getWalletMethod,
  reconcileKeyring,
  withSessionLock,
} from "@/src/handlers/key-session";
import {
  decodeProviderParams,
  encodeProviderResult,
  type ProviderDataItem,
  type ProviderTransaction,
} from "@/src/handlers/provider-params";
import {
  BACKGROUND_MESSAGES,
  PAGE_METHODS,
  parseParams,
  type BackgroundMessage,
  type ContentScriptMethodSpec,
  type ExtensionMethodSpec,
  type PageMethodSpec,
  type PageParams,
} from "@/src/dispatch/methods";
import { contentScriptOrigin, isExtensionPageSender, isSecureSigningOrigin } from "@/src/sender";
import { handleInstalledSitePages } from "@/src/site-pages";
import { acceptSiteInvite } from "@/src/points-invite";
import { estimateFee } from "@gleam/core/src/arweave/transfer.ts";

/**
 * The background service worker: builds the adapters and handlers and
 * registers every `ProtocolMap` method.
 *
 * Who may call what is `src/dispatch/methods.ts`: every method's tier,
 * whether it can open an approval window, and the schema its params are
 * parsed with. This file holds the handlers behind that table. Every
 * message is checked against Chrome's `sender`, never against anything
 * the message body claims.
 */
const messenger = defineExtensionMessaging<ProtocolMap>();
const extensionBaseUrl = browser.runtime.getURL("");

void restrictSessionStorageToTrustedContexts();

const storage = new WxtStoragePort();
const windows = new WxtWindowPort(storage);

const lifecycle = new WalletLifecycleHandler(storage, { downloads: browserDownloads });
const passkey = new PasskeyHandler(storage, lifecycle);
const reads = new ReadsHandler(storage);
// `approval` is declared below; hardware sends reach it only at call time.
const transfer: TransferHandler = new TransferHandler(storage, {
  requestTransfer: async (req): Promise<{ txId: string }> => {
    const metadata = req.token === null ? {} : await resolveTokenDenominationAndTicker(await walletAddress(req.walletId), req.token);
    return approval.requestWalletTransfer({ ...req, ...metadata });
  },
}, reads);
const upload = new UploadHandler(storage);
const contacts = new ContactsHandler(storage);
const approval: ApprovalHandler = new ApprovalHandler(
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

const points = new PointsHandler({
  storage,
  deviceKey: loadOrCreateDeviceKey,
  apiUrl: POINTS_API_URL,
  signer: getSigner,
  walletMethod: getWalletMethod,
  deviceProof: async ({ walletId, message }) => {
    const wallet = await getStoredWallet(walletId);
    if (!wallet) throw new Error(`Wallet "${walletId}" doesn't exist.`);
    const text = message(wallet.address);
    return { ...(await approval.requestPointsProof({ walletId, message: text })), message: text };
  },
  badge: actionBadge,
});
registerPointsHeartbeatAlarm(points);

const announcements = new AnnouncementsHandler({ storage });
const securityPhrase = new SecurityPhraseHandler(storage);
const siteWallet = new SiteWalletHandler({ storage, findActiveGrant: (origin) => approval.findActiveGrant(origin) });

// No runtime.onSuspend handler clears the key cache. onSuspend fires when
// the worker idles out (~30s), not only on browser shutdown, so clearing
// there locked every wallet behind the user's back. The keys live in the
// keyring offscreen document and the session entries in
// chrome.storage.session, both memory-only and both outliving the worker.

const AUTO_LOCK_ALARM_NAME = "auto-lock";
// Auto-lock is otherwise only checked when something reads the session;
// this tick drops the keys once the timeout passes even if nothing does.
// Created only when missing: re-creating it on every worker start would
// restart its period each time.
void browser.alarms.get(AUTO_LOCK_ALARM_NAME).then((existing) => {
  if (!existing) browser.alarms.create(AUTO_LOCK_ALARM_NAME, { periodInMinutes: 1 });
});
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_LOCK_ALARM_NAME) return;
  enforceAutoLock().catch((error: unknown) => console.error("Auto-lock failed.", error));
});

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
 * For when the user ends a site's access from Gleam: the dApp hears
 * `disconnect`, and when another wallet is installed the page's
 * `window.arweaveWallet` goes back to forwarding to it. A dApp's own
 * `disconnect()` only does the first part.
 */
async function announceAccessEnded(origin: string): Promise<void> {
  await siteWallet.setUseGleam(origin, false);
  await emitProviderEventToOrigin(origin, PROVIDER_EVENT.DISCONNECT, {});
  await pushSiteWalletMode(origin, false);
}

/**
 * For when the last wallet goes. Sites with a grant hear `disconnect` as
 * well; the rest were chosen in the popup and only switch back.
 */
async function announceGleamSitesForgotten(revoked: string[]): Promise<void> {
  const forgotten = await siteWallet.forgetGleamSites();
  for (const origin of revoked) void announceAccessEnded(origin);
  for (const origin of forgotten) {
    if (!revoked.includes(origin)) void pushSiteWalletMode(origin, false);
  }
}

async function pushSiteWalletMode(origin: string, useGleam: boolean): Promise<void> {
  const tabIds = await findTabsForOrigin(origin);
  await Promise.all(
    tabIds.map((tabId) => messenger.sendMessage("siteWalletMode", { useGleam }, tabId).catch(() => undefined)),
  );
}

async function activeTab(): Promise<{ id?: number; url?: string; favIconUrl?: string } | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

/** Reloads the active tab when it shows `origin`, so the dApp starts over with the wallet just chosen. */
async function reloadActiveTabFor(origin: string): Promise<void> {
  const tab = await activeTab();
  if (typeof tab?.id !== "number" || !tab.url) return;
  try {
    if (new URL(tab.url).origin !== origin) return;
  } catch {
    return;
  }
  await browser.tabs.reload(tab.id).catch(() => undefined);
}

function requireWebOrigin(origin: unknown): string {
  if (typeof origin === "string") {
    try {
      const url = new URL(origin);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.origin === origin) return origin;
    } catch {
      // Falls through to the error below.
    }
  }
  throw new Error("Expected a web origin such as https://example.com.");
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

async function walletAddress(walletId: string): Promise<string> {
  const wallet = (await lifecycle.getState()).wallets.find((candidate) => candidate.id === walletId);
  if (!wallet) throw new Error(`No stored wallet with id "${walletId}".`);
  return wallet.address;
}

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

/** What a provider handler gets once the dispatcher has checked the origin's grant. */
interface GrantedCall {
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

type ProviderHandlers = {
  [M in ProviderMethod]: (
    params: PageParams<M>,
    call: (typeof PAGE_METHODS)[M]["grant"] extends true ? GrantedCall : { origin: string },
  ) => Promise<unknown>;
};

/**
 * The work behind each `PAGE_METHODS` entry. Params arrive parsed, and
 * for every method but `connect`/`disconnect` the origin's active grant
 * and permissions have been checked, so no handler here exposes an
 * address to an origin without a grant.
 */
const PROVIDER_HANDLERS: ProviderHandlers = {
  async connect({ permissions: wanted, appInfo }, { origin }) {
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
    // A site that connected through `window.gleam` chose Gleam, so its
    // `window.arweaveWallet` stops forwarding to another installed wallet.
    await siteWallet.setUseGleam(origin, true);
    void pushSiteWalletMode(origin, true);

    return result;
  },

  async disconnect(_params, { origin }) {
    await approval.revokeGrant({ origin });
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
    if (!wallet) throw new Error("No active wallet to read balances for.");
    return { ar: await reads.getBalance({ address: wallet.address }) };
  },

  sign: ({ transaction }, call) => requestTransactionApproval("sign", transaction, call),
  dispatch: ({ transaction }, call) => requestTransactionApproval("dispatch", transaction, call),

  signDataItem: ({ dataItem }, call) => requestDataItemApproval("signDataItem", [dataItem], call),
  batchSignDataItem: ({ dataItems }, call) => requestDataItemApproval("batchSignDataItem", dataItems, call),

  async encrypt({ data, options }, { origin, activeWalletId }) {
    return approval.requestApproval({ kind: "encrypt", origin, walletId: activeWalletId(), payload: data, encryptAlgorithm: options });
  },
  async decrypt({ data, options }, { origin, activeWalletId }) {
    return approval.requestApproval({ kind: "decrypt", origin, walletId: activeWalletId(), payload: data, encryptAlgorithm: options });
  },

  async transferAoTokens({ token, recipient, amount }, { origin, wallet, activeWalletId }) {
    if (!wallet) throw new Error("No active wallet to sign with.");

    // Best-effort: the same denomination/ticker read the token list uses
    // for balances, so the approval amount can render scaled with its
    // ticker instead of as a raw atomic integer. A failed, unresolvable,
    // or hanging lookup (unconfigured peer, unreachable HyperBEAM node)
    // must never block or delay showing the approval — raced against
    // `TOKEN_METADATA_LOOKUP_TIMEOUT_MS` so a hung peer can't stall the
    // window open. `formatAmount`/`formatAmountUnit` fall back to the raw
    // amount and a "smallest units" label when either comes back `null`.
    const { tokenDenomination, tokenTicker } = await resolveTokenDenominationAndTicker(wallet.address, token);

    return approval.requestApproval({
      kind: "transferAoTokens",
      origin,
      walletId: activeWalletId(),
      recipient,
      amount,
      fee: null,
      token,
      tokenDenomination,
      tokenTicker,
      payload: new Uint8Array(),
      tags: [],
    });
  },

  async signature({ data, options }, { origin, activeWalletId }) {
    return approval.requestApproval({ kind: "signature", origin, walletId: activeWalletId(), payload: data, saltLength: options });
  },

  async signMessage({ data, options: hashAlgorithm }, { origin, wallet, activeWalletId }) {
    if (
      wallet &&
      isHardwareWalletMethod(wallet.method) &&
      (hashAlgorithm ?? HARDWARE_MESSAGE_HASH) !== HARDWARE_MESSAGE_HASH
    ) {
      throw new Error(`A hardware wallet signs messages with ${HARDWARE_MESSAGE_HASH} only, not ${hashAlgorithm}.`);
    }
    return approval.requestApproval({ kind: "signMessage", origin, walletId: activeWalletId(), payload: data, hashAlgorithm });
  },

  async verifyMessage({ data, signature, publicKey: givenKey, options: hashAlgorithm }, { wallet }) {
    // Verification uses only public material, so it needs no approval.
    const publicKey = givenKey ?? wallet?.publicKey;
    if (typeof publicKey !== "string" || publicKey.length === 0) {
      throw new Error("verifyMessage needs a publicKey when no wallet is active.");
    }
    return verifyMessage(publicKey, data.buffer, signature.buffer, hashAlgorithm);
  },

  async tokenBalance({ id }, { wallet }) {
    if (!wallet) throw new Error("No active wallet to read a token balance for.");
    return reads.tokenBalance({ address: wallet.address, id });
  },

  async userTokens({ options }, { wallet }) {
    if (!wallet) throw new Error("No active wallet to read tokens for.");
    return reads.userTokens({ address: wallet.address, options });
  },

  async isTokenAdded({ id: processId }, { wallet }) {
    if (!wallet) throw new Error("No active wallet to check tokens for.");
    return reads.isTokenAdded({ address: wallet.address, processId });
  },

  async addToken({ id: processId }, { origin, wallet }) {
    if (!wallet) throw new Error("No active wallet to add a token to.");
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
  },
};

async function requestTransactionApproval(
  kind: "sign" | "dispatch",
  transaction: ProviderTransaction,
  { origin, activeWalletId }: GrantedCall,
): Promise<unknown> {
  const { gatewayUrl } = await reads.getNetworkSettings();
  // The dApp's reward is the fee actually charged. Without one, the
  // preview shows a fresh quote, and the transaction fetches its own
  // reward when it is built after approval, so the two can differ. A
  // hardware wallet's device step shows the reward actually signed.
  const fee =
    transaction.reward ?? (await estimateFee(gatewayUrl, transaction.target, transaction.data.byteLength)).fee;
  return approval.requestApproval({
    kind,
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

async function requestDataItemApproval(
  kind: "signDataItem" | "batchSignDataItem",
  items: ProviderDataItem[],
  { origin, activeWalletId }: GrantedCall,
): Promise<unknown> {
  const [first] = items;
  return approval.requestApproval({
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
  });
}

/**
 * Routes one `window.arweaveWallet` call by its `PAGE_METHODS` entry. The
 * refusals that don't depend on the origin's grant throw synchronously,
 * so every site gets the same answer and no window opens.
 */
function dispatchProviderCall(origin: string, method: string, rawParams: unknown): Promise<unknown> {
  if (Object.hasOwn(REFUSED_PROVIDER_METHODS, method)) {
    throw new Error(REFUSED_PROVIDER_METHODS[method as keyof typeof REFUSED_PROVIDER_METHODS]);
  }
  if (!Object.hasOwn(PAGE_METHODS, method)) {
    throw new Error(`Provider method "${method}" is not reachable from a web page.`);
  }
  const providerMethod = method as ProviderMethod;
  // Checked on every call that can open a window, not only at connect, so
  // a plain-http origin still holding an older grant can't keep signing.
  if (PAGE_METHODS[providerMethod].approval && !isSecureSigningOrigin(origin)) {
    throw new Error("Gleam only signs for secure (https) sites.");
  }
  return runProviderMethod(origin, providerMethod, rawParams);
}

async function runProviderMethod(origin: string, method: ProviderMethod, rawParams: unknown): Promise<unknown> {
  const spec: PageMethodSpec = PAGE_METHODS[method];
  const handle = PROVIDER_HANDLERS[method] as (params: unknown, call: GrantedCall | { origin: string }) => Promise<unknown>;
  const decoded = decodeProviderParams(rawParams);
  if (!spec.grant) return handle(parseParams(spec.params, decoded), { origin });

  const grant = await approval.findActiveGrant(origin);
  if (!grant) {
    throw new Error(`"${origin}" is not connected. Call connect() first.`);
  }
  const missing = missingPermissions(method, grant.permissions);
  if (missing.length > 0) {
    throw new Error(`Missing permission(s) for "${method}": ${missing.join(", ")}`);
  }

  const state = await lifecycle.getState();
  const wallet = state.wallets.find((candidate) => candidate.id === state.activeWalletId) ?? null;
  // Refuse what the active wallet can't do before any approval window
  // opens, rather than after the user has approved it.
  const refusal = wallet ? providerMethodRefusal(wallet.method, method) : null;
  if (refusal) throw new Error(refusal);

  const params = parseParams(spec.params, decoded);
  return handle(params, {
    origin,
    grant,
    state,
    wallet,
    activeWalletId: () => {
      if (!wallet) throw new Error("No active wallet to sign with.");
      return wallet.id;
    },
  });
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

async function lockVault(): Promise<void> {
  await lifecycle.lockWallet();
  // A vault of only hardware wallets has no password and stays unlocked.
  if (vaultHasPassword((await lifecycle.getState()).wallets)) void setLockedIcon(true);
}

/**
 * Locks when the computer's screen locks, unless auto-lock is "never".
 * Only `"locked"` counts: the auto-lock timeout already runs from the last
 * use of the wallet, which is stricter than the OS's idle state.
 */
async function lockOnScreenLock(state: string): Promise<void> {
  if (state !== "locked") return;
  if ((await lifecycle.getLockSettings()).autoLockTimeout === "never") return;
  await lockVault();
}

// A new wallet becomes the active one. Connected dApps follow the active
// wallet, so they hear about it; with no earlier wallet there is nothing
// connected to tell.
async function addWallet(add: () => Promise<WalletSummary>): Promise<WalletSummary> {
  const before = await lifecycle.getState();
  const summary = await add();
  void points.markUnlockedForVault().catch(() => {});
  if (before.activeWalletId !== null) void broadcastWalletSwitch(summary.address);
  return summary;
}

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

/** A content script's call, from the tab Chrome says sent it. */
interface ContentScriptCaller {
  origin: string;
  tabId: number | undefined;
}

type MessageHandlers = {
  [K in BackgroundMessage]: (typeof BACKGROUND_MESSAGES)[K] extends ContentScriptMethodSpec<infer S>
    ? (data: z.output<S>, caller: ContentScriptCaller) => MaybePromise<GetReturnType<ProtocolMap[K]>>
    : (data: GetDataType<ProtocolMap[K]>) => MaybePromise<GetReturnType<ProtocolMap[K]>>;
};

/** The work behind each `BACKGROUND_MESSAGES` entry, run once its sender has been checked. */
const MESSAGE_HANDLERS: MessageHandlers = {
  // wallet lifecycle
  createWallet: (data) => addWallet(() => lifecycle.createWallet(data)),
  importWallet: (data) => addWallet(() => lifecycle.importWallet(data)),
  addHardwareWallet: (data) => addWallet(() => lifecycle.addHardwareWallet(data)),
  deleteWallet: async (data) => {
    const { walletId } = data;
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
    await lifecycle.deleteWallet(data);
    if (isLastWallet) await announceGleamSitesForgotten(revoked);

    const after = await lifecycle.getState();
    if (after.activeWalletId !== before.activeWalletId) {
      const active = after.wallets.find((candidate) => candidate.id === after.activeWalletId);
      if (active) void broadcastWalletSwitch(active.address);
    }
  },
  renameWallet: (data) => lifecycle.renameWallet(data),
  switchWallet: async (data) => {
    await lifecycle.switchWallet(data);
    // `switchWallet`'s locked signature returns `void`, so the resulting
    // active address is derived here from `getState()` after the call
    // resolves.
    const state = await lifecycle.getState();
    const active = state.wallets.find((candidate) => candidate.id === state.activeWalletId);
    if (active) {
      void broadcastWalletSwitch(active.address);
    }
  },
  downloadKeyfile: (data) => lifecycle.downloadKeyfile(data),
  cancelKeyfileDownload: (data) => lifecycle.cancelKeyfileDownload(data),
  lockWallet: () => lockVault(),
  unlockWallet: async (data) => {
    const result = await lifecycle.unlockWallet(data);
    void setLockedIcon(false);
    return result;
  },
  getPasskeyStatus: () => passkey.getPasskeyStatus(),
  checkVaultPassword: (data) => lifecycle.checkVaultPassword(data),
  enrollPasskey: (data) => passkey.enrollPasskey(data),
  unlockWithPasskey: async (data) => {
    const result = await passkey.unlockWithPasskey(data);
    void setLockedIcon(false);
    return result;
  },
  removePasskey: () => passkey.removePasskey(),
  resetAllWallets: async () => {
    // Grants go first, here and when deleteWallet removes the last wallet: a
    // removal that fails part-way must not leave a dApp connected to nothing.
    const revoked = await approval.revokeAllAccess();
    await passkey.removePasskey();
    await lifecycle.resetAllWallets();
    await announceGleamSitesForgotten(revoked);
  },

  // reads
  getState: () => lifecycle.getState(),
  getBalance: (data) => reads.getBalance(data),
  getArFee: () => transfer.getArFee(),
  getTokenBalances: (data) => reads.getTokenBalances(data),
  getCollectibles: (data) => reads.getCollectibles(data),
  getWatchedTokens: (data) => reads.getWatchedTokens(data),
  previewWatchedToken: (data) => reads.previewWatchedToken(data),
  addWatchedToken: (data) => reads.addWatchedToken(data),
  removeWatchedToken: (data) => reads.removeWatchedToken(data),
  getActivity: (data) => reads.getActivity(data),
  getPortfolioHistory: (data) => reads.getPortfolioHistory(data),
  getTokenPrices: () => reads.getTokenPrices(),
  getConnectedApps: () => approval.getConnectedApps(),
  listContacts: () => contacts.listContacts(),

  // actions
  estimateTransfer: (data) => transfer.estimateTransfer(requireWalletId(data)),
  assessRecipient: (data) => transfer.assessRecipient(data),
  submitTransfer: (data) => transfer.submitTransfer(requireWalletId(data)),
  estimateCollectibleSend: (data) => transfer.estimateCollectibleSend(requireWalletId(data)),
  sendCollectible: (data) => transfer.sendCollectible(requireWalletId(data)),
  reviewUpload: (data) => upload.reviewUpload(data),
  submitUpload: (data) => upload.submitUpload(requireWalletId(data)),

  // approvals
  getApproval: (data) => approval.getApproval(data),
  resolveApproval: (data) => approval.resolveApproval(data),
  submitDeviceSignature: (data) => approval.submitDeviceSignature(data),
  deviceActivity: (data) => approval.deviceActivity(data),

  // settings
  getNetworkSettings: () => reads.getNetworkSettings(),
  setNetworkSettings: (data) => storage.set("local:networkSettings", data),
  getLockSettings: () => lifecycle.getLockSettings(),
  setLockSettings: (data) => lifecycle.setLockSettings(data),
  getThemePreference: () => lifecycle.getThemePreference(),
  setThemePreference: (data) => lifecycle.setThemePreference(data),
  getSecurityPhrase: () => securityPhrase.get(),
  setSecurityPhrase: (data) => securityPhrase.set(data),
  revokeGrant: async (data) => {
    await approval.revokeGrant(data);
    void announceAccessEnded(data.origin);
  },
  getActiveSite: async () => siteWallet.activeSite(await activeTab()),
  useGleamOnSite: async (data) => {
    const origin = requireWebOrigin(data.origin);
    await approval.grantSite({ origin, permissions: data.permissions });
    await siteWallet.setUseGleam(origin, true);
    await pushSiteWalletMode(origin, true);
    await reloadActiveTabFor(origin);
  },
  stopGleamOnSite: async (data) => {
    const origin = requireWebOrigin(data.origin);
    await approval.revokeGrant({ origin });
    await announceAccessEnded(origin);
    await reloadActiveTabFor(origin);
  },
  dismissSiteSuggestion: (data) => siteWallet.dismiss(requireWebOrigin(data.origin)),
  saveContact: (data) => contacts.saveContact(data),
  deleteContact: (data) => contacts.deleteContact(data),

  // Gleam Points
  joinPoints: (data) => points.join(data),
  leavePoints: (data) => points.leave(data),
  getPointsMemberships: () => points.getMemberships(),
  getPointsScores: () => points.scores(),
  getPointsInviteUnlock: () => points.getInviteUnlock(),
  redeemPointsInvite: (data) => points.redeemInvite(data.code),
  getPointsPendingInvite: () => points.pendingInvite(),
  getPointsRevealSeen: () => points.getRevealSeen(),
  markPointsRevealSeen: (data) => points.markRevealSeen(data),
  getPointsClaimPending: () => points.getClaimPending(),
  setPointsClaimPending: (data) => points.setClaimPending(data),
  getPointsShareSeen: () => points.getShareSeen(),
  markPointsShareSeen: (data) => points.markShareSeen(data),
  getPointsSeatsSeen: () => points.getSeatsSeen(),
  markPointsSeatsSeen: (data) => points.markSeatsSeen(data),
  getAnnouncements: () => announcements.fetchAnnouncements(),
  getDismissedAnnouncements: () => announcements.getDismissed(),
  dismissAnnouncement: (data) => announcements.dismiss(data),

  // content script
  getSiteWalletMode: (_data, { origin }) => siteWallet.mode(origin),
  reportOtherWallet: (data, { origin, tabId }) => {
    if (typeof tabId !== "number") {
      throw new Error("reportOtherWallet is only accepted from a web page's content script.");
    }
    return siteWallet.report(tabId, origin, data);
  },
  // The only path a web page has into the wallet. Not `async`: the
  // grant-independent refusals throw before anything is awaited.
  providerCall: ({ method, params }, { origin }) =>
    dispatchProviderCall(origin, method, params).then(encodeProviderResult),
};

/**
 * Registers every `BACKGROUND_MESSAGES` method. A content script shares
 * the extension's messaging channel, so each call is checked against
 * Chrome's `sender` before its params are parsed or its handler runs:
 * without that, a compromised page's content script could export keys or
 * approve its own requests.
 */
function registerMessage(type: BackgroundMessage): void {
  const spec: ExtensionMethodSpec | ContentScriptMethodSpec = BACKGROUND_MESSAGES[type];
  const handle = MESSAGE_HANDLERS[type] as (data: unknown, caller?: ContentScriptCaller) => unknown;
  messenger.onMessage(type, (message) => {
    if (spec.tier === "extension") {
      if (!isExtensionPageSender(message.sender, extensionBaseUrl)) {
        throw new Error(`"${type}" can only be called from the Gleam extension.`);
      }
      return handle(message.data) as never;
    }
    const origin = contentScriptOrigin(message.sender, extensionBaseUrl);
    if (!origin) throw new Error(`${type} is only accepted from a web page's content script.`);
    return handle(parseParams(spec.params, message.data), { origin, tabId: message.sender.tab?.id }) as never;
  });
}

for (const type of Object.keys(BACKGROUND_MESSAGES) as BackgroundMessage[]) registerMessage(type);

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
  listenForKeyringConnections();
  // Runs synchronously after the module's listeners are registered, so it
  // takes the session lock before any event this wake-up delivers.
  reconcileKeyring().catch((error: unknown) => console.error("Couldn't reconcile the keyring.", error));

  // Installs that had a vault before the gate existed (and every wake-up
  // after) are marked unlocked, so a reset never locks them out.
  void lifecycle
    .getState()
    .then((state) => (state.wallets.length > 0 ? points.markUnlockedForVault() : undefined))
    .catch(() => {});

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
  // The site's welcome page hands over a Gleam Points invite code here.
  // Returning true keeps the reply channel open for the async storage write.
  browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    void acceptSiteInvite(message, sender.origin, storage, points).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  });

  browser.runtime.onStartup.addListener(() => {
    withSessionLock(clearKeyCache).catch((error: unknown) =>
      console.error("Couldn't clear session keys at startup.", error),
    );
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void siteWallet.forgetTab(tabId).catch(() => undefined);
  });

  watchDownloadHistory(browser.runtime.id);

  browser.idle.onStateChanged.addListener((state) => {
    lockOnScreenLock(state).catch((error: unknown) => console.error("Couldn't lock on screen lock.", error));
  });

  browser.runtime.onInstalled.addListener((details) => {
    void initializeNetworkSettingsIfMissing();
    if (details.reason === "update") {
      lifecycle.keepLockTimeoutOnUpdate().catch((error: unknown) => console.error("Couldn't keep the lock timeout.", error));
    }
    // Dev builds reload constantly; opening the site from them would
    // inflate the install and uninstall counts.
    if (import.meta.env.PROD) {
      handleInstalledSitePages(details.reason, {
        version: browser.runtime.getManifest().version,
        openTab: (url) => browser.tabs.create({ url }),
        setUninstallUrl: (url) => browser.runtime.setUninstallURL(url),
      }).catch(() => {
        // A failed tab or uninstall URL must never break install.
      });
    }
  });
});
