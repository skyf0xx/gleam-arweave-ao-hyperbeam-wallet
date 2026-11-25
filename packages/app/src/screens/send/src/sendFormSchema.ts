import { z } from "zod";
import { isValidArweaveAddress } from "@gleam/core";
import { t } from "../../../i18n";

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
  .refine(isValidArweaveAddress, { error: () => t("send.addressIncomplete") });

const AMOUNT_SHAPE = /^\d+(\.\d+)?$/;

/** Builds an amount schema for a token with `denomination` decimal places. */
export function amountSchema(denomination: number) {
  return z
    .string()
    .trim()
    .regex(AMOUNT_SHAPE, { error: () => t("send.invalidAmount") })
    .refine((value) => !/^0+(\.0+)?$/.test(value), { error: () => t("send.amountPositive") })
    .refine((value) => {
      const fraction = value.split(".")[1];
      return fraction === undefined || fraction.length <= denomination;
    }, { error: () => (denomination === 1 ? t("send.oneDecimal") : t("send.manyDecimals", { count: denomination })) });
}

export type RecipientValidation = z.infer<typeof recipientSchema>;

/** First issue's message from a failed `safeParse`, since `issues` is typed as possibly empty. */
export function firstIssueMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}
