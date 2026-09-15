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
 * The typed background RPC contract, per ARCHITECTURE.md §4.1 exactly.
 * `@webext-core/messaging`'s `defineExtensionMessaging<ProtocolMap>()`
 * turns this into typed `sendMessage`/`onMessage` pairs — the dispatcher
 * that wires handlers to these methods, and enforces the privilege-tier
 * boundary between them (`PROVIDER_METHODS`/`APPROVAL_METHODS`/
 * `KEY_METHODS`, defined in `@gleam/core`'s models), is a later layer's
 * job. This layer only pins the wire shape.
 */
export interface ProtocolMap {
  // wallet lifecycle
  createWallet(req: { name: string; password: string }): WalletSummary;
  importWallet(req: { jwk: JWKInterface; name: string; password: string }): WalletSummary;
  deleteWallet(req: { walletId: string }): void;
  renameWallet(req: { walletId: string; name: string }): void;
  switchWallet(req: { walletId: string }): void;
  exportWallet(req: { walletId: string; password: string }): JWKInterface;
  lockWallet(): void;
  unlockWallet(req: { password: string }): { unlockedWalletIds: string[] };

  // reads
  getState(): WalletState;
  getBalance(req: { address: string }): Winston;
  getTokenBalances(req: { address: string }): TokenBalance[];
  getActivity(req: { address: string; cursor?: string }): ActivityPage;
  getConnectedApps(): Grant[];
  /**
   * Drives the main screen's total-portfolio-value chart. `range` selects
   * one of the 5 tabs (24H/7D/1M/1Y/ALL); the response carries both the
   * series to plot and the summary figures (current value, % change,
   * period label) already computed, per `PortfolioHistory`'s own doc
   * comment. An empty `series` means both price sources were unavailable
   * — the popup falls back to `NetworkErrorBanner`, same as a balance-load
   * failure, rather than rendering a broken or blank chart.
   */
  getPortfolioHistory(req: { range: PortfolioHistoryRange }): PortfolioHistory;
  /**
   * Current spot USD price for every token in `core/pricing`'s
   * `DEFAULT_TOKEN_REGISTRY` (AR, AO) — drives the per-row `$` value under
   * each `TokenRow` on the Tokens tab. A token whose price couldn't be
   * computed (both CoinGecko/CoinPaprika unavailable) comes back with
   * `usd: null`, never a fabricated `0` — the row simply shows no `$` line,
   * same HONESTY contract `getPortfolioHistory` already follows. Any
   * watched token outside the registry has no entry here at all (see
   * `priceSourceForProcessId`'s own doc comment on why an arbitrary AO
   * process can't be priced).
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
  // `TransferDraft`/`UploadDraft` carry `walletId` directly (added by
  // `provider-bridge`, see those models' doc comments) — signing reads
  // the decrypted JWK from the background's in-memory unlocked-session
  // cache (`apps/extension/src/handlers/key-session.ts`), not a password
  // on the request: once unlocked, no further call needs one until the
  // session is locked or its auto-lock timeout elapses.
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
   * of this map's other, per-purpose methods — none of which exist for
   * the 19-method ArConnect-compatible surface, since that surface is
   * page-facing, not popup/background-facing, and only ever reaches the
   * background through this one relay. `origin` is attached by the
   * content script from `location.origin`, never trusted from the page's
   * own message payload (a page cannot claim to be a different origin).
   *
   * This is the dispatcher's actual privilege-tier choke point (this
   * task's highest-stakes rule): every `providerCall` is checked against
   * `PROVIDER_METHODS` before being routed anywhere, and nothing else in
   * this map is reachable this way — `resolveApproval`/`getApproval`
   * (`APPROVAL_METHODS`) and `createWallet`/`importWallet`/`exportWallet`
   * (`KEY_METHODS`) are only ever called directly, by their own trusted
   * senders, never proxied through `providerCall`.
   */
  providerCall(req: { origin: string; method: ProviderSurfaceMethod; params: unknown }): unknown;
}
