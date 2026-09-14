import type { Winston } from "./balance";

/**
 * An in-progress send: recipient address, token, amount, computed fee
 * (PRD §3 Glossary — TransferDraft). `fee` is populated only once
 * `estimateTransfer` has run — the review screen shows it, composition
 * does not (PRD §4 — Send AR).
 *
 * `walletId`/`password` (added by `provider-bridge`, closing a debt
 * `wallet-core` declared): signing a transfer needs the decrypted JWK, and
 * `WalletLifecycleHandler.unlockWallet` never persists derived key
 * material — every signing call must re-derive from the password. Both
 * fields were previously bolted on locally by `handlers/transfer.ts` as
 * `TransferDraft & { walletId; password }`; they now live on the model
 * itself so `ProtocolMap`'s wire contract carries them directly.
 *
 * Typed optional here (not strictly required) only to stay
 * structurally compatible with `models.models.test.ts`'s existing
 * `TransferDraft` literal (locked outside this task's ALLOWED SCOPE,
 * `messaging`'s scope) — see this task's final report. Every real
 * `estimateTransfer`/`submitTransfer` caller in this layer still always
 * supplies both; `handlers/transfer.ts`'s own `TransferDraft & {
 * walletId: string; password: string }` intersection still narrows them
 * back to required for that handler's own signature.
 */
export interface TransferDraft {
  recipient: string;
  /** `null` denotes the native AR token; otherwise an AO token processId. */
  token: string | null;
  amount: Winston;
  fee: Winston | null;
  walletId?: string;
  password?: string;
}

export interface FeeEstimate {
  fee: Winston;
  /**
   * `true` when no prior ActivityEntry exists for `recipient` — escalates
   * the review screen to first-seen-address (Irreversible) tier framing
   * (PRD §4 — Send AR). The tiering decision itself belongs to the
   * `wallet-core` layer; this field only carries the computed result.
   */
  firstSeenRecipient: boolean;
}
