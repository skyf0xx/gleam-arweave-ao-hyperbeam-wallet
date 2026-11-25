import { estimateL1TransferFee } from "@gleam/core/src/ao/l1-transfer.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { impersonatesRegisteredToken, isRegisteredProcessId } from "@gleam/core/src/pricing/index.ts";
import type { Winston } from "@gleam/core";
import type { ReadsHandler } from "./handlers/reads";
import type { TokenPreview } from "./handlers/provider";
import { withFallbackAfter } from "./guards";

/**
 * A hung HyperBEAM peer (or gateway metadata lookup) must not delay opening
 * a `transferAoTokens` approval — the user is waiting on a signing prompt,
 * not a balance read. Races `ReadsHandler.previewWatchedToken` against this
 * timeout, resolving to "unresolved" either way rather than ever rejecting.
 */
const TOKEN_METADATA_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Longer than the metadata budget: an L1 send with no quote is refused, and a
 * cold token lookup can spend `core/ao/token-state.ts`'s 8s reading a logo.
 */
const TOKEN_FEE_QUOTE_TIMEOUT_MS = 10_000;

type TokenReads = Pick<ReadsHandler, "previewWatchedToken" | "tokenTransport" | "getNetworkSettings">;

/** What an approval's preview shows about a token, read with a bounded wait. */
export function createTokenPreview(reads: TokenReads) {
  async function resolveTokenDenominationAndTicker(
    address: string,
    processId: string,
  ): Promise<{ tokenDenomination: number | null; tokenTicker: string | null; tokenImpersonating?: true }> {
    const { tokenDenomination, tokenTicker, impersonating } = await resolveTokenPreview(address, processId);
    return { tokenDenomination, tokenTicker, ...(impersonating ? { tokenImpersonating: true as const } : {}) };
  }

  /**
   * As `resolveTokenDenominationAndTicker`, whether the process is a
   * collectible rather than a token, and whether it copies a registered
   * token's ticker or name.
   */
  async function resolveTokenPreview(
    address: string,
    processId: string,
  ): Promise<TokenPreview> {
    const UNRESOLVED: TokenPreview = { tokenDenomination: null, tokenTicker: null, collectible: false, impersonating: false };
    const lookup = reads
      .previewWatchedToken({ address, processId })
      .then((balance) =>
        balance.available === false
          ? UNRESOLVED
          : {
              tokenDenomination: balance.denomination,
              tokenTicker: balance.ticker,
              collectible: false,
              // As `addWatchedToken` refuses: a process may name itself anything.
              impersonating:
                !isRegisteredProcessId(processId) &&
                impersonatesRegisteredToken({ ticker: balance.ticker, name: balance.name }),
            },
      )
      .catch((error: unknown) =>
        error instanceof Error && error.message === userErrorMessage("tokenIsCollectible")
          ? { ...UNRESOLVED, collectible: true }
          : UNRESOLVED,
      );
    return withFallbackAfter(lookup, TOKEN_METADATA_LOOKUP_TIMEOUT_MS, UNRESOLVED);
  }

  /**
   * The AR reward a dApp's token transfer pays, for the preview: `null` for
   * a token on the MU, which has none. A lookup that fails or hangs also
   * gives `null`, and an L1 send then refuses for want of an approved fee.
   */
  async function quoteTokenTransferFee(processId: string): Promise<Winston | null> {
    const lookup = (async () => {
      if ((await reads.tokenTransport({ processId })) !== "l1") return null;
      const { gatewayUrl } = await reads.getNetworkSettings();
      return estimateL1TransferFee(gatewayUrl, processId);
    })().catch(() => null);
    return withFallbackAfter(lookup, TOKEN_FEE_QUOTE_TIMEOUT_MS, null);
  }

  return { resolveTokenDenominationAndTicker, resolveTokenPreview, quoteTokenTransferFee };
}
