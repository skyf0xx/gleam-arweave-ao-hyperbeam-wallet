import Arweave from "arweave";
import type { JWKInterface } from "../models/wallet";
import type { Winston } from "../models/balance";

/**
 * Interface-boundary judgment call (flagged per this task's packet):
 * building/signing/submitting an AR transfer needs the *decrypted* JWK,
 * but `wallet-lifecycle.ts` (the `onboarding-unlock` layer, already
 * built) deliberately never persists derived key material anywhere —
 * `unlockWallet` decrypts each wallet's envelope once to verify the
 * password, then discards the key, and documents that "every subsequent
 * call that needs signing key material... re-derives from the password,
 * which is never itself persisted anywhere." That decision was made
 * before this layer existed, so this module's public functions accept an
 * already-decrypted `JWKInterface` as a parameter rather than a
 * password or a wallet id — they never decrypt anything themselves, and
 * never import `core/vault`.
 *
 * This keeps `core/arweave` agnostic about *how* the caller obtained
 * signing material: today that's `handlers/transfer.ts` calling
 * `decryptFromEnvelope` with a password carried on the request (see that
 * handler's own doc comment for how the password reaches it, given
 * `ProtocolMap`'s `submitTransfer(req: TransferDraft)` has no password
 * field and is locked outside this layer's scope). A future signing
 * capability (hardware wallet, WebAuthn-gated key) could satisfy the same
 * `JWKInterface`-shaped parameter without this module changing.
 *
 * No `fetchImpl` injection point here (unlike `balance.ts`/`graphql.ts`):
 * `arweave-js`'s internal `Api` class always calls the ambient `fetch`
 * directly with no override hook, so tests for this module mock
 * `globalThis.fetch` instead of passing a parameter — a real difference
 * worth calling out rather than declaring a parameter that would do
 * nothing.
 */
export interface FeeQuote {
  fee: Winston;
}

/**
 * Reads a fee quote for a plain AR value transfer, via the gateway's
 * `price` endpoint (byte size 0 — the transaction carries no data). Pure
 * network read, no signing.
 *
 * `recipient` is optional, but omitting it underquotes: the gateway adds
 * a new-wallet fee once a target is known and isn't yet in the wallet
 * list, so a recipient-less quote can be lower than the real one.
 */
export async function estimateFee(gatewayUrl: string, recipient?: string): Promise<FeeQuote> {
  const client = buildClient(gatewayUrl);
  const fee = await client.transactions.getPrice(0, recipient);
  return { fee };
}

export interface SubmittedTransfer {
  txId: string;
}

/**
 * Builds, signs, and posts an AR value-transfer transaction. Requires the
 * caller to supply an already-decrypted `jwk` — see this module's doc
 * comment for why that boundary was chosen.
 */
export async function submitTransfer(
  gatewayUrl: string,
  jwk: JWKInterface,
  recipient: string,
  amount: Winston,
): Promise<SubmittedTransfer> {
  const client = buildClient(gatewayUrl);

  const transaction = await client.createTransaction(
    { target: recipient, quantity: amount },
    jwk,
  );
  await client.transactions.sign(transaction, jwk);

  const response = await client.transactions.post(transaction);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Failed to submit transfer to ${gatewayUrl} (HTTP ${response.status}: ${response.statusText}).`,
    );
  }

  return { txId: transaction.id };
}

function buildClient(gatewayUrl: string) {
  const url = new URL(gatewayUrl);
  return Arweave.init({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    protocol: url.protocol.replace(":", ""),
  });
}
