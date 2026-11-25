import type { z } from "zod";
import { DEFAULT_BUNDLER_URL, POINTS_API_URL, type WalletSummary } from "@gleam/core";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { WalletLifecycleHandler } from "./handlers/wallet-lifecycle";
import { PasskeyHandler } from "./handlers/passkey";
import { BackupHandler } from "./handlers/backup";
import { registerBackupSync } from "./backup-sync";
import { ReadsHandler } from "./handlers/reads";
import { registerActivityPromotionAlarm } from "./handlers/activity-reads";
import { BrowserSitesHandler } from "./handlers/browser-sites";
import { ContactsHandler } from "./handlers/contacts";
import { TransferHandler } from "./handlers/transfer";
import { ApprovalHandler } from "./handlers/approval";
import { AnnouncementsHandler } from "./handlers/announcements";
import { ReviewPromptHandler } from "./handlers/review-prompt";
import { ScansHandler } from "./handlers/scans";
import { SiteWalletHandler } from "./handlers/site-wallet";
import { SecurityPhraseHandler } from "./handlers/security-phrase";
import { PointsHandler, registerPointsHeartbeatAlarm } from "./handlers/points";
import { createKeySession } from "./handlers/key-session";
import {
  BACKGROUND_MESSAGES,
  parseParams,
  type BackgroundMessage,
  type ContentScriptMethodSpec,
  type ExtensionMethodSpec,
} from "./dispatch/methods";
import { registerPeerDiscoveryAlarm, saveNetworkSettings } from "./peers";
import type { Platform } from "./platform";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { requireWallet } from "./stored-data";
import { createProviderHandlers } from "./handlers/provider";
import { encodeProviderResult } from "./handlers/provider-params";
import { initializeNetworkSettingsIfMissing } from "./first-run-network";
import { dappError } from "./dapp-error";
import { requireWalletId, requireWebOrigin } from "./request-guards";
import { createProviderDispatch } from "./provider-dispatch";
import { createSiteDispatch } from "./site-dispatch";
import { createSiteEvents } from "./site-events";
import { createTokenPreview } from "./token-preview";
import { createVaultLock, registerAutoLockAlarm } from "./vault-lock";

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
  const backup = new BackupHandler({
    storage,
    sessionKeys: platform.sessionKeys,
    cloudFile: platform.cloudFile,
    vault: lifecycle,
    session: keySession,
  });
  if (platform.cloudFile) registerBackupSync(storage, platform.timer, backup);
  // An unlock brings the backup key back: it writes a change made while locked and pulls other devices' additions.
  const syncBackup = () => {
    backup.sync({ pull: true }).catch((error: unknown) => console.error("Vault backup failed.", error));
  };
  const reads = new ReadsHandler(storage);
  // `approval` is declared below; hardware sends reach it only at call time.
  const transfer: TransferHandler = new TransferHandler(storage, keySession, {
    requestTransfer: async (req): Promise<{ txId: string }> => {
      const metadata = req.token === null ? {} : await resolveTokenDenominationAndTicker(await walletAddress(req.walletId), req.token);
      return approval.requestWalletTransfer({ ...req, ...metadata });
    },
    requestNameTarget: (req) => approval.requestNameTarget(req),
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

  registerAutoLockAlarm(platform.timer, enforceAutoLock);

  const {
    favIconFor,
    emitProviderEventToOrigin,
    pushSiteWalletMode,
    announceAccessEnded,
    announceGleamSitesForgotten,
    reloadActiveTabFor,
    readableActiveAddress,
    broadcastWalletSwitch,
  } = createSiteEvents({ tabs, siteWallet, approval, activeWallet });
  const { resolveTokenDenominationAndTicker, resolveTokenPreview, quoteTokenTransferFee } = createTokenPreview(reads);

  async function walletAddress(walletId: string): Promise<string> {
    return requireWallet((await lifecycle.getState()).wallets, walletId).address;
  }

  const providerHandlers = createProviderHandlers({
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

  const dispatchProviderCall = createProviderDispatch({ lifecycle, approval, handlers: providerHandlers });

  const { lockVault, lockOnScreenLock } = createVaultLock(lifecycle, platform.lockIndicator);

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

  /**
   * A screen opened before auto-lock can outlive it, so methods that change
   * the vault, its settings or a site's access check the lock themselves.
   */
  async function requireUnlocked(): Promise<void> {
    if (await keySession.isVaultLocked()) throw new Error(userErrorMessage("keyringLocked"));
  }

  /** The work behind each `BACKGROUND_MESSAGES` entry, run once its sender has been checked. */
  const MESSAGE_HANDLERS: MessageHandlers = {
    // wallet lifecycle
    createWallet: (data) => addWallet(() => lifecycle.createWallet(data)),
    importWallet: (data) => addWallet(() => lifecycle.importWallet(data)),
    addHardwareWallet: (data) => addWallet(() => lifecycle.addHardwareWallet(data)),
    addWatchWallet: (data) => addWallet(() => lifecycle.addWatchWallet(data)),
    deleteWallet: async (data) => {
      await requireUnlocked();
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
      await requireUnlocked();
      await lifecycle.switchWallet(data);
      await activeWalletChanged(data.walletId);
    },
    downloadKeyfile: (data) => lifecycle.downloadKeyfile(data),
    cancelKeyfileDownload: (data) => lifecycle.cancelKeyfileDownload(data),
    lockWallet: () => lockVault(),
    unlockWallet: async (data) => {
      const result = await lifecycle.unlockWallet(data);
      void platform.lockIndicator.setLocked(false);
      syncBackup();
      return result;
    },
    getPasskeyStatus: () => passkey.getPasskeyStatus(),
    checkVaultPassword: (data) => lifecycle.checkVaultPassword(data),
    probeVaultPassword: (data) => lifecycle.probeVaultPassword(data),
    enrollPasskey: (data) => passkey.enrollPasskey(data),
    unlockWithPasskey: async (data) => {
      const result = await passkey.unlockWithPasskey(data);
      void platform.lockIndicator.setLocked(false);
      syncBackup();
      return result;
    },
    getBackupStatus: () => backup.status(),
    setUpBackup: (data) => backup.setUp(data),
    syncBackupNow: () => backup.syncNow(),
    stopBackupSync: async () => {
      await requireUnlocked();
      return backup.stopSyncing();
    },
    deleteBackup: async () => {
      await requireUnlocked();
      return backup.deleteBackup();
    },
    findBackup: () => backup.find(),
    restoreBackup: async (data) => {
      const result = await backup.restore(data);
      if (result.unlockedWalletIds.length > 0) void platform.lockIndicator.setLocked(false);
      return result;
    },
    removePasskey: async () => {
      await requireUnlocked();
      return passkey.removePasskey();
    },
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
    getTokenPriceHistory: (data) => reads.getTokenPriceHistory(data),
    getConnectedApps: () => approval.getConnectedApps(),
    listContacts: () => contacts.listContacts(),
    listBrowserSites: () => browserSites.listBrowserSites(),

    // actions
    estimateTransfer: (data) => transfer.estimateTransfer(requireWalletId(data)),
    assessRecipient: (data) => transfer.assessRecipient(data),
    submitTransfer: (data) => transfer.submitTransfer(requireWalletId(data)),
    estimateCollectibleSend: (data) => transfer.estimateCollectibleSend(requireWalletId(data)),
    sendCollectible: (data) => transfer.sendCollectible(requireWalletId(data)),
    estimateNameTarget: (data) => transfer.estimateNameTarget(requireWalletId(data)),
    setNameTarget: (data) => transfer.setNameTarget(requireWalletId(data)),

    // approvals
    getApproval: (data) => approval.getApproval(data),
    getApprovalData: (data) => approval.getApprovalData(data),
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
    setLockSettings: async (data) => {
      await requireUnlocked();
      return lifecycle.setLockSettings(data);
    },
    getThemePreference: () => lifecycle.getThemePreference(),
    setThemePreference: (data) => lifecycle.setThemePreference(data),
    getDisplaySettings: () => lifecycle.getDisplaySettings(),
    setDisplaySettings: (data) => lifecycle.setDisplaySettings(data),
    getSecurityPhrase: () => securityPhrase.get(),
    setSecurityPhrase: async (data) => {
      await requireUnlocked();
      return securityPhrase.set(data);
    },
    revokeGrant: async (data) => {
      await approval.revokeGrant(data);
      void announceAccessEnded(data.origin);
    },
    getActiveSite: async () => siteWallet.activeSite(await tabs.activeTab()),
    useGleamOnSite: async (data) => {
      const origin = requireWebOrigin(data.origin);
      await requireUnlocked();
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
    getAvailableUpdate: () => announcements.fetchAvailableUpdate(),
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

  async function activeWallet() {
    const state = await lifecycle.getState();
    return state.wallets.find((wallet) => wallet.id === state.activeWalletId) ?? null;
  }

  const dispatchSite = createSiteDispatch({ storage, points, approval, activeWallet, dev: platform.dev });

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
    onInstalled() {
      // Only an install finds `local:networkSettings` empty; after that a
      // written NetworkSettings (default or user-edited) short-circuits it.
      void initializeNetworkSettingsIfMissing(storage, reads);
    },
  };
}
