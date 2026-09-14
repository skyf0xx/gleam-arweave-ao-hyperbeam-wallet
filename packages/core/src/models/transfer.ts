import type { Winston } from "./balance";

/**
 * An in-progress send: recipient address, token, amount, computed fee
 * (PRD §3 Glossary — TransferDraft). `fee` is populated only once
 * `estimateTransfer` has run — the review screen shows it, composition
 * does not (PRD §4 — Send AR).
 */
export interface TransferDraft {
  recipient: string;
  /** `null` denotes the native AR token; otherwise an AO token processId. */
  token: string | null;
  amount: Winston;
  fee: Winston | null;
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
