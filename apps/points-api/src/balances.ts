import { getBalance } from "@gleam/core/src/arweave/balance.ts";
import { AO_TOKEN } from "@gleam/core/src/pricing/token-sources.ts";

export interface Balances {
  arAtomic: string;
  aoAtomic: string;
}

export type BalanceReader = (address: string) => Promise<Balances>;

export function createBalanceReader(config: {
  arweaveGatewayUrl: string;
  hyperbeamUrl: string;
  fetchImpl?: typeof fetch;
}): BalanceReader {
  const fetchImpl = config.fetchImpl ?? fetch;
  return async (address) => {
    const [arAtomic, aoAtomic] = await Promise.all([
      getBalance(address, config.arweaveGatewayUrl, fetchImpl),
      readAoBalance(address, config.hyperbeamUrl, fetchImpl),
    ]);
    return { arAtomic, aoAtomic };
  };
}

/**
 * HyperBEAM answers 404 for an address the AO token has never credited,
 * which core's `getTokenBalance` reports as an error. For a snapshot that
 * is a balance of 0.
 */
async function readAoBalance(address: string, hyperbeamUrl: string, fetchImpl: typeof fetch): Promise<string> {
  const url = `${hyperbeamUrl.replace(/\/$/, "")}/${AO_TOKEN.processId}~process@1.0/compute/balances/${address}`;
  const response = await fetchImpl(url);
  if (response.status === 404) return "0";
  if (!response.ok) throw new Error(`AO balance read for ${address} failed (HTTP ${response.status}).`);
  const body = (await response.text()).trim().replace(/^"|"$/g, "");
  if (!/^\d+$/.test(body)) throw new Error(`AO balance for ${address} isn't an integer: "${body.slice(0, 40)}".`);
  return body;
}
