import type { TokenBalance } from "../models/balance";

/**
 * Reads an AO token balance via the HyperBEAM `process@1.0` compute path:
 * `GET /{processId}~process@1.0/compute/balances/{address}` per
 * ARCHITECTURE.md §0.2's exact endpoint form and CLAUDE.md's spec.
 *
 * ARCHITECTURE.md §0.2/§7.3 flags this as an *unverified* spike: whether
 * `compute/` or `now/` is the correct key on `~process@1.0` for a balance
 * read was still an open question as of that doc, to be resolved when
 * this feature was actually built — i.e. now. This implementation uses
 * `compute/` because that's the form CLAUDE.md's spec and this task's
 * packet both name as authoritative; the `now/` alternative was never
 * independently spiked against a live HyperBEAM node in this build (no
 * live node was reachable from this environment). If `compute/` turns
 * out wrong against a real peer, the fix is a second implementation path
 * behind the same `getTokenBalance` signature, not a redesign — see this
 * task's final report.
 *
 * Pure: no `chrome.*`/window/document dependency, explicit `peerUrl` and
 * injectable `fetchImpl`.
 */
export async function getTokenBalance(
  processId: string,
  address: string,
  peerUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenBalance> {
  const url = `${trimTrailingSlash(peerUrl)}/${processId}~process@1.0/compute/balances/${address}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(
      `Failed to read AO token balance for "${address}" on process "${processId}" from ${peerUrl} (HTTP ${response.status}).`,
    );
  }

  const body = await response.json();
  return parseBalanceResponse(body, processId, address);
}

/**
 * The compute/balances response shape is unverified against a live peer
 * (see this module's doc comment) — this parser accepts the two
 * plausible shapes named in ARCHITECTURE.md's open question (a bare
 * quantity string/number, or an object carrying `balance`/`ticker`/
 * `denomination`) and fails loudly on anything else rather than guessing.
 *
 * Live verification against a real HyperBEAM node (state.forward.computer)
 * confirmed `compute/balances/{address}` returns a bare atomic quantity
 * string with no denomination field, and that `now/denomination` is not
 * reachable to look it up separately. The bare-quantity shapes are only
 * ever returned for the AO token in practice, so they default to AO's
 * known denomination (12) rather than 0 — defaulting to 0 rendered every
 * balance as an undivided atomic integer (e.g. "500100000000" instead of
 * "0.5001").
 */
const AO_TOKEN_DENOMINATION = 12;

function parseBalanceResponse(
  body: unknown,
  processId: string,
  address: string,
): TokenBalance {
  if (typeof body === "string" && /^\d+$/.test(body)) {
    return {
      address,
      processId,
      ticker: processId,
      denomination: AO_TOKEN_DENOMINATION,
      name: null,
      quantity: body,
    };
  }

  if (typeof body === "number" && Number.isInteger(body)) {
    return {
      address,
      processId,
      ticker: processId,
      denomination: AO_TOKEN_DENOMINATION,
      name: null,
      quantity: String(body),
    };
  }

  if (body !== null && typeof body === "object") {
    const candidate = body as Record<string, unknown>;
    const rawQuantity = candidate.balance ?? candidate.quantity;
    const quantity =
      typeof rawQuantity === "string"
        ? rawQuantity
        : typeof rawQuantity === "number"
          ? String(rawQuantity)
          : undefined;

    if (quantity !== undefined && /^\d+$/.test(quantity)) {
      return {
        address,
        processId,
        ticker: typeof candidate.ticker === "string" ? candidate.ticker : processId,
        denomination:
          typeof candidate.denomination === "number"
            ? candidate.denomination
            : AO_TOKEN_DENOMINATION,
        name: typeof candidate.name === "string" ? candidate.name : null,
        quantity,
      };
    }
  }

  throw new Error(
    `Unrecognized AO balance response shape for process "${processId}", address "${address}": ${JSON.stringify(body)}`,
  );
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
