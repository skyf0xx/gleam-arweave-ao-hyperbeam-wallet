import Arweave from "arweave";
import { ArweaveSigner, createData } from "@dha-team/arbundles/web";
import type { JWKInterface } from "../models/wallet";
import type {
  SignTransactionInput,
  SignedTransaction,
  DataItemInput,
  DispatchResult,
} from "../models/signing";
import { postDataItemToBundler } from "../arweave/upload";
import { base64ToBytes } from "./base64";

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

type Transaction = Awaited<ReturnType<Arweave["createTransaction"]>>;

async function buildTransaction(
  client: Arweave,
  jwk: JWKInterface,
  input: SignTransactionInput,
  data: Uint8Array,
): Promise<Transaction> {
  const transaction = await client.createTransaction(
    {
      data,
      target: input.target ?? "",
      quantity: input.quantity ?? "0",
      reward: input.reward,
      last_tx: input.last_tx,
    },
    jwk,
  );
  for (const tag of input.tags ?? []) {
    transaction.addTag(tag.name, tag.value);
  }
  return transaction;
}

/**
 * Signs the dApp's transaction without posting it. `gatewayUrl` is only
 * used to fetch `last_tx` and `reward` when the dApp left them out.
 */
export async function signTransaction(
  gatewayUrl: string,
  jwk: JWKInterface,
  input: SignTransactionInput,
): Promise<SignedTransaction> {
  const client = buildClient(gatewayUrl);
  const data = input.data ? base64ToBytes(input.data) : new Uint8Array(0);
  const transaction = await buildTransaction(client, jwk, input, data);
  await client.transactions.sign(transaction, jwk);

  return {
    format: transaction.format,
    id: transaction.id,
    last_tx: transaction.last_tx,
    owner: transaction.owner,
    tags: transaction.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    target: transaction.target,
    quantity: transaction.quantity,
    data_size: transaction.data_size,
    data_root: transaction.data_root,
    reward: transaction.reward,
    signature: transaction.signature,
  };
}

/**
 * Signs a transaction and submits it. Payloads over
 * `DISPATCH_BUNDLE_THRESHOLD_BYTES` are signed as an ANS-104 data item and
 * posted to `bundlerUrl` (`BUNDLED`); smaller ones are posted to the
 * gateway as a base transaction (`BASE`). Throws if either post is
 * rejected, so the dApp never gets an id for data that wasn't stored.
 */
export async function dispatchTransaction(
  gatewayUrl: string,
  bundlerUrl: string,
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
    await postDataItemToBundler(bundlerUrl, new Uint8Array(dataItem.getRaw()));
    return { id: dataItem.id, type: "BUNDLED" };
  }

  const client = buildClient(gatewayUrl);
  const transaction = await buildTransaction(client, jwk, input, payloadBytes);
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
 * Signs one ANS-104 data item and returns its raw bytes. `input.data` is
 * standard base64 and tags are plain text.
 */
export async function signDataItem(jwk: JWKInterface, input: DataItemInput): Promise<Uint8Array<ArrayBuffer>> {
  const signer = new ArweaveSigner(jwk);
  const dataItem = createData(base64ToBytes(input.data), signer, {
    tags: input.tags?.map((tag) => ({ name: tag.name, value: tag.value })),
    target: input.target,
    anchor: input.anchor,
  });
  await dataItem.sign(signer);
  return new Uint8Array(dataItem.getRaw());
}

/** Signs each item in order with the same key. */
export async function batchSignDataItem(
  jwk: JWKInterface,
  inputs: DataItemInput[],
): Promise<Array<Uint8Array<ArrayBuffer>>> {
  const results: Array<Uint8Array<ArrayBuffer>> = [];
  for (const input of inputs) {
    results.push(await signDataItem(jwk, input));
  }
  return results;
}
