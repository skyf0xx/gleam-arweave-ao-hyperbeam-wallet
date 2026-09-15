import { AO_TOKEN } from "@gleam/core";

/**
 * The two tokens the Tokens tab always renders, regardless of what the
 * wallet's actual balance data contains (PRD: "AR and AO are treated as
 * two default tokens that always appear..."). Consumed by the layer that
 * merges these against `useBalances()`'s `WalletBalances` shape to build
 * the Tokens tab's row list — this module owns only the identity/display
 * constants, not the merge logic itself.
 *
 * The AO process ID is sourced from `@gleam/core`'s
 * `DEFAULT_TOKEN_REGISTRY` (`packages/core/src/pricing/token-sources.ts`)
 * — the single place that id is defined — rather than redefined here.
 */

export const DEFAULT_AO_PROCESS_ID = AO_TOKEN.processId as string;

export type DefaultTokenId = "AR" | "AO";

export interface DefaultTokenIdentity {
  id: DefaultTokenId;
  /** Display ticker shown in the token row. */
  ticker: string;
  /** Display name shown in the token row. */
  name: string;
  /**
   * `null` for AR — it is not an AO process-held token and has no
   * `processId` to match against `TokenBalance` entries. Present for AO
   * so a consuming layer can match `TokenBalance.processId ===
   * processId` against the live balance list.
   */
  processId: string | null;
  /**
   * The displayed amount to show before any real balance has resolved,
   * or when the wallet has no recorded balance for this token — always
   * the string `"0"`, per RELEVANT RULES, never `null`/`undefined`/
   * omitted.
   */
  defaultDisplayAmount: "0";
}

export const DEFAULT_AR_TOKEN: DefaultTokenIdentity = {
  id: "AR",
  ticker: "AR",
  name: "Arweave",
  processId: null,
  defaultDisplayAmount: "0",
};

export const DEFAULT_AO_TOKEN: DefaultTokenIdentity = {
  id: "AO",
  ticker: "AO",
  name: "AO",
  processId: DEFAULT_AO_PROCESS_ID,
  defaultDisplayAmount: "0",
};

/**
 * Ordered as the Tokens tab renders them: AR first, then AO, both ahead
 * of any additional watched AO tokens (RELEVANT RULES/ACCEPTANCE-3).
 */
export const DEFAULT_TOKENS: readonly DefaultTokenIdentity[] = [DEFAULT_AR_TOKEN, DEFAULT_AO_TOKEN];
