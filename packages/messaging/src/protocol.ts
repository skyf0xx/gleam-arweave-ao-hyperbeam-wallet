import type {
  ActiveSite,
  ActivityPage,
  Announcement,
  ReviewMoment,
  Collectible,
  CollectibleSendDraft,
  ApprovalRequest,
  Contact,
  RecipientAssessment,
  FeeEstimate,
  FileDownloadResult,
  Grant,
  HardwareDevice,
  HardwareWalletMethod,
  InviteUnlock,
  JWKInterface,
  LockSettings,
  PasskeyStatus,
  DisplayCurrency,
  DisplaySettings,
  NetworkSettings,
  PermissionType,
  PointsMembership,
  PointsSharePrompt,
  PointsScores,
  PortfolioHistory,
  PortfolioHistoryRange,
  PortfolioScope,
  ScanStats,
  SecurityPhrase,
  ThemeSettings,
  TokenBalance,
  TokenPrice,
  TransferDraft,
  WalletState,
  WalletSummary,
  Winston,
} from "@gleam/core";
import type { ProviderSurfaceMethod } from "./page-protocol";
import type { SiteAttestResponse } from "./site-protocol";

export type AttestationCheck = { ok: true } | { ok: false; error: string };

/**
 * What a finished request shows in its window, for the kinds whose window
 * stays open after approval. A scan attestation shows the points it
 * earned or why it was refused.
 */
export interface ApprovalShown {
  shown: "scanAttestation";
  result: SiteAttestResponse;
}

/**
 * The typed background RPC contract. `@webext-core/messaging`'s
 * `defineExtensionMessaging<ProtocolMap>()` turns this into typed
 * `sendMessage`/`onMessage` pairs — the dispatcher that wires handlers
 * to these methods, and enforces the privilege-tier boundary between
 * them (`PROVIDER_METHODS`/`APPROVAL_METHODS`/`KEY_METHODS`, defined in
 * `@gleam/core`'s models), is a later layer's job. This layer only pins
 * the wire shape.
 */
export interface ProtocolMap {
  // wallet lifecycle
  createWallet(req: { name: string; password: string }): WalletSummary;
  importWallet(req: { jwk: JWKInterface; name: string; password: string }): WalletSummary;
  /**
   * Adds a Keystone or Ledger wallet from the public key the device
   * reported (base64url RSA modulus). No key material is stored. Needs
   * Gleam unlocked when the vault has a password.
   */
  addHardwareWallet(req: {
    method: HardwareWalletMethod;
    publicKey: string;
    device: HardwareDevice;
    name?: string;
  }): WalletSummary;
  /**
   * Adds a watch-only wallet: just an address, with no key, so it can't
   * sign or connect to sites. Needs Gleam unlocked when the vault has a
   * password.
   */
  addWatchWallet(req: { address: string; name?: string }): WalletSummary;
  deleteWallet(req: { walletId: string }): void;
  renameWallet(req: { walletId: string; name: string }): void;
  switchWallet(req: { walletId: string }): void;
  /**
   * The background decrypts the keyfile and saves it to the user's
   * downloads itself, so the plaintext key never crosses messaging, and
   * records the backup on success. A wrong password rejects; a cancelled
   * or failed download, or a missing `downloads` permission, resolves
   * `ok: false`.
   */
  downloadKeyfile(req: { walletId: string; password: string }): FileDownloadResult;
  /** Ends a `downloadKeyfile` still waiting for the `downloads` grant, so it stops holding the password. */
  cancelKeyfileDownload(req: { walletId: string }): void;
  lockWallet(): void;
  unlockWallet(req: { password: string }): { unlockedWalletIds: string[] };
  /**
   * The "forgot password" destructive full-vault reset: wipes every
   * locally stored wallet, the active-wallet pointer, and the unlocked
   * session.
   */
  resetAllWallets(): void;
  /** Whether a passkey can unlock Gleam, and the public inputs its ceremony needs. */
  getPasskeyStatus(): PasskeyStatus;
  /**
   * Throws unless `password` opens the vault. Asked before creating a
   * passkey, so a mistyped password never leaves an unusable passkey in
   * the user's password manager.
   */
  checkVaultPassword(req: { password: string }): void;
  /**
   * Whether `password` opens the vault. Rejects when the check couldn't
   * run (storage, Argon2id), which is never a wrong password. Asked before
   * dropping a stored biometric password that failed to unlock.
   */
  probeVaultPassword(req: { password: string }): { opens: boolean };
  /**
   * Stores the vault password wrapped under the passkey's PRF output.
   * `prfSalt` and `prfOutput` are base64url. Replaces any earlier passkey.
   */
  enrollPasskey(req: { password: string; credentialId: string; prfSalt: string; prfOutput: string }): void;
  /** Unlocks with the PRF output (base64url) of the enrolled passkey. */
  unlockWithPasskey(req: { credentialId: string; prfOutput: string }): { unlockedWalletIds: string[] };
  removePasskey(): void;

  // reads
  /**
   * Counts as auto-lock activity unless `recordActivity` is false. The
   * approval window passes false: a site opens it, so its mere loading
   * isn't the user, and only its approve and reject count.
   */
  getState(req?: { recordActivity?: boolean }): WalletState;
  getBalance(req: { address: string }): Winston;
  /**
   * A rough, recipient-less fee quote (drives the compose step's "Max"
   * before a recipient is filled in). Underestimates for a first-seen
   * recipient — see `estimateTransfer`'s own comment.
   */
  getArFee(): Winston;
  getTokenBalances(req: { address: string }): TokenBalance[];
  /**
   * The AO NFTs `address` holds. Separate from `getTokenBalances` so a slow
   * discovery never delays the token list. Popup-only. Answers from the
   * background's per-wallet cache while it is fresh; `refresh` rediscovers.
   */
  getCollectibles(req: { address: string; refresh?: boolean }): Collectible[];
  getWatchedTokens(req: { address: string }): string[];
  /** Resolves a process id's ticker/balance without storing it. */
  previewWatchedToken(req: { address: string; processId: string }): TokenBalance;
  addWatchedToken(req: { address: string; processId: string }): TokenBalance;
  removeWatchedToken(req: { address: string; processId: string }): void;
  getActivity(req: { address: string; cursor?: string }): ActivityPage;
  getConnectedApps(): Grant[];
  /**
   * Drives the main screen's total-portfolio-value chart. `range` selects
   * one of the 5 tabs (24H/7D/1M/1Y/ALL); the response carries both the
   * series to plot and the summary figures already computed. An empty
   * `series` means both price sources were unavailable — the popup falls
   * back to `NetworkErrorBanner` rather than rendering a broken chart.
   * `scope` defaults to `"wallet"`: the wallet at `address`, refused when
   * it isn't stored, or the active wallet without one. `"all"` totals
   * every stored wallet. Values are in `currency`.
   */
  getPortfolioHistory(req: { range: PortfolioHistoryRange; address?: string; scope?: PortfolioScope; currency: DisplayCurrency }): PortfolioHistory;
  /**
   * Current spot price in `currency` for every token in `core/pricing`'s
   * `DEFAULT_TOKEN_REGISTRY` (AR, AO) — drives the value line under each
   * `TokenRow` on the Tokens tab. A token whose price couldn't be
   * computed comes back with `price: null`, never a fabricated `0`. Any
   * watched token outside the registry has no entry here at all.
   */
  getTokenPrices(req: { currency: DisplayCurrency }): TokenPrice[];
  getLockSettings(): LockSettings;
  getNetworkSettings(): NetworkSettings;
  /**
   * Wallet-owner-only local UI setting, same tier as `getLockSettings`/
   * `getNetworkSettings` — not page-originated, so it is never listed in
   * `PROVIDER_METHODS`/`APPROVAL_METHODS`/`KEY_METHODS`
   * (`core/models/method-privileges.ts`) and is only ever called directly
   * by trusted extension UI, never proxied through `providerCall`.
   */
  getThemePreference(): ThemeSettings;
  /** Currency, headline and chart choices for the main screen; same tier as `getThemePreference`. */
  getDisplaySettings(): DisplaySettings;
  /** Read while locked: the unlock screen shows it before the password is typed. */
  getSecurityPhrase(): SecurityPhrase | null;
  /** One list for the whole vault, most-recently-saved first. */
  listContacts(): Contact[];
  /** The dApp browser's saved and recent sites, as origins, most recent first. */
  listBrowserSites(): { saved: string[]; recent: string[] };

  // actions
  // `TransferDraft` carries `walletId` directly — signing
  // reads the decrypted JWK from the background's in-memory
  // unlocked-session cache (`packages/runtime/src/handlers/key-session.ts`),
  // not a password on the request: once unlocked, no further call needs
  // one until the session is locked or its auto-lock timeout elapses.
  estimateTransfer(req: TransferDraft): FeeEstimate;
  /** First-time and lookalike checks for a recipient, for the approval window. */
  assessRecipient(req: { walletId: string; recipient: string }): RecipientAssessment;
  submitTransfer(req: TransferDraft): { txId: string };
  /** Quotes the AR network fee for sending one collectible; fails when the wallet's AR can't cover it. */
  estimateCollectibleSend(req: CollectibleSendDraft): FeeEstimate;
  /** Sends one collectible as an L1 transaction to its process (`core/ao/collectible-transfer.ts`). */
  sendCollectible(req: CollectibleSendDraft): { txId: string };

  // approvals
  getApproval(req: { requestId: string }): ApprovalRequest;
  /**
   * A signing approval reads its signing key the same way
   * `submitTransfer` does — from the unlocked-session cache,
   * keyed by the request's own `walletId` — so `resolveApproval` alone is
   * enough to finalize either a `connect` or a signing approval; no
   * separate password hand-off call precedes it any more.
   *
   * Throws when an approved request fails (locked wallet, network error).
   * The dApp is rejected with the same error either way.
   *
   * A hardware wallet's approved request isn't finished here: it returns
   * the request with `device` set (its unsigned payloads), and the window
   * answers with `submitDeviceSignature`. Rejecting still works while the
   * request waits for the device.
   *
   * A scan attestation returns `ApprovalShown`, and its window stays open
   * to show it.
   */
  resolveApproval(req: { requestId: string; approved: boolean }): ApprovalRequest | ApprovalShown | void;
  /**
   * The device's signatures (base64url, one per `device.payloads` entry,
   * in order) for a request waiting on a hardware wallet. Each is checked
   * against the wallet's stored public key first: a bad one throws and
   * leaves the request waiting, so the user can sign again. Otherwise the
   * request completes as `resolveApproval` would for a keyfile wallet.
   */
  submitDeviceSignature(req: { requestId: string; signatures: string[] }): ApprovalShown | void;
  /**
   * A scan attestation's dry run against the points API, asked before the
   * signature is. `error` says what to do next.
   */
  checkScanAttestation(req: { requestId: string }): AttestationCheck;
  /** Heartbeat while the window talks to the device; pushes the timeout back, up to the request's device cap. */
  deviceActivity(req: { requestId: string }): { deadline: number };

  // settings
  setNetworkSettings(req: NetworkSettings): void;
  setLockSettings(req: LockSettings): void;
  setThemePreference(req: ThemeSettings): void;
  setDisplaySettings(req: DisplaySettings): void;
  /** Rejects a phrase `readSecurityPhrase` doesn't accept. */
  setSecurityPhrase(req: SecurityPhrase): void;
  revokeGrant(req: { origin: string }): void;
  /**
   * Upserts by `address` (case-sensitive exact match): saving over an
   * address already in the list replaces its name rather than adding a
   * duplicate entry. `name` is trimmed and must be 1-32 characters.
   */
  saveContact(req: { address: string; name: string }): Contact;
  deleteContact(req: { address: string }): void;
  /** Saves the origin of an http(s) `url`; saving it again moves it to the top. */
  saveBrowserSite(req: { url: string }): void;
  removeBrowserSite(req: { origin: string }): void;
  /** Keeps the 10 most recent origins, one entry per origin. */
  recordRecentSite(req: { url: string }): void;
  clearRecentSites(): void;

  /**
   * Opts a wallet into Gleam Points (POINTS.md § Identity): the wallet
   * signs a register payload binding it to this install's device key. The
   * wallet must be unlocked. `inviteCode` is a hand-typed code; without
   * one, a code the site handed over on install is used, if any.
   */
  joinPoints(req: { walletId: string; inviteCode?: string }): PointsMembership;
  /**
   * Leaves Gleam Points: deletes the wallet's points data from the server
   * and forgets its membership here. The wallet must be unlocked.
   */
  leavePoints(req: { walletId: string }): void;
  /** Registered wallets, keyed by wallet id. */
  getPointsMemberships(): Record<string, PointsMembership>;
  /** This install's wallets' standing from the points API; null before any wallet joins. */
  getPointsScores(): PointsScores | null;
  /** The install-time invite redemption, or null if no code has been redeemed yet. */
  getPointsInviteUnlock(): InviteUnlock | null;
  /**
   * Redeems a hand-typed invite code with this install's device key (the
   * Founding gate). Skips the request once the install is unlocked.
   */
  redeemPointsInvite(req: { code: string }): InviteUnlock;
  /**
   * The member invite code the claim step will apply, or null. A drop
   * code (no referrer) is never returned.
   */
  getPointsPendingInvite(): string | null;
  /** Ids of wallets whose founding reveal was already shown. */
  getPointsRevealSeen(): string[];
  markPointsRevealSeen(req: { walletId: string }): void;
  /** Wallets whose claim step is still waiting for Claim or Not now. */
  getPointsClaimPending(): string[];
  setPointsClaimPending(req: { walletId: string; pending: boolean }): void;
  /** The named share prompts each wallet has dismissed or acted on, keyed by wallet id. */
  getPointsShareSeen(): Record<string, PointsSharePrompt[]>;
  markPointsShareSeen(req: { walletId: string; prompt: PointsSharePrompt }): void;
  /**
   * The seat count each member wallet has been shown, keyed by wallet id.
   * A wallet is absent until the points API has reported its seats. A
   * count above this one is a new invite (journey F) and puts a dot on
   * the toolbar icon until it is marked seen.
   */
  getPointsSeatsSeen(): Record<string, number>;
  /** Records that the member has seen `seats` invites; clears the toolbar dot once no wallet has a newer count. */
  markPointsSeatsSeen(req: { walletId: string; seats: number }): void;

  /**
   * The site's announcements, validated: malformed entries and links off
   * the host allowlist are dropped, and any failure yields an empty list.
   */
  getAnnouncements(): Announcement[];
  /**
   * The running release's community scan count and paid places left, from
   * the points API; null when they can't be read.
   */
  getScanStats(): ScanStats | null;
  /** Ids of the announcements the user has dismissed. */
  getDismissedAnnouncements(): string[];
  dismissAnnouncement(req: { id: string }): void;
  /**
   * The moment to ask for a store review after, or null once asked or
   * before one has happened. `since` is when the popup opened: a moment
   * from the current visit waits for the next one.
   */
  getReviewPrompt(req: { since: number }): ReviewMoment | null;
  /** Records the review prompt as answered, either way; it never shows again. */
  finishReviewPrompt(): void;

  // the site in the active tab
  /** Null when the active tab isn't an http(s) page. */
  getActiveSite(): ActiveSite | null;
  /**
   * Grants `origin` from the popup, so its page uses Gleam instead of the
   * other installed wallet, and reloads the active tab if it shows that
   * origin. The user picks `permissions` in the popup; a later `connect()`
   * asking for more still prompts for the rest. Needs a wallet.
   */
  useGleamOnSite(req: { origin: string; permissions: PermissionType[] }): void;
  /** Revokes the grant, hands the site back to the other wallet, and reloads the active tab if it shows `origin`. */
  stopGleamOnSite(req: { origin: string }): void;
  dismissSiteSuggestion(req: { origin: string }): void;

  /**
   * Content script only. Whether the sending tab's origin uses Gleam over
   * another installed wallet: true when the user chose Gleam for it or it
   * holds an active grant. Like `providerCall`, the origin comes from
   * Chrome's `sender`.
   */
  getSiteWalletMode(): { useGleam: boolean };
  /** Content script only. Relays a `PageOtherWalletEnvelope` for the sending tab. */
  reportOtherWallet(req: { walletName: string; used: boolean; permissions?: string[] }): void;
  /** Background → content-script push when a site's grant comes or goes. */
  siteWalletMode(req: { useGleam: boolean }): void;

  /**
   * The single relay point for every page-originated provider call
   * (`PROVIDER_SURFACE_METHODS`, `page-protocol.ts`). The content script
   * forwards a page's `PageRequestEnvelope` here rather than through any
   * of this map's other, per-purpose methods. The request carries no
   * origin: the background reads it from Chrome's `sender` for the
   * content script's frame, so neither a page nor a compromised content
   * script can claim to be another site.
   *
   * This is the dispatcher's privilege-tier choke point: every
   * `providerCall` is checked against `PROVIDER_METHODS` before being
   * routed anywhere, and nothing else in this map is reachable this way
   * — `resolveApproval`/`getApproval` (`APPROVAL_METHODS`) and
   * `createWallet`/`importWallet`/`downloadKeyfile` (`KEY_METHODS`) are only
   * ever called directly, by their own trusted senders, never proxied
   * through `providerCall`.
   */
  providerCall(req: { method: ProviderSurfaceMethod; params: unknown }): unknown;

  /**
   * The background → content-script push counterpart of `providerCall`:
   * background sends this directly to a specific tab (via
   * `@webext-core/messaging`'s `sendMessage(type, data, tabId)`, never
   * broadcast to every tab), and `content/index.ts` relays `event`/`data`
   * straight into `postProviderEvent`, which the page-side provider's
   * already-idle `handleEvent()` picks up. Access control (only a tab
   * whose origin holds an active `Grant` is ever targeted) is enforced by
   * the caller choosing which tabIds to send to, not by this method
   * itself — see `provider-bridge`'s broadcast helper in
   * `background/index.ts`.
   */
  providerEvent(req: { event: string; data: unknown }): void;
}
