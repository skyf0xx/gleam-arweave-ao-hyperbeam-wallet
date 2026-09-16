import type { Winston } from "./balance";

/**
 * An in-progress send: recipient address, token, amount, computed fee
 * (PRD §3 Glossary — TransferDraft). `fee` is populated only once
 * `estimateTransfer` has run — the review screen shows it, composition
 * does not (PRD §4 — Send AR).
 *
 * `walletId` (added by `provider-bridge`, closing a debt `wallet-core`
 * declared): signing a transfer needs the decrypted JWK, read from the
 * background's in-memory unlocked-session cache
 * (`apps/extension/src/handlers/key-session.ts`) rather than re-derived
 * from a password on every call — see that file's doc comment.
 *
 * Typed optional here (not strictly required) only to stay
 * structurally compatible with `models.models.test.ts`'s existing
 * `TransferDraft` literal (locked outside this task's ALLOWED SCOPE,
 * `messaging`'s scope) — see this task's final report. Every real
 * `estimateTransfer`/`submitTransfer` caller in this layer always
 * supplies it; `handlers/transfer.ts`'s own `TransferDraft & { walletId:
 * string }` intersection still narrows it back to required for that
 * handler's own signature.
 */
export interface TransferDraft {
  recipient: string;
  /** `null` denotes the native AR token; otherwise an AO token processId. */
  token: string | null;
  amount: Winston;
  fee: Winston | null;
  walletId?: string;
}

/**
 * The `params` shape a dApp sends when calling `window.arweaveWallet`'s
 * `transferAoTokens` provider-surface method (`messaging/page-protocol.ts`'s
 * `PROVIDER_SURFACE_METHODS`). Mirrors `TransferDraft`'s AO-relevant fields
 * exactly (`token` as the AO processId — never `null` here, since this
 * method exists specifically for the AO path; an AR send has no
 * provider-surface method of its own yet) so the later `provider-bridge`
 * dispatcher can build a `TransferDraft` from this without re-deriving
 * field names. `amount` is an atomic-integer string in the token's own
 * smallest unit, matching `TransferDraft.amount`/`TokenBalance.quantity`.
 *
 * This layer only pins the request/response shape — resolving `walletId`
 * from the connected Grant, routing through `ApprovalHandler`, and actually
 * signing/submitting via `core/ao/transfer.ts`'s `submitTransfer` are all
 * `provider-bridge` layer's job.
 */
export interface AoTokenTransferRequest {
  /** The AO token's process id. */
  token: string;
  recipient: string;
  amount: Winston;
}

/**
 * What the dApp receives back once the transfer is approved and submitted.
 * Mirrors `core/ao/transfer.ts`'s `SubmittedAoTransfer.messageId` under the
 * name `id` for parity with ArConnect's own `dispatch()` response shape
 * (`{ id, type }`), which existing dApp integrations already expect from a
 * dispatch-shaped call.
 */
export interface AoTokenTransferResult {
  id: string;
}

export interface FeeEstimate {
  /**
   * `null` for an AO token transfer — AO `Transfer` messages have no
   * sender-side fee quote the way an AR value-transfer does (see
   * `core/ao/transfer.ts`'s doc comment). Non-null for the AR path.
   */
  fee: Winston | null;
  /**
   * `true` when no prior ActivityEntry exists for `recipient` — escalates
   * the review screen to first-seen-address (Irreversible) tier framing
   * (PRD §4 — Send AR). The tiering decision itself belongs to the
   * `wallet-core` layer; this field only carries the computed result.
   */
  firstSeenRecipient: boolean;
}
