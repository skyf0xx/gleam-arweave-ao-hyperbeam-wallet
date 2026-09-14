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

  // actions
  estimateTransfer(req: TransferDraft): FeeEstimate;
  submitTransfer(req: TransferDraft): { txId: string };
  reviewUpload(req: UploadDraft): UploadReview; // runs the secret scan
  submitUpload(req: UploadDraft): { txId: string };

  // approvals
  getApproval(req: { requestId: string }): ApprovalRequest;
  resolveApproval(req: { requestId: string; approved: boolean }): void;

  // settings
  setNetworkSettings(req: NetworkSettings): void;
  setLockSettings(req: LockSettings): void;
  revokeGrant(req: { origin: string }): void;
}
