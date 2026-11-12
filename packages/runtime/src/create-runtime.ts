import type { z } from "zod";
import {
  DEFAULT_BUNDLER_URL,
  POINTS_API_URL,
  REFUSED_PROVIDER_METHODS,
  missingPermissions,
  isWatchWalletMethod,
  providerMethodRefusal,
  type NetworkSettings,
  type ProviderMethod,
  type WalletSummary,
  type Winston,
  vaultHasPassword,
  WATCH_ONLY_CONNECT_REFUSAL,
} from "@gleam/core";
import { resolveInitialGatewayUrl } from "@gleam/core/src/arweave/first-run-gateway.ts";
import { estimateFee } from "@gleam/core/src/arweave/transfer.ts";
import { isSecureSigningOrigin } from "@gleam/core/src/policy/index.ts";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import {
  PROVIDER_EVENT,
  type ConnectEventPayload,
  type DisconnectEventPayload,
  type ProviderEventName,
  type WalletSwitchEventPayload,
} from "@gleam/messaging/src/page-protocol.ts";
import { WalletLifecycleHandler } from "./handlers/wallet-lifecycle";
import { PasskeyHandler } from "./handlers/passkey";
import { ReadsHandler, registerActivityPromotionAlarm } from "./handlers/reads";
import { BrowserSitesHandler } from "./handlers/browser-sites";
import { ContactsHandler } from "./handlers/contacts";
import { TransferHandler } from "./handlers/transfer";
import { ApprovalHandler } from "./handlers/approval";
import { AnnouncementsHandler } from "./handlers/announcements";
import { ReviewPromptHandler } from "./handlers/review-prompt";
import { ScansHandler } from "./handlers/scans";
import { SiteWalletHandler } from "./handlers/site-wallet";
import { SecurityPhraseHandler } from "./handlers/security-phrase";
import { updateStored } from "./storage-update";
import { PointsHandler, registerPointsHeartbeatAlarm } from "./handlers/points";
import { createKeySession } from "./handlers/key-session";
import { decodeProviderParams, encodeProviderResult } from "./handlers/provider-params";
import {
  BACKGROUND_MESSAGES,
  PAGE_METHODS,
  parseParams,
  type BackgroundMessage,
  type ContentScriptMethodSpec,
  type ExtensionMethodSpec,
  type PageMethodSpec,
} from "./dispatch/methods";
import { dispatchSiteMessage } from "./dispatch/site";
import { redeemSiteInvite } from "./points-invite";
import { registerPeerDiscoveryAlarm, saveNetworkSettings } from "./peers";
import { signSiteAttestation, siteAttestStatus } from "./points-attest";
import type { Platform } from "./platform";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { NETWORK_SETTINGS_KEY } from "./storage-keys";
import { dappError } from "./dapp-error";
import { createProviderHandlers, type ApprovalCall, type GrantedCall } from "./handlers/provider";

/**
 * What a shell's transport and lifecycle events reach the wallet through.
 * `dispatch` and `dispatchSite` answer messages; the rest are the shell's
 * events, which it connects to whatever its platform fires.
 */
export interface Runtime {
  /**
   * Runs `type`'s handler if `caller` holds its `BACKGROUND_MESSAGES` tier.
   * Throws (or rejects) with the error the caller is answered with.
   */
  dispatch(type: BackgroundMessage, data: unknown, caller: CallerContext | null): unknown;
  /** Answers a `SITE_MESSAGES` message. Never rejects: every refusal is a reply. */
  dispatchSite(message: unknown, caller: CallerContext | null): Promise<unknown>;
  /** Once per start, after the shell's message listeners are registered. */
  start(): void;
  /** The browser (or app) itself started, not just this background context. */
  onBrowserStartup(): void;
  onTabClosed(tabId: number): void;
  /** The OS idle state, as `"active"`, `"idle"` or `"locked"`. */
  onIdleStateChanged(state: string): void;
  /** The wallet was installed or updated, with the platform's reason, e.g. `"install"` or `"update"`. */
  onInstalled(reason: string): void;
}

type ProtocolData<K extends keyof ProtocolMap> = Parameters<ProtocolMap[K]>[0];
type ProtocolResult<K extends keyof ProtocolMap> = ReturnType<ProtocolMap[K]> | Promise<ReturnType<ProtocolMap[K]>>;

const AUTO_LOCK_ALARM_NAME = "auto-lock";

function requireWebOrigin(origin: unknown): string {
  if (typeof origin === "string") {
    try {
      const url = new URL(origin);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.origin === origin) return origin;
    } catch {
      // Falls through to the error below.
    }
  }
  throw new Error(dappError("Expected a web origin such as https://example.com."));
}

/**
 * A hung HyperBEAM peer (or gateway metadata lookup) must not delay opening
 * a `transferAoTokens` approval — the user is waiting on a signing prompt,
 * not a balance read. Races `ReadsHandler.previewWatchedToken` against this
 * timeout, resolving to "unresolved" either way rather than ever rejecting.
 */
const TOKEN_METADATA_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Longer than the metadata budget: an L1 send with no quote is refused, and a
 * cold token lookup can spend `core/ao/token-state.ts`'s 8s reading a logo.
 */
const TOKEN_FEE_QUOTE_TIMEOUT_MS = 10_000;

const INSECURE_ORIGIN_ERROR = "Gleam only works with secure (https) sites.";

/**
 * `TransferDraft` types `walletId` as optional. Every real
 * caller (`SendView`) always supplies it, but the wire type
 * itself can't promise that — this guard turns a missing field into a
 * named rejection rather than `undefined` silently reaching the
 * key-session lookup as a wallet id. The request carries no signing
 * material — see `key-session.ts`.
 */
function requireWalletId<T extends { walletId?: string }>(draft: T): T & { walletId: string } {
  if (!draft.walletId) {
    throw new Error(dappError("This action requires a wallet id."));
  }
  return draft as T & { walletId: string };
}

type ContentScriptCaller = Extract<CallerContext, { tier: "contentScript" }>;

type MessageHandlers = {
  [K in BackgroundMessage]: (typeof BACKGROUND_MESSAGES)[K] extends ContentScriptMethodSpec<infer S>
    ? (data: z.output<S>, caller: ContentScriptCaller) => ProtocolResult<K>
    : (data: ProtocolData<K>) => ProtocolResult<K>;
};


/**
 * Builds every handler over `platform` and returns the dispatcher in front
 * of them. Call it once per background start, synchronously at the top
 * level: it registers the platform's timer and approval listeners as it
 * runs, and it creates the one key session, whose lock every handler that
 * touches unlocked keys shares.
 *
 * Who may call what is `src/dispatch/methods.ts`: every method's tier,
 * whether it can open an approval window, and the schema its params are
 * parsed with. This holds the handlers behind that table. Every message
 * is checked against the `CallerContext` the shell's transport built,
 * never against anything the message body claims.
 */
export function createRuntime(platform: Platform): Runtime {
  const { storage, tabs } = platform;
  // The one session lock: every handler that touches unlocked keys gets this instance.
  const keySession = createKeySession({ sessionKeys: platform.sessionKeys, storage });
  const { clearKeyCache, enforceAutoLock, getSigner, getStoredWallet, getWalletMethod, reconcileKeyring, withSessionLock } =
    keySession;

  const lifecycle = new WalletLifecycleHandler(storage, keySession, { downloads: platform.downloads });
  const passkey = new PasskeyHandler(storage, lifecycle);
  const reads = new ReadsHandler(storage);
  // `approval` is declared below; hardware sends reach it only at call time.
  const transfer: TransferHandler = new TransferHandler(storage, keySession, {
    requestTransfer: async (req): Promise<{ txId: string }> => {
      const metadata = req.token === null ? {} : await resolveTokenDenominationAndTicker(await walletAddress(req.walletId), req.token);
      return approval.requestWalletTransfer({ ...req, ...metadata });
    },
  }, reads, reads);
  const contacts = new ContactsHandler(storage);
  const browserSites = new BrowserSitesHandler(storage);
  const approval: ApprovalHandler = new ApprovalHandler(
    storage,
    keySession,
    platform.approvalPresenter,
    transfer,
    DEFAULT_BUNDLER_URL,
    async () => (await lifecycle.getState()).activeWalletId,
    reads,
    // `points` is declared below; attestations reach it only at call time.
    {
      attest: (req) => points.attest(req),
      submitAttestation: (attestation, proof) => points.submitAttestation(attestation, proof),
      check: (attestation, address) => points.checkAttestation(attestation, address),
    },
  );

  // Advances locally-pending activity entries to confirmed on a background
  // interval, independent of any popup being open — see reads.ts's own
  // doc comment on registerActivityPromotionAlarm.
  registerActivityPromotionAlarm(reads, platform.timer);
  registerPeerDiscoveryAlarm(storage, platform.timer, async () => (await reads.getNetworkSettings()).gatewayUrl);

  const points = new PointsHandler({
    storage,
    deviceKey: platform.deviceKey,
    apiUrl: POINTS_API_URL,
    signer: getSigner,
    walletMethod: getWalletMethod,
    deviceProof: async ({ walletId, message }) => {
      const wallet = await getStoredWallet(walletId);
      if (!wallet) throw new Error(userErrorMessage("walletNotFound", { wallet: walletId }));
      const text = message(wallet.address);
      return { ...(await approval.requestPointsProof({ walletId, message: text })), message: text };
    },
    badge: platform.badge,
  });
  registerPointsHeartbeatAlarm(points, platform.timer);

  const announcements = new AnnouncementsHandler({ storage, target: () => ({ shell: platform.shell, version: platform.version() }) });
  const reviewPrompt = new ReviewPromptHandler({ storage });
  const scans = new ScansHandler({ apiUrl: POINTS_API_URL, version: () => platform.version() });
  const securityPhrase = new SecurityPhraseHandler(storage);
  const siteWallet = new SiteWalletHandler({ storage, findActiveGrant: (origin) => approval.findActiveGrant(origin) });

  // Auto-lock is otherwise only checked when something reads the session;
  // this tick drops the keys once the timeout passes even if nothing does.
  platform.timer.every(AUTO_LOCK_ALARM_NAME, 1, () => {
    enforceAutoLock().catch((error: unknown) => console.error("Auto-lock failed.", error));
  });

  /**
   * Finds every open tab whose URL origin matches `origin` exactly, since
   * nothing about `providerEvent`'s wire shape itself carries an origin
   * check. A tab query can't express "exact origin, any path" directly, so
   * this filters every web tab down to an exact
   * `new URL(tab.url).origin === origin` match by hand.
   */
  async function findTabsForOrigin(origin: string): Promise<number[]> {
    const ids: number[] = [];
    for (const tab of await tabs.webTabs()) {
      if (typeof tab.id !== "number" || !tab.url) continue;
      try {
        if (new URL(tab.url).origin === origin) ids.push(tab.id);
      } catch {
        // Not a parseable URL — never a candidate.
      }
    }
    return ids;
  }

  /** The favicon of an open tab on `origin`, to keep on its grant. */
  async function favIconFor(origin: string): Promise<string | null> {
    try {
      for (const tab of await tabs.webTabs()) {
        if (!tab.url || !tab.favIconUrl) continue;
        try {
          if (new URL(tab.url).origin === origin) return tab.favIconUrl;
        } catch {
          // Not a parseable URL — never a candidate.
        }
      }
    } catch {
      // A missing icon only means the letter fallback.
    }
    return null;
  }

  /**
   * Sends a `providerEvent` push to every tab currently showing `origin` —
   * never a broadcast to every open tab. The push names `origin`, and the
   * receiving page drops it if it has navigated elsewhere since the tab
   * query. Each send targets one `tabId`; a
   * tab with no content script listening (e.g. mid-navigation) simply
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
        tabs.send(tabId, "providerEvent", { origin, event, data }).catch(() => undefined),
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
      tabIds.map((tabId) => tabs.send(tabId, "siteWalletMode", { origin, useGleam }).catch(() => undefined)),
    );
  }

  /** Reloads the active tab when it shows `origin`, so the dApp starts over with the wallet just chosen. */
  async function reloadActiveTabFor(origin: string): Promise<void> {
    const tab = await tabs.activeTab();
    if (typeof tab?.id !== "number" || !tab.url) return;
    try {
      if (new URL(tab.url).origin !== origin) return;
    } catch {
      return;
    }
    await tabs.reload(tab.id).catch(() => undefined);
  }

  /**
   * The active address `origin` could read through `getActiveAddress`, or
   * `null`. Pushed events carry an address only through this, so a page
   * never hears one the pull path would refuse it.
   */
  async function readableActiveAddress(origin: string): Promise<string | null> {
    if (!isSecureSigningOrigin(origin)) return null;
    const grant = await approval.findActiveGrant(origin);
    if (!grant || missingPermissions("getActiveAddress", grant.permissions).length > 0) return null;
    const state = await lifecycle.getState();
    const wallet = state.wallets.find((candidate) => candidate.id === state.activeWalletId);
    if (!wallet || isWatchWalletMethod(wallet.method)) return null;
    return wallet.address;
  }

  /**
   * `walletSwitch` for an active-account change. A switch affects the whole
   * extension, so every origin with a grant is considered, never every
   * open tab, and each hears only the address it could read.
   */
  async function broadcastWalletSwitch(): Promise<void> {
    const grants = await approval.getConnectedApps();
    const origins = [...new Set(grants.map((grant) => grant.origin))];
    await Promise.all(
      origins.map(async (origin) => {
        const address = await readableActiveAddress(origin);
        if (address) await emitProviderEventToOrigin(origin, PROVIDER_EVENT.WALLET_SWITCH, { address });
      }),
    );
  }

  async function walletAddress(walletId: string): Promise<string> {
    const wallet = (await lifecycle.getState()).wallets.find((candidate) => candidate.id === walletId);
    if (!wallet) throw new Error(userErrorMessage("noStoredWallet", { wallet: walletId }));
    return wallet.address;
  }

  async function resolveTokenDenominationAndTicker(
    address: string,
    processId: string,
  ): Promise<{ tokenDenomination: number | null; tokenTicker: string | null }> {
    const { tokenDenomination, tokenTicker } = await resolveTokenPreview(address, processId);
    return { tokenDenomination, tokenTicker };
  }

  /** As `resolveTokenDenominationAndTicker`, and whether the process is a collectible rather than a token. */
  async function resolveTokenPreview(
    address: string,
    processId: string,
  ): Promise<{ tokenDenomination: number | null; tokenTicker: string | null; collectible: boolean }> {
    const UNRESOLVED = { tokenDenomination: null, tokenTicker: null, collectible: false };
    const lookup = reads
      .previewWatchedToken({ address, processId })
      .then((balance) =>
        balance.available === false
          ? UNRESOLVED
          : { tokenDenomination: balance.denomination, tokenTicker: balance.ticker, collectible: false },
      )
      .catch((error: unknown) =>
        error instanceof Error && error.message === userErrorMessage("tokenIsCollectible")
          ? { ...UNRESOLVED, collectible: true }
          : UNRESOLVED,
      );
    const timeout = new Promise<typeof UNRESOLVED>((resolve) =>
      setTimeout(() => resolve(UNRESOLVED), TOKEN_METADATA_LOOKUP_TIMEOUT_MS),
    );
    return Promise.race([lookup, timeout]);
  }

  /**
   * The AR reward a dApp's token transfer pays, for the preview: `null` for
   * a token on the MU, which has none. A lookup that fails or hangs also
   * gives `null`, and an L1 send then refuses for want of an approved fee.
   */
  async function quoteTokenTransferFee(processId: string): Promise<Winston | null> {
    const lookup = (async () => {
      if ((await reads.tokenTransport({ processId })) !== "l1") return null;
      const { gatewayUrl } = await reads.getNetworkSettings();
      return (await estimateFee(gatewayUrl, processId)).fee;
    })().catch(() => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_FEE_QUOTE_TIMEOUT_MS));
    return Promise.race([lookup, timeout]);
  }

  const PROVIDER_HANDLERS = createProviderHandlers({
    lifecycle,
    reads,
    siteWallet,
    // Two functions only: see `ProviderDeps`.
    grants: {
      findActiveGrant: (origin) => approval.findActiveGrant(origin),
      revokeGrant: (req) => approval.revokeGrant(req),
    },
    favIconFor,
    readableActiveAddress,
    emitProviderEventToOrigin,
    pushSiteWalletMode,
    resolveTokenPreview,
    quoteTokenTransferFee,
  });

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
      throw new Error(dappError(`Provider method "${method}" is not reachable from a web page.`));
    }
    const providerMethod = method as ProviderMethod;
    // Checked on every call, not only at connect, so a plain-http origin
    // still holding an older grant can neither sign nor read addresses.
    // `disconnect` only drops the grant, so such a site may still clear it.
    if (providerMethod !== "disconnect" && !isSecureSigningOrigin(origin)) {
      throw new Error(INSECURE_ORIGIN_ERROR);
    }
    return runProviderMethod(origin, providerMethod, rawParams);
  }

  async function runProviderMethod(origin: string, method: ProviderMethod, rawParams: unknown): Promise<unknown> {
    const spec: PageMethodSpec = PAGE_METHODS[method];
    const handle = PROVIDER_HANDLERS[method] as (
      params: unknown,
      call: (GrantedCall | { origin: string }) & Partial<ApprovalCall>,
    ) => Promise<unknown>;
    const approvals: Partial<ApprovalCall> = spec.approval
      ? { requestApproval: (request) => approval.requestApproval(request) }
      : {};
    if (!spec.grant) return handle(parseParams(spec.params, decodeProviderParams(rawParams)), { origin, ...approvals });

    const grant = await approval.findActiveGrant(origin);
    if (!grant) {
      throw new Error(dappError(`"${origin}" is not connected. Call connect() first.`));
    }
    const missing = missingPermissions(method, grant.permissions);
    if (missing.length > 0) {
      throw new Error(dappError(`Missing permission(s) for "${method}": ${missing.join(", ")}`));
    }

    const state = await lifecycle.getState();
    const wallet = state.wallets.find((candidate) => candidate.id === state.activeWalletId) ?? null;
    // Grants follow the active wallet, so a site connected earlier must not
    // reach a watch wallet's address or sign requests through its grant.
    if (wallet && isWatchWalletMethod(wallet.method)) throw new Error(WATCH_ONLY_CONNECT_REFUSAL);
    // Refuse what the active wallet can't do before any approval window
    // opens, rather than after the user has approved it.
    const refusal = wallet ? providerMethodRefusal(wallet.method, method) : null;
    if (refusal) throw new Error(refusal);

    // Decoded only now: a page without a grant could otherwise keep the
    // worker busy decoding a large payload it is about to be refused.
    const params = parseParams(spec.params, decodeProviderParams(rawParams));
    return handle(params, {
      ...approvals,
      origin,
      grant,
      state,
      wallet,
      activeWalletId: () => {
        if (!wallet) throw new Error(userErrorMessage("noActiveWalletSign"));
        return wallet.id;
      },
    });
  }

  async function lockVault(): Promise<void> {
    await lifecycle.lockWallet();
    // A vault of only hardware wallets has no password and stays unlocked.
    if (vaultHasPassword((await lifecycle.getState()).wallets)) void platform.lockIndicator.setLocked(true);
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
    if (before.activeWalletId !== null) await activeWalletChanged(summary.id);
    return summary;
  }

  // A site's pending signing request stays bound to the wallet it was made
  // for, so it can't outlive that wallet being active.
  async function activeWalletChanged(walletId: string): Promise<void> {
    try {
      await approval.rejectSwitchedApprovals(walletId);
    } finally {
      void broadcastWalletSwitch();
    }
  }

  /** The work behind each `BACKGROUND_MESSAGES` entry, run once its sender has been checked. */
  const MESSAGE_HANDLERS: MessageHandlers = {
    // wallet lifecycle
    createWallet: (data) => addWallet(() => lifecycle.createWallet(data)),
    importWallet: (data) => addWallet(() => lifecycle.importWallet(data)),
    addHardwareWallet: (data) => addWallet(() => lifecycle.addHardwareWallet(data)),
    addWatchWallet: (data) => addWallet(() => lifecycle.addWatchWallet(data)),
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
      if (after.activeWalletId !== null && after.activeWalletId !== before.activeWalletId) {
        await activeWalletChanged(after.activeWalletId);
      }
    },
    renameWallet: (data) => lifecycle.renameWallet(data),
    switchWallet: async (data) => {
      await lifecycle.switchWallet(data);
      await activeWalletChanged(data.walletId);
    },
    downloadKeyfile: (data) => lifecycle.downloadKeyfile(data),
    cancelKeyfileDownload: (data) => lifecycle.cancelKeyfileDownload(data),
    lockWallet: () => lockVault(),
    unlockWallet: async (data) => {
      const result = await lifecycle.unlockWallet(data);
      void platform.lockIndicator.setLocked(false);
      return result;
    },
    getPasskeyStatus: () => passkey.getPasskeyStatus(),
    checkVaultPassword: (data) => lifecycle.checkVaultPassword(data),
    probeVaultPassword: (data) => lifecycle.probeVaultPassword(data),
    enrollPasskey: (data) => passkey.enrollPasskey(data),
    unlockWithPasskey: async (data) => {
      const result = await passkey.unlockWithPasskey(data);
      void platform.lockIndicator.setLocked(false);
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
    // Extension-tier only, so this is the user looking at a Gleam page.
    getState: (data) => lifecycle.getState({ recordActivity: data?.recordActivity !== false }),
    getBalance: (data) => reads.getBalance(data),
    getArFee: () => transfer.getArFee(),
    getTokenBalances: (data) => reads.getTokenBalances(data),
    getPendingTransfers: (data) => reads.getPendingTransfers(data),
    getCollectibles: (data) => reads.getCollectibles(data),
    getWatchedTokens: (data) => reads.getWatchedTokens(data),
    previewWatchedToken: (data) => reads.previewWatchedToken(data),
    addWatchedToken: (data) => reads.addWatchedToken(data),
    removeWatchedToken: (data) => reads.removeWatchedToken(data),
    getActivity: (data) => reads.getActivity(data),
    getPortfolioHistory: (data) => reads.getPortfolioHistory(data),
    getTokenPrices: (data) => reads.getTokenPrices(data),
    getConnectedApps: () => approval.getConnectedApps(),
    listContacts: () => contacts.listContacts(),
    listBrowserSites: () => browserSites.listBrowserSites(),

    // actions
    estimateTransfer: (data) => transfer.estimateTransfer(requireWalletId(data)),
    assessRecipient: (data) => transfer.assessRecipient(data),
    submitTransfer: (data) => transfer.submitTransfer(requireWalletId(data)),
    estimateCollectibleSend: (data) => transfer.estimateCollectibleSend(requireWalletId(data)),
    sendCollectible: (data) => transfer.sendCollectible(requireWalletId(data)),

    // approvals
    getApproval: (data) => approval.getApproval(data),
    // The approval window's load doesn't count as activity, since a site
    // opens it; the user's answer in it does.
    resolveApproval: async (data) => {
      await lifecycle.getState({ recordActivity: true });
      return approval.resolveApproval(data);
    },
    submitDeviceSignature: async (data) => {
      await lifecycle.getState({ recordActivity: true });
      return approval.submitDeviceSignature(data);
    },
    checkScanAttestation: (data) => approval.checkScanAttestation(data),
    deviceActivity: (data) => approval.deviceActivity(data),

    // settings
    getNetworkSettings: () => reads.getNetworkSettings(),
    setNetworkSettings: (data) => saveNetworkSettings(storage, data),
    getLockSettings: () => lifecycle.getLockSettings(),
    setLockSettings: (data) => lifecycle.setLockSettings(data),
    getThemePreference: () => lifecycle.getThemePreference(),
    setThemePreference: (data) => lifecycle.setThemePreference(data),
    getDisplaySettings: () => lifecycle.getDisplaySettings(),
    setDisplaySettings: (data) => lifecycle.setDisplaySettings(data),
    getSecurityPhrase: () => securityPhrase.get(),
    setSecurityPhrase: (data) => securityPhrase.set(data),
    revokeGrant: async (data) => {
      await approval.revokeGrant(data);
      void announceAccessEnded(data.origin);
    },
    getActiveSite: async () => siteWallet.activeSite(await tabs.activeTab()),
    useGleamOnSite: async (data) => {
      const origin = requireWebOrigin(data.origin);
      await approval.grantSite({ origin, permissions: data.permissions, favIconUrl: await favIconFor(origin) });
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
    saveBrowserSite: (data) => browserSites.saveBrowserSite(data),
    removeBrowserSite: (data) => browserSites.removeBrowserSite(data),
    recordRecentSite: (data) => browserSites.recordRecentSite(data),
    clearRecentSites: () => browserSites.clearRecentSites(),

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
    getScanStats: () => scans.stats(),
    getDismissedAnnouncements: () => announcements.getDismissed(),
    dismissAnnouncement: (data) => announcements.dismiss(data),
    getReviewPrompt: (data) => reviewPrompt.get(data),
    finishReviewPrompt: () => reviewPrompt.finish(),

    // content script
    getSiteWalletMode: (_data, { origin }) => siteWallet.mode(origin),
    reportOtherWallet: (data, { origin, tabId }) => {
      if (typeof tabId !== "number") {
        throw new Error(dappError("reportOtherWallet is only accepted from a web page's content script."));
      }
      return siteWallet.report(tabId, origin, data);
    },
    // The only path a web page has into the wallet. Not `async`: the
    // grant-independent refusals throw before anything is awaited.
    providerCall: ({ method, params }, { origin }) =>
      dispatchProviderCall(origin, method, params).then(encodeProviderResult),
  };

  /**
   * Runs `type`'s handler if `caller` holds its `BACKGROUND_MESSAGES` tier,
   * checked before its params are parsed or its handler runs. A content
   * script shares the extension's messaging channel, so without this a
   * compromised page's content script could export keys or approve its own
   * requests. A null `caller` matches no tier.
   */
  function dispatch(type: BackgroundMessage, data: unknown, caller: CallerContext | null): unknown {
    const spec: ExtensionMethodSpec | ContentScriptMethodSpec = BACKGROUND_MESSAGES[type];
    const handle = MESSAGE_HANDLERS[type] as (data: unknown, caller?: ContentScriptCaller) => unknown;
    if (spec.tier === "extension") {
      if (caller?.tier !== "extension") {
        throw new Error(dappError(`"${type}" can only be called from the Gleam extension.`));
      }
      return handle(data);
    }
    if (caller?.tier !== "contentScript") throw new Error(dappError(`${type} is only accepted from a web page's content script.`));
    return handle(parseParams(spec.params, data), caller);
  }

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
      // The probe takes a while; settings the user saved meanwhile win.
      await updateStored(storage, NETWORK_SETTINGS_KEY, (current) =>
        current === null ? { ...settings, gatewayUrl } : undefined,
      );
    } catch {
      // Never block startup over a first-run gateway probe.
    }
  }

  async function activeWallet() {
    const state = await lifecycle.getState();
    return state.wallets.find((wallet) => wallet.id === state.activeWalletId) ?? null;
  }

  function dispatchSite(message: unknown, caller: CallerContext | null): Promise<unknown> {
    return dispatchSiteMessage(message, caller, {
      "gleam-points:invite": (invite) => redeemSiteInvite(invite, storage, points).catch(() => ({ ok: false })),
      "gleam-points:attest": (request) =>
        signSiteAttestation(request, {
          activeWallet,
          requestScanAttestation: (req) => approval.requestScanAttestation(req),
        }).catch((error: unknown): SiteAttestResponse => {
          console.error("Couldn't handle a scan attestation from the site.", error);
          return { ok: false, code: "signing_failed", error: "Gleam couldn't open the attestation. Open the link again." };
        }),
      "gleam-points:attest-status": () =>
        siteAttestStatus({
          activeWallet,
          isMember: async (walletId) => (await points.getMemberships())[walletId] !== undefined,
          // The check only labels the page's button; Sign still runs the real one and says what failed.
        }).catch(() => ({ ok: true })),
    }, platform.dev);
  }

  return {
    dispatch,
    dispatchSite,
    start() {
      // Takes the session lock before any event this start delivers.
      reconcileKeyring().catch((error: unknown) => console.error("Couldn't reconcile the keyring.", error));

      // Installs that had a vault before the gate existed (and every start
      // after) are marked unlocked, so a reset never locks them out.
      void lifecycle
        .getState()
        .then((state) => (state.wallets.length > 0 ? points.markUnlockedForVault() : undefined))
        .catch(() => {});
    },
    onBrowserStartup() {
      withSessionLock(clearKeyCache).catch((error: unknown) =>
        console.error("Couldn't clear session keys at startup.", error),
      );
    },
    onTabClosed(tabId) {
      void siteWallet.forgetTab(tabId).catch(() => undefined);
    },
    onIdleStateChanged(state) {
      lockOnScreenLock(state).catch((error: unknown) => console.error("Couldn't lock on screen lock.", error));
    },
    onInstalled(reason) {
      // Only an install finds `local:networkSettings` empty; after that a
      // written NetworkSettings (default or user-edited) short-circuits it.
      void initializeNetworkSettingsIfMissing();
      if (reason === "update") {
        lifecycle.keepLockTimeoutOnUpdate().catch((error: unknown) => console.error("Couldn't keep the lock timeout.", error));
      }
    },
  };
}
