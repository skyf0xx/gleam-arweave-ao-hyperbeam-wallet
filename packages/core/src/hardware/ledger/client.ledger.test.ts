import { beforeAll, describe, expect, it } from "vitest";
import { clientForGateway } from "../../arweave/client";
import { buildUnsignedDataItem, dataItemSignatureData } from "../../arweave/data-item";
import { sha256, signRsaPss } from "../../arweave/rsa-pss";
import { buildUnsignedTransaction, type ArweaveTransactionJson } from "../../arweave/transaction";
import { generateJWK } from "../../keys/jwk";
import type { JWKInterface } from "../../models/wallet";
import { base64UrlToBytes, bytesToBase64Url } from "../../vault/base64";
import { verifyDeviceSignature } from "../../vault/signing";
import { LedgerArweaveClient, LEDGER_NANO_S_TARGET_ID, ledgerMaxPayloadBytes, parseLedgerAppInfo } from "./client";
import { LedgerError, statusWordError } from "./errors";
import { encodeTransactionForLedger } from "./serialize";
import type { LedgerTransport } from "./transport";

const GATEWAY = "https://arweave.net";
const TARGET = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";
const LAST_TX = "b".repeat(64);
const utf8 = (text: string) => Uint8Array.from(new TextEncoder().encode(text));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const sw = (word: number, body: number[] = []) => Uint8Array.from([...body, word >> 8, word & 0xff]);

let jwk: JWKInterface;
let modulus: Uint8Array<ArrayBuffer>;
let address: string;

beforeAll(async () => {
  jwk = await generateJWK();
  modulus = base64UrlToBytes(jwk.n);
  address = bytesToBase64Url(await sha256(modulus));
}, 60_000);

interface Exchange {
  apdu: string;
  reply: string;
}

type SimulatedApp = "Arweave" | "Permaweb" | "BOLOS";

/**
 * A stand-in for the device: a WebCrypto RSA key, the app's chunk
 * protocol, and an independent parser for the SIGN header modelled on
 * `app/src/parser_impl.c`. It rebuilds the transaction from the parsed
 * fields and lets arweave-js compute the deep hash, so a field this
 * client encodes wrongly yields a different hash.
 */
class SimulatedLedger implements LedgerTransport {
  readonly log: Exchange[] = [];
  app: SimulatedApp = "Arweave";
  targetId = 0x33100004;
  /** Overrides the address GET_ADDRESS reports. */
  reportedAddress: string | undefined;
  /** Flips a byte of the deep hash the device reports. */
  tamperHash = false;
  /** Replies to SIGN_DATA_ITEM as the stock app does, even when app info says Permaweb. */
  lacksDataItemCommand = false;
  /** Flips a byte of the signature handed out by GET_SIG. */
  corruptSignature = false;
  /** Breaks the second GET_SIG read: an error status word, or a short half. */
  secondSignatureHalf: "ok" | "error" | "short" = "ok";
  closed = false;

  private buffer: number[] = [];
  private bufferIns = -1;
  private signature: Uint8Array | null = null;

  async exchange(apdu: Uint8Array): Promise<Uint8Array> {
    const reply = await this.handle(apdu);
    this.log.push({ apdu: hex(apdu), reply: hex(reply) });
    return reply;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private async handle(apdu: Uint8Array): Promise<Uint8Array> {
    const [cla, ins, p1, p2, lc] = apdu;
    if (cla === 0xb0 && ins === 0x01) {
      const name = utf8(this.app);
      const version = utf8("1.1.0");
      return sw(0x9000, [1, name.length, ...name, version.length, ...version, 1, 0x02]);
    }
    if (this.app === "BOLOS") return sw(0x6e00);
    if (cla !== 0x44) return sw(0x6e00);
    if (lc === undefined || lc !== apdu.length - 5) return sw(0x6700);
    const data = apdu.subarray(5);

    switch (ins) {
      case 0x00:
        return sw(0x9000, [0, 1, 1, 0, 0, this.targetId >>> 24, (this.targetId >> 16) & 0xff, (this.targetId >> 8) & 0xff, this.targetId & 0xff]);
      case 0x01:
        return sw(0x9000, [...utf8(this.reportedAddress ?? address)]);
      case 0x20:
        if (p2 !== 0 && p2 !== 1) return sw(0x6985);
        return sw(0x9000, [...modulus.subarray(p2 * 256, p2 * 256 + 256)]);
      case 0x10: {
        if (!this.signature || (p2 !== 0 && p2 !== 1)) return sw(0x6985);
        const half = [...this.signature.subarray(p2 * 256, p2 * 256 + 256)];
        if (this.corruptSignature && p2 === 0) half[0] = half[0]! ^ 1;
        if (p2 === 1) {
          this.signature = null;
          if (this.secondSignatureHalf === "error") return sw(0x6f00);
          if (this.secondSignatureHalf === "short") return sw(0x9000, half.slice(0, 255));
        }
        return sw(0x9000, half);
      }
      case 0x02:
      case 0x03:
        if (ins === 0x03 && (this.app !== "Permaweb" || this.lacksDataItemCommand)) return sw(0x6d00);
        return this.chunk(ins, p1!, data);
      default:
        return sw(0x6d00);
    }
  }

  private async chunk(ins: number, p1: number, data: Uint8Array): Promise<Uint8Array> {
    if (p1 === 0) {
      this.buffer = [];
      this.bufferIns = ins;
      return sw(0x9000);
    }
    if (this.bufferIns !== ins) return sw(0x6987);
    if (this.buffer.length + data.length > 16 * 1024) return sw(0x6983);
    this.buffer.push(...data);
    if (p1 === 1) return sw(0x9000);
    if (p1 !== 2) return sw(0x6b00);
    this.bufferIns = -1;

    const payload = Uint8Array.from(this.buffer);
    let deepHash: Uint8Array<ArrayBuffer>;
    try {
      deepHash = ins === 0x02 ? await this.transactionHash(payload) : await this.dataItemHash(payload);
    } catch (error) {
      return sw(0x6984, [...utf8((error as Error).message)]);
    }
    this.signature = await signRsaPss(jwk, deepHash);
    if (this.tamperHash) deepHash[0] = deepHash[0]! ^ 1;
    return sw(0x9000, [...deepHash]);
  }

  private async transactionHash(payload: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    let offset = 0;
    const element = (): Uint8Array => {
      if (offset + 2 > payload.length) throw new Error("Unexpected buffer end");
      const length = (payload[offset]! << 8) | payload[offset + 1]!;
      if (offset + 2 + length > payload.length) throw new Error("Unexpected buffer end");
      const value = payload.subarray(offset + 2, offset + 2 + length);
      offset += 2 + length;
      return value;
    };
    const ascii = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    const format = ascii(element());
    if (format !== "2") throw new Error("tx version is not supported");
    const owner = element();
    if (hex(owner) !== hex(modulus)) throw new Error("Unexepected internal error");
    const target = element();
    const quantity = ascii(element());
    const reward = ascii(element());
    const lastTx = element();
    const tagCount = (payload[offset]! << 8) | payload[offset + 1]!;
    offset += 2;
    if (tagCount > 16) throw new Error("Value out of range");
    const tags = Array.from({ length: tagCount }, () => ({
      name: bytesToBase64Url(element()),
      value: bytesToBase64Url(element()),
    }));
    const dataSize = ascii(element());
    const dataRoot = element();
    const transaction = clientForGateway(GATEWAY).transactions.fromRaw({
      format: 2,
      owner: bytesToBase64Url(owner),
      target: bytesToBase64Url(target),
      quantity,
      reward,
      last_tx: bytesToBase64Url(lastTx),
      tags,
      data_size: dataSize,
      data_root: bytesToBase64Url(dataRoot),
    });
    return Uint8Array.from(await transaction.getSignatureData());
  }

  private async dataItemHash(payload: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    if (payload[0] !== 1 || payload[1] !== 0) throw new Error("Unsupported signature type");
    if (hex(payload.subarray(514, 1026)) !== hex(modulus)) throw new Error("Owner mismatch");
    return dataItemSignatureData(payload);
  }
}

/** Replays a recorded session, failing on any APDU that differs from the recording. */
function replayTransport(recording: Exchange[]): LedgerTransport & { remaining: () => number } {
  const queue = [...recording];
  return {
    async exchange(apdu) {
      const next = queue.shift();
      if (!next) throw new Error(`Unexpected APDU ${hex(apdu)}`);
      expect(hex(apdu)).toBe(next.apdu);
      return Uint8Array.from(Buffer.from(next.reply, "hex"));
    },
    async close() {},
    remaining: () => queue.length,
  };
}

/** Answers every APDU with `reply`. */
function fixedTransport(reply: Uint8Array): LedgerTransport {
  return { exchange: async () => reply, close: async () => {} };
}

function insSent(log: Exchange[]): string[] {
  return log.map((exchange) => exchange.apdu.slice(0, 8));
}

function unsignedTransaction(attributes: Parameters<typeof buildUnsignedTransaction>[2], tags: Array<{ name: string; value: string }> = []) {
  return buildUnsignedTransaction(GATEWAY, jwk.n, attributes, tags);
}

async function expectLedgerError(promise: Promise<unknown>, code: LedgerError["code"]): Promise<LedgerError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(LedgerError);
  expect((error as LedgerError).code).toBe(code);
  return error as LedgerError;
}

describe("LedgerArweaveClient: identity", () => {
  it("reads the version, including the device's target id", async () => {
    const device = new SimulatedLedger();
    const version = await new LedgerArweaveClient(device).getVersion();

    expect(version).toEqual({ testMode: false, major: 1, minor: 1, patch: 0, locked: false, targetId: 0x33100004 });
    expect(device.log[0]!.apdu).toBe("4400000000");
    expect(ledgerMaxPayloadBytes(version)).toBe(16 * 1024);
    expect(ledgerMaxPayloadBytes({ ...version, targetId: LEDGER_NANO_S_TARGET_ID })).toBe(8 * 1024);
  });

  it("accepts a 5-byte version reply and reports a locked device", async () => {
    const version = await new LedgerArweaveClient(fixedTransport(sw(0x9000, [0xff, 1, 0, 3, 1]))).getVersion();
    expect(version).toEqual({ testMode: true, major: 1, minor: 0, patch: 3, locked: true });
  });

  it("reads the address and public key and checks one hashes to the other", async () => {
    const device = new SimulatedLedger();
    const account = await new LedgerArweaveClient(device).getAccount();

    expect(account.address).toBe(address);
    expect(account.owner).toBe(jwk.n);
    expect(account.publicKey.byteLength).toBe(512);
    expect(device.log.map((exchange) => exchange.apdu)).toEqual(["4401000000", "4420000000", "4420000100"]);
  });

  it("asks the device to show the address when verifying", async () => {
    const device = new SimulatedLedger();
    await new LedgerArweaveClient(device).getAddress({ verify: true });
    expect(device.log[0]!.apdu).toBe("4401010000");
  });

  it("rejects a public key that doesn't hash to the reported address", async () => {
    const device = new SimulatedLedger();
    device.reportedAddress = "a".repeat(43);
    await expectLedgerError(new LedgerArweaveClient(device).getAccount(), "identity-mismatch");
  });

  it("rejects a malformed address or a short key half", async () => {
    await expectLedgerError(new LedgerArweaveClient(fixedTransport(sw(0x9000, [...utf8("short")]))).getAddress(), "invalid-response");
    await expectLedgerError(new LedgerArweaveClient(fixedTransport(sw(0x9000, new Array(255).fill(1)))).getPublicKey(), "invalid-response");
    await expectLedgerError(new LedgerArweaveClient(fixedTransport(Uint8Array.from([0x90]))).getVersion(), "invalid-response");
  });

  it("closes the transport", async () => {
    const device = new SimulatedLedger();
    await new LedgerArweaveClient(device).close();
    expect(device.closed).toBe(true);
  });
});

describe("LedgerArweaveClient: signTransaction", () => {
  it.each<[string, () => Promise<ArweaveTransactionJson>]>([
    ["AR transfer with no data", () => unsignedTransaction({ target: TARGET, quantity: "1000", reward: "5000", last_tx: LAST_TX })],
    [
      "data with tags",
      () =>
        unsignedTransaction({ data: utf8("hello from a dApp"), target: "", quantity: "0", reward: "77", last_tx: LAST_TX }, [
          { name: "Content-Type", value: "text/plain" },
          { name: "App-Name", value: "Gleam ✓" },
        ]),
    ],
    [
      "16 tags and multi-chunk data",
      () =>
        unsignedTransaction(
          { data: new Uint8Array(300 * 1024).fill(3), target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX },
          Array.from({ length: 16 }, (_, index) => ({ name: `T${index}`, value: "x".repeat(index * 30) })),
        ),
    ],
  ])("round-trips to a signature core verifies (%s)", async (_, build) => {
    const tx = await build();
    const device = new SimulatedLedger();
    const signature = await new LedgerArweaveClient(device).signTransaction(tx);

    expect(signature.byteLength).toBe(512);
    expect(await verifyDeviceSignature({ kind: "transaction", transaction: tx }, signature, jwk.n)).toBe(true);
  });

  it("sends the 20-byte path slot, then 200-byte chunks with init/add/last, then GET_SIG twice", async () => {
    const tx = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX }, [{ name: "A", value: "b" }]);
    const header = encodeTransactionForLedger(tx);
    const device = new SimulatedLedger();
    await new LedgerArweaveClient(device).signTransaction(tx);

    const signApdus = device.log.filter((exchange) => exchange.apdu.startsWith("4402"));
    expect(signApdus[0]!.apdu).toBe(`44020000 14${"00".repeat(20)}`.replace(" ", ""));
    const chunkCount = Math.ceil(header.byteLength / 200);
    expect(signApdus.map((exchange) => exchange.apdu.slice(4, 6))).toEqual(["00", ...Array(chunkCount - 1).fill("01"), "02"]);
    expect(signApdus.slice(1).map((exchange) => exchange.apdu.slice(10)).join("")).toBe(hex(header));
    expect(insSent(device.log).slice(-2)).toEqual(["44100000", "44100001"]);
  });

  it.each([800, 801])("handles a header of exactly %i bytes (200-byte chunk boundary)", async (target) => {
    const base = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX }, [{ name: "P", value: "" }]);
    const padding = target - encodeTransactionForLedger(base).byteLength;
    const tx = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX }, [{ name: "P", value: "p".repeat(padding) }]);
    expect(encodeTransactionForLedger(tx).byteLength).toBe(target);

    const device = new SimulatedLedger();
    const signature = await new LedgerArweaveClient(device).signTransaction(tx);

    const chunkSizes = device.log.filter((exchange) => exchange.apdu.startsWith("4402")).map((exchange) => (exchange.apdu.length - 10) / 2);
    expect(chunkSizes).toEqual(target === 800 ? [20, 200, 200, 200, 200] : [20, 200, 200, 200, 200, 1]);
    expect(await verifyDeviceSignature({ kind: "transaction", transaction: tx }, signature, jwk.n)).toBe(true);
  });

  it("replays a recorded session to the same signature", async () => {
    const tx = await unsignedTransaction({ data: utf8("recorded"), target: "", quantity: "0", reward: "5", last_tx: LAST_TX });
    const device = new SimulatedLedger();
    const recorded = await new LedgerArweaveClient(device).signTransaction(tx);

    const replay = replayTransport(device.log);
    const replayed = await new LedgerArweaveClient(replay).signTransaction(tx);

    expect(hex(replayed)).toBe(hex(recorded));
    expect(replay.remaining()).toBe(0);
  });

  it("fails on a deep-hash mismatch without fetching the signature", async () => {
    const tx = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX });
    const device = new SimulatedLedger();
    device.tamperHash = true;

    await expectLedgerError(new LedgerArweaveClient(device).signTransaction(tx), "hash-mismatch");
    expect(insSent(device.log).some((ins) => ins.startsWith("4410"))).toBe(false);
  });

  it("rejects a signature that doesn't verify against the owner", async () => {
    const tx = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX });
    const device = new SimulatedLedger();
    device.corruptSignature = true;

    const error = await expectLedgerError(new LedgerArweaveClient(device).signTransaction(tx), "signature-invalid");
    expect(error.message).toMatch(/sign again on your Ledger/);
  });

  it.each<["error" | "short"]>([["error"], ["short"]])("asks to sign again when the second signature half fails (%s)", async (failure) => {
    const tx = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX });
    const device = new SimulatedLedger();
    device.secondSignatureHalf = failure;

    const error = await expectLedgerError(new LedgerArweaveClient(device).signTransaction(tx), "signature-incomplete");
    expect(error.message).toBe("Gleam couldn't read the signature from your Ledger. Sign again on your Ledger.");
    expect(insSent(device.log).slice(-2)).toEqual(["44100000", "44100001"]);
  });

  it("refuses a transaction owned by another key before signing", async () => {
    const tx = await buildUnsignedTransaction(GATEWAY, bytesToBase64Url(new Uint8Array(512).fill(5)), {
      target: TARGET,
      quantity: "1",
      reward: "1",
      last_tx: LAST_TX,
    });
    const device = new SimulatedLedger();

    await expectLedgerError(new LedgerArweaveClient(device).signTransaction(tx), "owner-mismatch");
    expect(insSent(device.log).some((ins) => ins.startsWith("4402"))).toBe(false);
  });

  it("refuses format 1, more than 16 tags, and oversized headers without touching the device", async () => {
    const tx = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX });
    const device = new SimulatedLedger();
    const client = new LedgerArweaveClient(device);
    const tags = (count: number, size: number) =>
      Array.from({ length: count }, (_, index) => ({ name: bytesToBase64Url(utf8(`T${index}`)), value: bytesToBase64Url(new Uint8Array(size)) }));

    await expectLedgerError(client.signTransaction({ ...tx, format: 1 }), "unsupported-payload");
    await expectLedgerError(client.signTransaction({ ...tx, tags: tags(17, 1) }), "too-many-tags");
    await expectLedgerError(client.signTransaction({ ...tx, tags: tags(16, 1100) }), "payload-too-large");
    // Fits a Nano S Plus but not a Nano S.
    const nanoSPlusOnly = { ...tx, tags: tags(10, 1000) };
    await expectLedgerError(client.signTransaction(nanoSPlusOnly, { maxBytes: 8 * 1024 }), "payload-too-large");
    expect(device.log).toEqual([]);
  });

  it("surfaces the device parser's reason with 0x6984", async () => {
    const tx = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX });
    const pk = sw(0x9000, [...modulus.subarray(0, 256)]);
    const pk2 = sw(0x9000, [...modulus.subarray(256)]);
    const replies = [pk, pk2, sw(0x9000), sw(0x9000), sw(0x9000), sw(0x9000), sw(0x6984, [...utf8("Value out of range")])];
    const transport: LedgerTransport = { exchange: async () => replies.shift() ?? sw(0x6984, [...utf8("Value out of range")]), close: async () => {} };

    const error = await expectLedgerError(new LedgerArweaveClient(transport).signTransaction(tx), "data-invalid");
    expect(error.message).toBe("The Ledger app rejected the transaction data: Value out of range.");
    expect(error.statusWord).toBe(0x6984);
  });

  it("maps a rejection on the device", async () => {
    const tx = await unsignedTransaction({ target: TARGET, quantity: "1", reward: "1", last_tx: LAST_TX });
    let calls = 0;
    const transport: LedgerTransport = {
      exchange: async () => {
        calls += 1;
        if (calls <= 2) return sw(0x9000, [...modulus.subarray((calls - 1) * 256, calls * 256)]);
        return calls < 7 ? sw(0x9000) : sw(0x6986);
      },
      close: async () => {},
    };
    const error = await expectLedgerError(new LedgerArweaveClient(transport).signTransaction(tx), "user-rejected");
    expect(error.message).toBe("Request rejected on your Ledger.");
  });
});

describe("LedgerArweaveClient: signDataItem", () => {
  const item = (fields: Partial<Parameters<typeof buildUnsignedDataItem>[1]> = {}) =>
    buildUnsignedDataItem(jwk.n, { data: utf8("hello AO"), tags: [{ name: "Action", value: "Transfer" }], ...fields });

  it("round-trips on the Permaweb app to a signature core verifies", async () => {
    const raw = item({ target: TARGET, anchor: "a".repeat(32) });
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    const signature = await new LedgerArweaveClient(device).signPayload({ kind: "dataItem", raw });

    expect(await verifyDeviceSignature({ kind: "dataItem", raw }, signature, jwk.n)).toBe(true);
    const chunkApdus = device.log.filter((exchange) => exchange.apdu.startsWith("4403"));
    expect(chunkApdus[0]!.apdu).toBe("4403000000");
    expect(chunkApdus.slice(1).map((exchange) => exchange.apdu.slice(10)).join("")).toBe(hex(raw));
    expect(insSent(device.log).slice(-2)).toEqual(["44100000", "44100001"]);
  });

  it.each([1200, 1201])("handles an item of exactly %i bytes (200-byte chunk boundary)", async (size) => {
    const base = item({ data: new Uint8Array() }).byteLength;
    const raw = item({ data: new Uint8Array(size - base).fill(1) });
    expect(raw.byteLength).toBe(size);
    const device = new SimulatedLedger();
    device.app = "Permaweb";

    const signature = await new LedgerArweaveClient(device).signDataItem(raw);

    const chunkSizes = device.log.filter((exchange) => exchange.apdu.startsWith("4403")).map((exchange) => (exchange.apdu.length - 10) / 2);
    expect(chunkSizes).toEqual(size === 1200 ? [0, 200, 200, 200, 200, 200, 200] : [0, 200, 200, 200, 200, 200, 200, 1]);
    expect(await verifyDeviceSignature({ kind: "dataItem", raw }, signature, jwk.n)).toBe(true);
  });

  it("signs an item with empty data and no tags", async () => {
    const raw = buildUnsignedDataItem(jwk.n, { data: new Uint8Array() });
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    const signature = await new LedgerArweaveClient(device).signDataItem(raw);
    expect(await verifyDeviceSignature({ kind: "dataItem", raw }, signature, jwk.n)).toBe(true);
  });

  it("needs the Permaweb app: the stock app is refused before any data-item command", async () => {
    const device = new SimulatedLedger();
    const error = await expectLedgerError(new LedgerArweaveClient(device).signDataItem(item()), "permaweb-app-required");
    expect(error.message).toMatch(/Permaweb app/);
    expect(insSent(device.log).some((ins) => ins.startsWith("4403"))).toBe(false);
  });

  it("maps an unsupported SIGN_DATA_ITEM to the Permaweb requirement", async () => {
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    device.lacksDataItemCommand = true;
    await expectLedgerError(new LedgerArweaveClient(device).signDataItem(item()), "permaweb-app-required");
  });

  it("asks for the app when the dashboard is open", async () => {
    const device = new SimulatedLedger();
    device.app = "BOLOS";
    const error = await expectLedgerError(new LedgerArweaveClient(device).signDataItem(item()), "app-not-open");
    expect(error.message).toBe("Open the Arweave app on your Ledger.");
  });

  it("fails on a deep-hash mismatch without fetching the signature", async () => {
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    device.tamperHash = true;
    await expectLedgerError(new LedgerArweaveClient(device).signDataItem(item()), "hash-mismatch");
    expect(insSent(device.log).some((ins) => ins.startsWith("4410"))).toBe(false);
  });

  it("rejects a data-item signature that doesn't verify against the owner", async () => {
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    device.corruptSignature = true;
    await expectLedgerError(new LedgerArweaveClient(device).signDataItem(item()), "signature-invalid");
  });

  it.each<[string, Array<{ name: string; value: string }>, RegExp]>([
    ["a duplicate tag name", [{ name: "Action", value: "Transfer" }, { name: "Action", value: "Eval" }], /two "Action" tags/],
    ["a non-ASCII value", [{ name: "App-Name", value: "Gleam ✓" }], /plain ASCII/],
    ["a control character in a name", [{ name: "A\tB", value: "x" }], /plain ASCII/],
    ["an empty name", [{ name: "", value: "x" }], /plain ASCII/],
  ])("refuses %s before sending, as the Permaweb app would", async (_, tags, message) => {
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    const error = await expectLedgerError(new LedgerArweaveClient(device).signDataItem(item({ tags })), "unsupported-tags");
    expect(error.message).toMatch(message);
    expect(device.log).toEqual([]);
  });

  it("accepts an empty tag value", async () => {
    const raw = item({ tags: [{ name: "Empty", value: "" }] });
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    const signature = await new LedgerArweaveClient(device).signDataItem(raw);
    expect(await verifyDeviceSignature({ kind: "dataItem", raw }, signature, jwk.n)).toBe(true);
  });

  it("refuses another owner, a non-type-1 item, more than 16 tags and more than 16 KiB", async () => {
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    const client = new LedgerArweaveClient(device);

    const foreign = buildUnsignedDataItem(bytesToBase64Url(new Uint8Array(512).fill(9)), { data: utf8("x") });
    await expectLedgerError(client.signDataItem(foreign), "owner-mismatch");

    const typeTwo = item();
    typeTwo[0] = 2;
    await expectLedgerError(client.signDataItem(typeTwo), "unsupported-payload");

    const manyTags = item({ tags: Array.from({ length: 17 }, (_, index) => ({ name: `T${index}`, value: "v" })) });
    await expectLedgerError(client.signDataItem(manyTags), "too-many-tags");

    await expectLedgerError(client.signDataItem(item({ data: new Uint8Array(16 * 1024) })), "payload-too-large");
    expect(insSent(device.log).some((ins) => ins.startsWith("4403"))).toBe(false);
  });
});

describe("statusWordError", () => {
  it.each<[number, LedgerError["code"], string]>([
    [0x5515, "device-locked", "Unlock your Ledger and open the Arweave app."],
    [0x6982, "device-locked", "Unlock your Ledger and open the Arweave app."],
    [0x6d00, "app-not-open", "Open the Arweave app on your Ledger."],
    [0x6e00, "app-not-open", "Open the Arweave app on your Ledger."],
    [0x6e01, "app-not-open", "Open the Arweave app on your Ledger."],
    [0x6986, "user-rejected", "Request rejected on your Ledger."],
    [0x6987, "key-not-ready", "Your Ledger is still setting up the Arweave key. This can take a few minutes the first time."],
    [0x6984, "data-invalid", "The Ledger app rejected the transaction data."],
    [0x6985, "conditions-not-satisfied", "Your Ledger couldn't complete the request (conditions not satisfied)."],
    [0x6700, "wrong-length", "Your Ledger rejected the request length."],
    [0x6a80, "bad-data", "The Ledger app rejected the request data."],
    [0x6f00, "device-error", "Ledger command failed (0x6f00)."],
  ])("maps status word %i through the client", async (word, code, message) => {
    const error = await expectLedgerError(new LedgerArweaveClient(fixedTransport(sw(word))).getVersion(), code);
    expect(error.message).toBe(message);
    expect(error.statusWord).toBe(word);
  });

  it("appends only the printable part of a 0x6984 reason", () => {
    expect(statusWordError(0x6984, Uint8Array.from([0, ...utf8("Unexpected buffer end"), 0x0a])).message).toBe(
      "The Ledger app rejected the transaction data: Unexpected buffer end.",
    );
  });
});

describe("parseLedgerAppInfo", () => {
  const reply = (name: string, version: string) => {
    const n = utf8(name);
    const v = utf8(version);
    return Uint8Array.from([1, n.length, ...n, v.length, ...v, 1, 0x02]);
  };

  it.each<[string, string | null]>([
    ["Arweave", "Arweave"],
    ["Permaweb", "Permaweb"],
    ["BOLOS", null],
    ["Bitcoin", null],
  ])("recognises %s", (name, app) => {
    expect(parseLedgerAppInfo(reply(name, "1.1.0"))).toEqual({ name, version: "1.1.0", app });
  });

  it("sends B0 01 00 00 through the client", async () => {
    const device = new SimulatedLedger();
    device.app = "Permaweb";
    expect((await new LedgerArweaveClient(device).getAppInfo()).app).toBe("Permaweb");
    expect(device.log[0]!.apdu).toBe("b0010000");
  });

  it("rejects an unknown format or a truncated reply", () => {
    expect(() => parseLedgerAppInfo(Uint8Array.from([2, 0, 0]))).toThrow(LedgerError);
    expect(() => parseLedgerAppInfo(Uint8Array.from([1, 7, ...utf8("Arwe")]))).toThrow(LedgerError);
    expect(() => parseLedgerAppInfo(Uint8Array.from([1, 7, ...utf8("Arweave")]))).toThrow(LedgerError);
  });
});
