import type {
  ActivityPage,
  ApprovalRequest,
  FeeEstimate,
  Grant,
  JWKInterface,
  LockSettings,
  NetworkSettings,
  TokenBalance,
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
  getLockSettings(): LockSettings;
  getNetworkSettings(): NetworkSettings;

  // actions
  // `TransferDraft`/`UploadDraft` carry `walletId`/`password` directly
  // (added by `provider-bridge`, see those models' doc comments) — signing
  // needs the decrypted JWK, re-derived per call, never persisted.
  estimateTransfer(req: TransferDraft): FeeEstimate;
  submitTransfer(req: TransferDraft): { txId: string };
  reviewUpload(req: UploadDraft): UploadReview; // runs the secret scan
  submitUpload(req: UploadDraft): { txId: string };

  // approvals
  getApproval(req: { requestId: string }): ApprovalRequest;
  resolveApproval(req: { requestId: string; approved: boolean }): void;
  /**
   * `APPROVAL_METHODS` (`core/models/method-privileges.ts`) names this
   * method, but no layer before this one had a shape for it. A signing
   * approval needs a password to actually decrypt the signing key, but
   * `resolveApproval`'s own shape is locked to exactly `{ requestId,
   * approved }` (`protocol.messaging.test.ts`'s `toEqualTypeOf`
   * assertion, outside this layer's ALLOWED SCOPE to change) — so the
   * approval window calls this first, from the same trusted approval
   * context, to hand off the password for a pending signing request
   * before calling `resolveApproval({ requestId, approved: true })`
   * without one. A `connect` approval never calls this at all — no
   * signing key is needed to create a Grant.
   */
  unlockApprovalWallet(req: { requestId: string; password: string }): void;

  // settings
  setNetworkSettings(req: NetworkSettings): void;
  setLockSettings(req: LockSettings): void;
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
