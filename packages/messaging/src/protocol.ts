import type {
  ActivityPage,
  ApprovalRequest,
  FeeEstimate,
  Grant,
  JWKInterface,
  LockSettings,
  NetworkSettings,
  PortfolioHistory,
  PortfolioHistoryRange,
  ThemeSettings,
  TokenBalance,
  TokenPrice,
  TransferDraft,
  UploadDraft,
  UploadReview,
  WalletState,
  WalletSummary,
  Winston,
} from "@gleam/core";
import type { ProviderSurfaceMethod } from "./page-protocol";

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
  deleteWallet(req: { walletId: string }): void;
  renameWallet(req: { walletId: string; name: string }): void;
  switchWallet(req: { walletId: string }): void;
  exportWallet(req: { walletId: string; password: string }): JWKInterface;
  /** Set only after a keyfile download or clipboard copy actually succeeds, not merely offered. */
  confirmWalletBackup(req: { walletId: string }): void;
  lockWallet(): void;
  unlockWallet(req: { password: string }): { unlockedWalletIds: string[] };
  /**
   * The "forgot password" destructive full-vault reset: wipes every
   * locally stored wallet, the active-wallet pointer, and the unlocked
   * session.
   */
  resetAllWallets(): void;

  // reads
  getState(): WalletState;
  getBalance(req: { address: string }): Winston;
  /**
   * A rough, recipient-less fee quote (drives the compose step's "Max"
   * before a recipient is filled in). Underestimates for a first-seen
   * recipient — see `estimateTransfer`'s own comment.
   */
  getArFee(): Winston;
  getTokenBalances(req: { address: string }): TokenBalance[];
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
   */
  getPortfolioHistory(req: { range: PortfolioHistoryRange }): PortfolioHistory;
  /**
   * Current spot USD price for every token in `core/pricing`'s
   * `DEFAULT_TOKEN_REGISTRY` (AR, AO) — drives the per-row `$` value
   * under each `TokenRow` on the Tokens tab. A token whose price
   * couldn't be computed comes back with `usd: null`, never a
   * fabricated `0`. Any watched token outside the registry has no entry
   * here at all.
   */
  getTokenPrices(): TokenPrice[];
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

  // actions
  // `TransferDraft`/`UploadDraft` carry `walletId` directly — signing
  // reads the decrypted JWK from the background's in-memory
  // unlocked-session cache (`apps/extension/src/handlers/key-session.ts`),
  // not a password on the request: once unlocked, no further call needs
  // one until the session is locked or its auto-lock timeout elapses.
  estimateTransfer(req: TransferDraft): FeeEstimate;
  submitTransfer(req: TransferDraft): { txId: string };
  reviewUpload(req: UploadDraft): UploadReview; // runs the secret scan
  submitUpload(req: UploadDraft): { txId: string };

  // approvals
  getApproval(req: { requestId: string }): ApprovalRequest;
  /**
   * A signing approval reads its signing key the same way
   * `submitTransfer`/`submitUpload` do — from the unlocked-session cache,
   * keyed by the request's own `walletId` — so `resolveApproval` alone is
   * enough to finalize either a `connect` or a signing approval; no
   * separate password hand-off call precedes it any more.
   *
   * Throws when an approved request fails (locked wallet, network error).
   * The dApp is rejected with the same error either way.
   */
  resolveApproval(req: { requestId: string; approved: boolean }): void;

  // settings
  setNetworkSettings(req: NetworkSettings): void;
  setLockSettings(req: LockSettings): void;
  setThemePreference(req: ThemeSettings): void;
  revokeGrant(req: { origin: string }): void;

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
   * `createWallet`/`importWallet`/`exportWallet` (`KEY_METHODS`) are only
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
