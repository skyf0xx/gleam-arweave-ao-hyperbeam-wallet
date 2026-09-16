import { z } from "zod";

/**
 * Compose-step field validation (recipient shape + amount shape/precision).
 * Balance-sufficiency is deliberately not part of this schema — it depends
 * on the async `useBalances` query cache, not on the raw input alone, and
 * stays in `validateSendAmount.ts`.
 *
 * Messages are hand-written rather than zod's defaults or
 * `zod-validation-error`: these are user-facing wallet copy, and zod has no
 * way to generate "check for a missing character" or explain a denomination
 * mismatch on its own.
 */

export const recipientSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, "That doesn't look like a full Arweave address: check for a missing character.");

const AMOUNT_SHAPE = /^\d+(\.\d+)?$/;

/** Builds an amount schema for a token with `denomination` decimal places. */
export function amountSchema(denomination: number) {
  return z
    .string()
    .trim()
    .regex(AMOUNT_SHAPE, "Enter a valid amount.")
    .refine((value) => !/^0+(\.0+)?$/.test(value), "Enter an amount greater than 0.")
    .refine((value) => {
      const fraction = value.split(".")[1];
      return fraction === undefined || fraction.length <= denomination;
    }, `This token supports up to ${denomination} decimal place${denomination === 1 ? "" : "s"}.`);
}

export type RecipientValidation = z.infer<typeof recipientSchema>;

/** First issue's message from a failed `safeParse`, since `issues` is typed as possibly empty. */
export function firstIssueMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}
