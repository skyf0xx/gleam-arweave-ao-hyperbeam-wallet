import type { TokenBalance } from "@gleam/core";
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
 */
export function validateSendAmount(
  amountAtomic: string,
  token: TokenBalance | null,
  balances: WalletBalances | undefined,
  arFeeAtomic?: string,
): string | null {
  if (!balances) return null;

  const available =
    token === null ? balances.arBalance : balances.tokenBalances.find((t) => t.processId === token.processId)?.quantity;

  if (available === undefined) return null;

  try {
    const required =
      token === null && arFeeAtomic !== undefined ? BigInt(amountAtomic) + BigInt(arFeeAtomic) : BigInt(amountAtomic);
    if (required > BigInt(available)) {
      return "That's more than your current balance.";
    }
  } catch {
    return null;
  }

  return null;
}
