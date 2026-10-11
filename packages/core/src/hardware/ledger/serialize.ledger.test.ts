import { describe, expect, it } from "vitest";
import { clientForGateway } from "../../arweave/client";
import { buildUnsignedTransaction, type ArweaveTransactionJson } from "../../arweave/transaction";
import { bytesToBase64Url } from "../../vault/base64";
import { LedgerError } from "./errors";
import { encodeTransactionForLedger, LEDGER_CHUNK_SIZE, ledgerChunks } from "./serialize";

const GATEWAY = "https://arweave.net";
const OWNER = bytesToBase64Url(new Uint8Array(512).map((_, index) => (index * 7 + 3) & 0xff));
const TARGET = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";
const LAST_TX = "b".repeat(64);
const utf8 = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

type Transaction = ReturnType<ReturnType<typeof clientForGateway>["transactions"]["fromRaw"]>;

/**
 * Zondax's `ArweaveApp.encodeTx` and `prepareChunks` from
 * `@zondax/ledger-arweave` (js/src/index.js), ported line for line onto
 * an arweave-js `Transaction`, the object that library is handed. Its
 * chunk size is 250; the device accepts any size up to 255.
 */
const zondax = {
  encodeu16: (value: number) => new Uint8Array([value >> 8, value & 0xff]),
  concatArray(a: Uint8Array, b: Uint8Array) {
    const tmp = new Uint8Array(a.length + b.length);
    tmp.set(a);
    tmp.set(b, a.length);
    return tmp;
  },
  encodeWithLen: (input: Uint8Array) => zondax.concatArray(zondax.encodeu16(input.length), input),
  flatten: (input: Uint8Array[]) => input.reduce((blob, part) => zondax.concatArray(blob, part), new Uint8Array(0)),
  stringToBuffer: (text: string) => utf8(text),
  encodeTx(tx: Transaction) {
    const serializedTags: Uint8Array[] = [];
    for (const currentTag of tx.tags) {
      serializedTags.push(zondax.encodeWithLen(currentTag.get("name", { decode: true, string: false })));
      serializedTags.push(zondax.encodeWithLen(currentTag.get("value", { decode: true, string: false })));
    }
    return zondax.flatten([
      zondax.encodeWithLen(zondax.stringToBuffer(tx.format.toString())),
      zondax.encodeWithLen(tx.get("owner", { decode: true, string: false })),
      zondax.encodeWithLen(tx.get("target", { decode: true, string: false })),
      zondax.encodeWithLen(zondax.stringToBuffer(tx.quantity.toString())),
      zondax.encodeWithLen(zondax.stringToBuffer(tx.reward.toString())),
      zondax.encodeWithLen(tx.get("last_tx", { decode: true, string: false })),
      zondax.encodeu16(tx.tags.length),
      zondax.flatten(serializedTags),
      zondax.encodeWithLen(zondax.stringToBuffer(tx.data_size.toString())),
      zondax.encodeWithLen(tx.get("data_root", { decode: true, string: false })),
    ]);
  },
  prepareChunks(tx: Transaction, chunkSize = 250) {
    const chunks: Uint8Array[] = [new Uint8Array(20)];
    const buffer = zondax.encodeTx(tx);
    for (let i = 0; i < buffer.length; i += chunkSize) chunks.push(buffer.subarray(i, i + chunkSize));
    return chunks;
  },
};

function toArweaveJs(json: ArweaveTransactionJson): Transaction {
  return clientForGateway(GATEWAY).transactions.fromRaw({ ...json, tags: json.tags.map((tag) => ({ ...tag })) });
}

const CASES: Array<[string, Parameters<typeof buildUnsignedTransaction>[2], Array<{ name: string; value: string }>]> = [
  ["AR transfer, no data, no tags", { target: TARGET, quantity: "1000000000000", reward: "5000", last_tx: LAST_TX }, []],
  [
    "data, tags with non-ASCII",
    { data: utf8("hello from a dApp"), target: "", quantity: "0", reward: "123456", last_tx: LAST_TX },
    [
      { name: "Content-Type", value: "text/plain" },
      { name: "App-Name", value: "Gleam ✓" },
    ],
  ],
  [
    "16 tags, multi-chunk data",
    { data: new Uint8Array(300 * 1024).fill(9), target: TARGET, quantity: "42", reward: "1", last_tx: LAST_TX },
    Array.from({ length: 16 }, (_, index) => ({ name: `Tag-${index}`, value: "v".repeat(index * 20) })),
  ],
];

describe("encodeTransactionForLedger", () => {
  it.each(CASES)("matches Zondax's encodeTx byte for byte (%s)", async (_, attributes, tags) => {
    const json = await buildUnsignedTransaction(GATEWAY, OWNER, attributes, tags);
    const ours = encodeTransactionForLedger(json);

    expect(Buffer.from(ours).toString("hex")).toBe(Buffer.from(zondax.encodeTx(toArweaveJs(json))).toString("hex"));
  });

  it.each(CASES)("reassembles to Zondax's chunk stream after the unused path slot (%s)", async (_, attributes, tags) => {
    const json = await buildUnsignedTransaction(GATEWAY, OWNER, attributes, tags);
    const ours = ledgerChunks(new Uint8Array(20), encodeTransactionForLedger(json));
    const theirs = zondax.prepareChunks(toArweaveJs(json), LEDGER_CHUNK_SIZE);

    expect(ours.map((chunk) => Buffer.from(chunk).toString("hex"))).toEqual(
      theirs.map((chunk) => Buffer.from(chunk).toString("hex")),
    );
  });

  it("lays out the fields the device parser expects", async () => {
    const json = await buildUnsignedTransaction(GATEWAY, OWNER, { target: TARGET, quantity: "7", reward: "99", last_tx: LAST_TX }, [
      { name: "A", value: "bc" },
    ]);
    const bytes = encodeTransactionForLedger(json);

    expect([...bytes.subarray(0, 3)]).toEqual([0, 1, 0x32]); // "2"
    expect([...bytes.subarray(3, 5)]).toEqual([0x02, 0x00]); // owner: 512
    expect([...bytes.subarray(517, 519)]).toEqual([0, 32]); // target: 32
    expect([...bytes.subarray(551, 554)]).toEqual([0, 1, 0x37]); // quantity "7"
    expect([...bytes.subarray(554, 558)]).toEqual([0, 2, 0x39, 0x39]); // reward "99"
    expect([...bytes.subarray(558, 560)]).toEqual([0, 48]); // last_tx: 48
    expect([...bytes.subarray(608, 618)]).toEqual([0, 1, 0, 1, 0x41, 0, 2, 0x62, 0x63, 0]); // 1 tag, then data_size's length
    expect([...bytes.subarray(617, 622)]).toEqual([0, 1, 0x30, 0, 0]); // data_size "0", empty data_root
    expect(bytes.byteLength).toBe(622);
  });

  it("refuses a field longer than its u16 length prefix", async () => {
    const json = await buildUnsignedTransaction(GATEWAY, OWNER, { target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX });
    const huge = { ...json, tags: [{ name: bytesToBase64Url(utf8("N")), value: bytesToBase64Url(new Uint8Array(70_000)) }] };

    expect(() => encodeTransactionForLedger(huge)).toThrow(LedgerError);
  });
});

describe("ledgerChunks", () => {
  const sizes = (chunks: Uint8Array[]) => chunks.map((chunk) => chunk.byteLength);

  it("splits exactly 200 bytes into one chunk", () => {
    expect(sizes(ledgerChunks(new Uint8Array(20), new Uint8Array(200)))).toEqual([20, 200]);
  });

  it("splits 201 bytes into 200 + 1", () => {
    expect(sizes(ledgerChunks(new Uint8Array(), new Uint8Array(201)))).toEqual([0, 200, 1]);
  });

  it("still sends one (empty) final chunk for an empty payload", () => {
    expect(sizes(ledgerChunks(new Uint8Array(), new Uint8Array()))).toEqual([0, 0]);
  });

  it("keeps the payload's bytes in order", () => {
    const payload = Uint8Array.from({ length: 450 }, (_, index) => index & 0xff);
    const chunks = ledgerChunks(new Uint8Array(), payload);

    expect(sizes(chunks)).toEqual([0, 200, 200, 50]);
    expect(Buffer.concat(chunks.slice(1)).equals(Buffer.from(payload))).toBe(true);
  });
});
