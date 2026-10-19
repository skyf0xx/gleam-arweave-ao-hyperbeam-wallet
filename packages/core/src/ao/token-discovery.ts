import { AO_MU_SIGNERS } from "../arweave/graphql";
import { tokenMetadataFromTags } from "../arweave/token-metadata";
import type { TokenMetadata } from "../models/token-metadata";
import { createAssetScanner, withRequestTimeout } from "./asset-scan";

export interface DiscoverTokensOptions {
  address: string;
  gatewayUrl: string;
  fetchImpl?: typeof fetch;
  /** Pages (100 each) read per source. */
  maxPages?: number;
  /** Distinct processes kept, newest first. */
  maxCandidates?: number;
  concurrency?: number;
  budgetMs?: number;
}

const DEFAULTS = { maxPages: 2, maxCandidates: 50, concurrency: 4, budgetMs: 20_000 };
const DESCRIPTOR_BUDGET_MS = 15_000;

/**
 * The fungible tokens `address` has on-chain history with, from the
 * gateway alone (no balance reads):
 *
 * - `arweave-scheduler@1.0` tokens: L1 transfers naming `address` as
 *   recipient, market orders it placed, and tokens it was the initial
 *   holder of. Each candidate's spawn tags must classify it as a fungible
 *   `token@1.0` process, so collectibles and unrelated processes drop out.
 * - Legacy tokens: the `From-Process` of every `Credit-Notice` an
 *   `AO_MU_SIGNERS` wallet pushed to `address`. The MU signature only
 *   proves some process emitted the notice, not that it is a real token:
 *   the MU forwards whatever a process sends.
 *
 * Nothing here is trusted. Ticker, name, denomination and balance all
 * come from the process itself, so anyone can spawn one that credits
 * this wallet and calls itself "USDC". Callers show results as
 * unverified, never price them, and drop any that impersonate a
 * registry token.
 *
 * Returns spawn-tag metadata for each, so the caller can cache it. A
 * legacy token's ticker and denomination are usually set in Lua rather
 * than tagged, so they may still be `null` here. Whether the wallet still
 * holds anything is the caller's balance read to decide. Throws when the
 * gateway can't be queried at all.
 */
export async function discoverTokens(options: DiscoverTokensOptions): Promise<TokenMetadata[]> {
  const { address, gatewayUrl } = options;
  const maxCandidates = options.maxCandidates ?? DEFAULTS.maxCandidates;
  const scanner = (budgetMs: number) =>
    createAssetScanner({
      gatewayUrl,
      fetchImpl: withRequestTimeout(options.fetchImpl ?? fetch),
      maxPages: options.maxPages ?? DEFAULTS.maxPages,
      concurrency: options.concurrency ?? DEFAULTS.concurrency,
      deadline: Date.now() + budgetMs,
      describe: (gw, detail) => `Token lookup against "${gw}" failed: ${detail}`,
    });
  const { scan } = scanner(options.budgetMs ?? DEFAULTS.budgetMs);

  const settled = await Promise.allSettled([
    scan(
      {
        tags: [
          { name: "action", values: ["transfer"] },
          { name: "recipient", values: [address] },
        ],
      },
      (node) => node.recipient,
    ),
    scan({ tags: [{ name: "action", values: ["register-interest", "make-offer"] }], owners: [address] }, (node) => node.recipient),
    scan({ tags: [{ name: "initial-holder", values: [address] }] }),
    scan(
      {
        tags: [
          { name: "Data-Protocol", values: ["ao"] },
          { name: "Action", values: ["Credit-Notice"] },
        ],
        owners: [...AO_MU_SIGNERS],
        recipients: [address],
      },
      // Checked again: a gateway that ignored `owners` would let a
      // notice no MU signed through.
      (node) =>
        node.owner && AO_MU_SIGNERS.includes(node.owner.address)
          ? node.tags.find((tag) => tag.name === "From-Process")?.value
          : null,
    ),
  ]);
  if (settled.every((result) => result.status === "rejected")) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  const [hyperbeam, market, initial, legacy] = settled.map((result) => (result.status === "fulfilled" ? result.value : []));
  const legacyIds = new Set(legacy);
  const candidates = [...new Set([...(hyperbeam ?? []), ...(market ?? []), ...(initial ?? []), ...legacyIds])].slice(
    0,
    maxCandidates,
  );
  if (candidates.length === 0) return [];

  // Its own budget: a slow Credit-Notice scan (arweave.net can take
  // 15s+) must not leave the candidates it did find unclassified.
  const descriptors = await scanner(DESCRIPTOR_BUDGET_MS).fetchTags(candidates);
  const found: TokenMetadata[] = [];
  for (const id of candidates) {
    const tags = descriptors.get(id);
    if (!tags) continue;
    const metadata = tokenMetadataFromTags(id, tags);
    const fungibleHyperBeam = metadata.transport === "l1" && metadata.assetClass === "fungible";
    const legacyToken = metadata.transport === "mu" && legacyIds.has(id);
    if (fungibleHyperBeam || legacyToken) found.push(metadata);
  }
  return found;
}
