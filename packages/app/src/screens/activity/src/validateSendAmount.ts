import type { TokenBalance } from "@gleam/core";
import { formatWinstonAsAr } from "../../main-screen/src/formatWinston";
import type { WalletBalances } from "./useBalances";

/**
 * Client-side "insufficient balance" gate, validated against the query
 * cache's current value. Pure so `SendView` can call it synchronously
 * against whatever `useBalances` currently holds, with no extra network
 * round-trip.
 *
 * `token === null` validates against `balances.arBalance`; a `TokenBalance`
 * validates against the matching `processId` entry in
 * `balances.tokenBalances`. Returns `null` (no problem) or a message
 * string ready to render inline — never throws, since "amount too high"
 * is an expected, always-possible user input, not an exceptional state.
 *
 * If `balances` hasn't loaded yet (still fetching, or the query errored),
 * this can't yet know whether the amount is affordable — it deliberately
 * returns `null` (no error shown) rather than blocking submission, since
 * blocking here would misrepresent "unknown" as "insufficient". The
 * actual send still goes through the backend, which is the authoritative
 * check; this is a pre-submission UX affordance only.
 *
 * `arFeeAtomic`: for the AR path (`token === null`), the estimated
 * network fee, added to `amountAtomic` before comparing against the
 * balance — an AR send that spends the whole balance still needs the fee
 * on top, or the gateway rejects it. `undefined` (fee not loaded yet)
 * skips the fee-inclusive check the same way an unloaded balance does,
 * for the same "unknown isn't insufficient" reason. Ignored for AO token
 * sends, which have no sender-side fee (see `FeeEstimate.fee`'s doc
 * comment).
 *
 * When the amount fits the balance but amount + fee doesn't, the message
 * names the fee and its size instead of the generic balance error, so the
 * user isn't told they're short on an amount they can see they have.
 * `feeIsNewAddress` (the recipient-aware fee exceeds the recipient-less
 * quote, i.e. the gateway added its new-wallet fee) says why the fee is
 * that large.
 */
export function validateSendAmount(
  amountAtomic: string,
  token: TokenBalance | null,
  balances: WalletBalances | undefined,
  arFeeAtomic?: string,
  feeIsNewAddress = false,
): string | null {
  if (!balances) return null;

  const available =
    token === null ? balances.arBalance : balances.tokenBalances.find((t) => t.processId === token.processId)?.quantity;

  if (available === undefined) return null;

  try {
    if (BigInt(amountAtomic) > BigInt(available)) {
      return "That's more than your current balance.";
    }
    if (token === null && arFeeAtomic !== undefined && BigInt(amountAtomic) + BigInt(arFeeAtomic) > BigInt(available)) {
      const fee = `${formatWinstonAsAr(arFeeAtomic, 12)} AR`;
      return feeIsNewAddress
        ? `This address is new to Arweave, so the network fee is ${fee}. That plus this amount is more than your balance.`
        : `The network fee is ${fee}. That plus this amount is more than your balance.`;
    }
  } catch {
    return null;
  }

  return null;
}
