import type { TransferFeeQuote } from "@gleam/core";

export type Step =
  | {
      kind: "compose";
      recipient: string;
      amountDisplay: string;
      submitting: boolean;
      recipientError?: string;
      amountError?: string;
      /** Toggled by "Save this address" — reveals the name field below it. */
      showSaveAddress: boolean;
      saveAddressName: string;
    }
  | { kind: "token-picker" }
  | { kind: "saved-addresses" }
  | { kind: "edit-contacts" }
  | {
      kind: "review";
      recipient: string;
      amountAtomic: string;
      amountDisplay: string;
      estimate: TransferFeeQuote;
      submitting: boolean;
      error?: string;
    }
  | { kind: "success"; txId: string; recipient: string; amountAtomic: string };

export const INITIAL_STEP: Extract<Step, { kind: "compose" }> = {
  kind: "compose",
  recipient: "",
  amountDisplay: "",
  submitting: false,
  showSaveAddress: false,
  saveAddressName: "",
};
