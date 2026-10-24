import { assessRecipient, type Contact, type RuntimePort, type WalletSummary } from "@gleam/core";
import { useActivity } from "../../activity/src/useActivity";
import { recipientSchema } from "./sendFormSchema";

/**
 * The trusted address `recipient` imitates, checked as soon as a full
 * address is in the field rather than after Continue. It reads the cached
 * activity page plus contacts and the vault's wallets; the review step
 * still runs the background's check over the whole history.
 */
export function useLookalikeOf(
  runtime: RuntimePort,
  wallet: WalletSummary,
  recipient: string,
  contacts: Contact[],
  otherWallets: WalletSummary[],
): string | null {
  const activityQuery = useActivity(runtime, wallet.address);
  const parsed = recipientSchema.safeParse(recipient);
  if (!parsed.success) return null;
  const known = [wallet.address, ...contacts.map((contact) => contact.address), ...otherWallets.map((other) => other.address)];
  return assessRecipient(parsed.data, activityQuery.data?.entries ?? [], known).lookalikeOf;
}
