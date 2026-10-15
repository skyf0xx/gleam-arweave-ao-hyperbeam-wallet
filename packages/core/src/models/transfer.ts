import type { Winston } from "./balance";
import type { CollectibleRef } from "./collectible";

/**
 * An in-progress send: recipient address, token, amount, computed fee.
 * `fee` is populated only once `estimateTransfer` has run — the review
 * screen shows it, composition does not.
 *
 * `walletId` is typed optional here even though every real
 * `estimateTransfer`/`submitTransfer` caller supplies it;
 * `handlers/transfer.ts`'s own `TransferDraft & { walletId: string }`
 * intersection narrows it back to required for that handler's signature.
 */
export interface TransferDraft {
  recipient: string;
  /** `null` denotes the native AR token; otherwise an AO token processId. */
  token: string | null;
  amount: Winston;
  fee: Winston | null;
  walletId?: string;
  /**
   * Set for a collectible send, with `token: null` and `amount: "0"`: the
   * L1 transaction goes to the asset process and carries the transfer in
   * its tags (`core/ao/collectible-transfer.ts`).
   */
  collectible?: CollectibleRef | null;
}

/**
 * The `params` shape a dApp sends when calling `window.arweaveWallet`'s
 * `transferAoTokens` provider-surface method. `token` is the AO processId
 * — never `null` here, since this method exists specifically for the AO
 * path; an AR send has no provider-surface method of its own yet.
 */
export interface AoTokenTransferRequest {
  /** The AO token's process id. */
  token: string;
  recipient: string;
  amount: Winston;
}

/**
 * What the dApp receives back once the transfer is approved and
 * submitted. Named `id` (mirroring `SubmittedAoTransfer.messageId`) for
 * parity with ArConnect's `dispatch()` response shape.
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
   * `true` when no prior ActivityEntry exists for `recipient` —
   * escalates the review screen to first-seen-address (Irreversible)
   * tier framing.
   */
  firstSeenRecipient: boolean;
  /**
   * A known address (contact, own wallet, past recipient) this recipient
   * imitates by its first and last characters — address poisoning.
   */
  lookalikeOf?: string | null;
}
