/**
 * The good moment a store review prompt follows: a confirmed send or
 * upload, a connected hardware wallet, or a couple of weeks of use.
 */
export type ReviewMoment =
  | { kind: "send" }
  | { kind: "upload" }
  | { kind: "hardware"; device: "Ledger" | "Keystone" }
  | { kind: "settled" };
