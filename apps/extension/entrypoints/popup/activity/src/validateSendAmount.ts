import type { TokenBalance } from "@gleam/core";
import type { WalletBalances } from "./useBalances";

/**
 * Client-side "insufficient balance" gate (RELEVANT RULES: "Attempting to
 * send more than the current balance is blocked client-side with a clear
 * inline message, validated against the query cache's current value").
 * Pure so `SendView` can call it synchronously against whatever
 * `useBalances` currently holds, with no extra network round-trip.
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
 */
export function validateSendAmount(
  amountAtomic: string,
  token: TokenBalance | null,
  balances: WalletBalances | undefined,
): string | null {
  if (!balances) return null;

  const available =
    token === null ? balances.arBalance : balances.tokenBalances.find((t) => t.processId === token.processId)?.quantity;

  if (available === undefined) return null;

  try {
    if (BigInt(amountAtomic) > BigInt(available)) {
      return "That's more than your current balance.";
    }
  } catch {
    return null;
  }

  return null;
}
