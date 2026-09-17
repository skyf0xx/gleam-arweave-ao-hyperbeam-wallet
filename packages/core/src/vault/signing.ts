import Arweave from "arweave";
import { ArweaveSigner, createData } from "@dha-team/arbundles/web";
import type { JWKInterface } from "../models/wallet";
import type {
  SignTransactionInput,
  SignedTransaction,
  DataItemInput,
  DispatchResult,
} from "../models/signing";
import { base64ToBytes, bytesToBase64 } from "./base64";

/**
 * `core/vault`'s share of the provider-signing-crypto intent: the actual
 * cryptographic operations behind `sign`/`dispatch`/`signDataItem`/
 * `batchSignDataItem`. Mirrors `core/arweave/transfer.ts` and
 * `core/arweave/upload.ts`'s established boundary exactly — every
 * function here accepts an already-decrypted `JWKInterface` and never
 * imports `core/vault`'s own envelope decryption or touches storage;
 * resolving that JWK from the unlocked-session cache
 * (`getCachedKey(walletId)`) is the later `provider-bridge` dispatch
 * layer's job, per this task's packet.
 *
 * Imports `@dha-team/arbundles/web` (not the package root) for the same
 * reason `upload.ts` documents: the Node entry pulls in an undeclared
 * `axios` dependency via its streamed-file helpers.
 */

/** Threshold (bytes) above which `dispatch()` bundles rather than posts as a base AR tx — mirrors `upload.ts`'s own bundler-first convention for arbitrary payload data, since a `BASE` tx would otherwise require on-chain fee/reward computation this layer doesn't own. Below the threshold, dispatch posts directly to the gateway as a `BASE` transaction. */
const DISPATCH_BUNDLE_THRESHOLD_BYTES = 100 * 1024;

function buildClient(gatewayUrl: string): Arweave {
  const url = new URL(gatewayUrl);
  return Arweave.init({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    protocol: url.protocol.replace(":", ""),
  });
}

/**
 * Signs a raw Arweave transaction shape via arweave-js's own
 * `createTransaction`/`transactions.sign`, without posting it anywhere.
 * `gatewayUrl` is required only because `arweave-js`'s `createTransaction`
 * needs a client to compute `last_tx`/reward defaults when the caller
 * doesn't supply them — no network write happens here.
 */
export async function signTransaction(
  gatewayUrl: string,
  jwk: JWKInterface,
  input: SignTransactionInput,
): Promise<SignedTransaction> {
  const client = buildClient(gatewayUrl);

  const transaction = await client.createTransaction(
    {
      data: input.data ? base64ToBytes(input.data) : undefined,
      target: input.target ?? "",
      quantity: input.quantity ?? "0",
      reward: input.reward,
      last_tx: input.last_tx,
    },
    jwk,
  );

  if (input.tags) {
    for (const tag of input.tags) {
      transaction.addTag(tag.name, tag.value);
    }
  }

  await client.transactions.sign(transaction, jwk);

  return {
    ...input,
    id: transaction.id,
    owner: transaction.owner,
    signature: transaction.signature,
  };
}

/**
 * Signs a transaction and, depending on payload size, either posts it as
 * a base Arweave transaction (`BASE`) or wraps it as an ANS-104 DataItem
 * and returns its locally-computed id (`BUNDLED`) — see
 * `DISPATCH_BUNDLE_THRESHOLD_BYTES`'s doc comment for why. A `BUNDLED`
 * dispatch is signed but **not submitted to a bundler endpoint here**:
 * this layer owns crypto, not network submission policy or bundler-URL
 * configuration, which belongs to the caller (the same boundary
 * `submitUploadToBundler` draws around bundler endpoints). Callers that
 * need the bundled item actually posted should pass the returned item's
 * bytes through `core/arweave/upload.ts`'s bundler submission path.
 */
export async function dispatchTransaction(
  gatewayUrl: string,
  jwk: JWKInterface,
  input: SignTransactionInput,
): Promise<DispatchResult> {
  const payloadBytes = input.data ? base64ToBytes(input.data) : new Uint8Array(0);

  if (payloadBytes.byteLength > DISPATCH_BUNDLE_THRESHOLD_BYTES) {
    const signer = new ArweaveSigner(jwk);
    const dataItem = createData(payloadBytes, signer, {
      tags: input.tags?.map((tag) => ({ name: tag.name, value: tag.value })),
      target: input.target,
    });
    await dataItem.sign(signer);
    return { id: dataItem.id, type: "BUNDLED" };
  }

  const client = buildClient(gatewayUrl);
  const transaction = await client.createTransaction(
    {
      data: payloadBytes,
      target: input.target ?? "",
      quantity: input.quantity ?? "0",
      reward: input.reward,
      last_tx: input.last_tx,
    },
    jwk,
  );

  if (input.tags) {
    for (const tag of input.tags) {
      transaction.addTag(tag.name, tag.value);
    }
  }

  await client.transactions.sign(transaction, jwk);

  const response = await client.transactions.post(transaction);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Failed to dispatch transaction to ${gatewayUrl} (HTTP ${response.status}: ${response.statusText}).`,
    );
  }

  return { id: transaction.id, type: "BASE" };
}

/**
 * Signs a single ANS-104 DataItem via arbundles' `createData(...).sign(...)`,
 * returning its base64-encoded raw signed bytes (the wire-safe encoding
 * `signing.ts`'s `SignDataItemResult` pins).
 */
export async function signDataItem(jwk: JWKInterface, input: DataItemInput): Promise<string> {
  const signer = new ArweaveSigner(jwk);
  const dataBytes = base64ToBytes(input.data);

  const dataItem = createData(dataBytes, signer, {
    tags: input.tags?.map((tag) => ({ name: tag.name, value: tag.value })),
    target: input.target,
    anchor: input.anchor,
  });
  await dataItem.sign(signer);

  return bytesToBase64(new Uint8Array(dataItem.getRaw()));
}

/**
 * Signs multiple ANS-104 DataItems with the same JWK, in order, returning
 * one base64-encoded signed item per input — the `Buffer[]`-equivalent
 * shape `BatchSignDataItemResult` pins. Signs sequentially rather than via
 * `Promise.all`: arbundles' `ArweaveSigner` has no documented concurrency
 * guarantee, and sequential signing keeps this function's behavior
 * identical to calling `signDataItem` in a loop.
 */
export async function batchSignDataItem(
  jwk: JWKInterface,
  inputs: DataItemInput[],
): Promise<string[]> {
  const results: string[] = [];
  for (const input of inputs) {
    results.push(await signDataItem(jwk, input));
  }
  return results;
}
