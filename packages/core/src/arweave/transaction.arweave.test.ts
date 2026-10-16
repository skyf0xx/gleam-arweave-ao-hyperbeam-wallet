import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { signerFromJwk } from "../signer/keys";
import { generateJWK } from "../keys/jwk";
import type { JWKInterface } from "../models/wallet";
import { clientForGateway } from "./client";
import { signRsaPss } from "./rsa-pss";
import {
  applyTransactionSignature,
  buildUnsignedTransaction,
  signTransactionWithSigner,
  transactionSignatureData,
  verifyTransactionSignature,
  type ArweaveTransactionJson,
  type TransactionAttributes,
} from "./transaction";

const GATEWAY = "https://arweave.net";
const TARGET = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";
const LAST_TX = "b".repeat(64);
const arweave = clientForGateway(GATEWAY);

let jwk: JWKInterface;
let otherJwk: JWKInterface;

beforeAll(async () => {
  [jwk, otherJwk] = await Promise.all([generateJWK(), generateJWK()]);
}, 30_000);

afterEach(() => {
  vi.restoreAllMocks();
});

// Uint8Array.from: jsdom's TextEncoder returns another realm's array.
const utf8 = (text: string) => Uint8Array.from(new TextEncoder().encode(text));
const TAGS = [
  { name: "Content-Type", value: "text/plain" },
  { name: "App-Name", value: "Gleam ✓" },
];

const CASES: Array<[string, TransactionAttributes]> = [
  ["AR transfer", { target: TARGET, quantity: "1000", reward: "5000", last_tx: LAST_TX }],
  ["data with AR", { data: utf8("hello from a dApp"), target: TARGET, quantity: "42", reward: "5000", last_tx: LAST_TX }],
  ["data only, multi-chunk", { data: new Uint8Array(300 * 1024).fill(7), target: "", quantity: "0", reward: "1", last_tx: LAST_TX }],
];

/** The pre-split keyfile path: arweave-js builds with the JWK, then `transactions.sign`. */
async function arweaveJsReference(attributes: TransactionAttributes) {
  const transaction = await arweave.createTransaction({ ...attributes }, jwk);
  for (const tag of TAGS) transaction.addTag(tag.name, tag.value);
  return transaction;
}

function stripUndefined(value: object) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe("buildUnsignedTransaction", () => {
  it.each(CASES)("matches arweave-js's JWK-built transaction and deep hash from the owner alone (%s)", async (_, attributes) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const reference = await arweaveJsReference(attributes);
    const unsigned = await buildUnsignedTransaction(GATEWAY, jwk.n, { ...attributes }, TAGS);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(unsigned).toEqual(stripUndefined(reference.toJSON()));
    // What Keystone receives.
    expect(JSON.stringify(unsigned)).toBe(JSON.stringify(reference.toJSON()));
    expect(Buffer.from(await transactionSignatureData(unsigned)).equals(Buffer.from(await reference.getSignatureData()))).toBe(true);
  });

  it.each(CASES)("produces arweave-js's exact signed transaction given its signature (%s)", async (_, attributes) => {
    const reference = await arweaveJsReference(attributes);
    // The web build (what the extension bundles) signs with a 32-byte
    // salt; the Node build Vitest resolves defaults to the maximum.
    await arweave.transactions.sign(reference, jwk, { saltLength: 32 });
    const unsigned = await buildUnsignedTransaction(GATEWAY, jwk.n, { ...attributes }, TAGS);

    const { id, transaction } = await applyTransactionSignature(unsigned, reference.get("signature", { decode: true, string: false }), jwk.n);

    expect(id).toBe(reference.id);
    expect(JSON.stringify(transaction)).toBe(JSON.stringify(reference.toJSON()));
  });

  it("fetches the anchor and price exactly as arweave-js's JWK path does", async () => {
    const urls = async (run: () => Promise<unknown>) => {
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        return new Response(url.includes("tx_anchor") ? LAST_TX : "777", { status: 200 });
      });
      await run();
      const called = spy.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
      spy.mockRestore();
      return called;
    };

    const expected = await urls(() => arweave.createTransaction({ target: TARGET, quantity: "5" }, jwk));
    const actual = await urls(() => buildUnsignedTransaction(GATEWAY, jwk.n, { target: TARGET, quantity: "5" }));

    expect(actual).toEqual(expected);
    expect(actual.some((url) => url.includes(`price/0/${TARGET}`))).toBe(true);
  });
});

describe("keyfile signing", () => {
  it("signs a transaction arweave-js verifies", async () => {
    const unsigned = await buildUnsignedTransaction(GATEWAY, jwk.n, { ...CASES[1]![1] }, TAGS);
    const { transaction } = await applyTransactionSignature(unsigned, await signTransactionWithSigner(unsigned, signerFromJwk(jwk, "")), jwk.n);

    await expect(arweave.transactions.verify(arweave.transactions.fromRaw(transaction))).resolves.toBe(true);
  });

  it("refuses to sign a transaction owned by another key", async () => {
    const unsigned = await buildUnsignedTransaction(GATEWAY, otherJwk.n, { ...CASES[0]![1] });
    await expect(signTransactionWithSigner(unsigned, signerFromJwk(jwk, ""))).rejects.toThrow(/different owner/);
  });
});

describe("device signatures", () => {
  async function deviceSign(unsigned: ArweaveTransactionJson, key: JWKInterface) {
    return signRsaPss(signerFromJwk(key, ""), await transactionSignatureData(unsigned));
  }

  it("rejects a signature over any other field values", async () => {
    const unsigned = await buildUnsignedTransaction(GATEWAY, jwk.n, { ...CASES[0]![1] });
    const signature = await deviceSign(unsigned, jwk);

    expect(await verifyTransactionSignature(unsigned, signature, jwk.n)).toBe(true);
    expect(await verifyTransactionSignature({ ...unsigned, quantity: "1001" }, signature, jwk.n)).toBe(false);
    expect(await verifyTransactionSignature({ ...unsigned, target: LAST_TX.slice(0, 43) }, signature, jwk.n)).toBe(false);
    await expect(applyTransactionSignature({ ...unsigned, reward: "1" }, signature, jwk.n)).rejects.toThrow(/doesn't match/);
  });

  it("refuses a transaction built for and signed by another owner when applying for this one", async () => {
    const foreign = await buildUnsignedTransaction(GATEWAY, otherJwk.n, { ...CASES[0]![1] });
    const signature = await deviceSign(foreign, otherJwk);

    await expect(applyTransactionSignature(foreign, signature, otherJwk.n)).resolves.toBeDefined();
    await expect(applyTransactionSignature(foreign, signature, jwk.n)).rejects.toThrow(/doesn't match/);
  });

  it("rejects data that doesn't match the signed data_root", async () => {
    const unsigned = await buildUnsignedTransaction(GATEWAY, jwk.n, { ...CASES[1]![1] });
    const signature = await deviceSign(unsigned, jwk);
    const swapped = { ...unsigned, data: Buffer.from(utf8("hello from a dApq")).toString("base64url") };

    expect(await verifyTransactionSignature(swapped, signature, jwk.n)).toBe(false);
  });

  it("rejects another key's signature and a transaction naming another owner", async () => {
    const unsigned = await buildUnsignedTransaction(GATEWAY, jwk.n, { ...CASES[0]![1] });
    const foreign = await buildUnsignedTransaction(GATEWAY, otherJwk.n, { ...CASES[0]![1] });

    expect(await verifyTransactionSignature(unsigned, await deviceSign(foreign, otherJwk), jwk.n)).toBe(false);
    expect(await verifyTransactionSignature(foreign, await deviceSign(foreign, otherJwk), jwk.n)).toBe(false);
    expect(await verifyTransactionSignature(unsigned, new Uint8Array(512), jwk.n)).toBe(false);
  });
});
