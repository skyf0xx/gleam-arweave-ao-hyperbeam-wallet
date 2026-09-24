/**
 * A Winston atomic-integer amount, always carried as a string. Never
 * converted to a floating-point number at any layer.
 */
export type Winston = string;

/** An AR balance (Winston units) for a given address. Not persisted. */
export interface Balance {
  address: string;
  winston: Winston;
}

/** An AO token balance for a given address, read via a HyperBEAM `process@1.0` read. */
export interface TokenBalance {
  address: string;
  processId: string;
  ticker: string;
  denomination: number;
  /** The token's display name, or `null` if it couldn't be resolved (an unregistered token whose spawn tags carried no name). */
  name: string | null;
  /** Atomic integer string in the token's own smallest unit. */
  quantity: string;
}
