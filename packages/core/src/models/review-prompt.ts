/**
 * The good moment a store review prompt follows: a confirmed send, a
 * connected hardware wallet, or a couple of weeks of use.
 */
export type ReviewMoment =
  | { kind: "send" }
  | { kind: "hardware"; device: "Ledger" | "Keystone" }
  | { kind: "settled" };
