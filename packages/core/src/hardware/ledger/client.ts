import { readDataItemFields, dataItemSignatureData, type DataItemTag } from "../../arweave/data-item";
import { sha256, verifyRsaPss } from "../../arweave/rsa-pss";
import { transactionSignatureData, type ArweaveTransactionJson } from "../../arweave/transaction";
import { base64UrlToBytes, bytesToBase64Url } from "../../vault/base64";
import type { UnsignedPayload } from "../../vault/signing";
import { LedgerError, SW_OK, statusWordError } from "./errors";
import { concatBytes, encodeTransactionForLedger, ledgerChunks } from "./serialize";
import type { LedgerTransport } from "./transport";

/**
 * The Arweave Ledger app's APDU protocol (Zondax's `app-arweave`, spec in
 * its `docs/APDUSPEC.md`), plus the Permaweb fork's SIGN_DATA_ITEM
 * (`docs/ANS104.md` on jajablinky/app-arweave). The device keeps one
 * RSA-4096 key; it signs a transaction or data item after showing it,
 * answers with the 48-byte deep hash it computed, and hands the
 * signature out through two GET_SIG calls.
 *
 * Every deep hash the device reports is compared with the one core
 * computes for the same payload before the signature is fetched, so a
 * serialization drift between this client and the app fails here
 * rather than yielding a signature over something else.
 */

type Bytes = Uint8Array<ArrayBuffer>;

const CLA = 0x44;
const INS = {
  getVersion: 0x00,
  getAddress: 0x01,
  sign: 0x02,
  signDataItem: 0x03,
  getSignature: 0x10,
  getPublicKey: 0x20,
} as const;
const P1_INIT = 0;
const P1_ADD = 1;
const P1_LAST = 2;

/** Ledger OS's "which app is open" command; answered by the dashboard too, as "BOLOS". */
const APP_INFO_APDU = Uint8Array.from([0xb0, 0x01, 0x00, 0x00]);

const KEY_HALF = 256;
const KEY_LENGTH = 512;
const DEEP_HASH_LENGTH = 48;
const MAX_TAGS = 16;
const DATA_ITEM_OWNER_OFFSET = 2 + 512;
const SW_INS_NOT_SUPPORTED = 0x6d00;

/** The app's transaction buffer: 16 KiB, or 8 KiB on a Nano S. Data items get the same client cap. */
export const LEDGER_MAX_PAYLOAD_BYTES = 16 * 1024;
export const LEDGER_NANO_S_MAX_PAYLOAD_BYTES = 8 * 1024;
export const LEDGER_NANO_S_TARGET_ID = 0x31100004;

export interface LedgerAppVersion {
  testMode: boolean;
  major: number;
  minor: number;
  patch: number;
  locked: boolean;
  /** The device model's target id, when the app reports it (bytes 5..9 of GET_VERSION). */
  targetId?: number;
}

export type LedgerArweaveApp = "Arweave" | "Permaweb";

export interface LedgerAppInfo {
  name: string;
  version: string;
  /** Which Arweave app is open, or null for the dashboard or any other app. */
  app: LedgerArweaveApp | null;
}

export interface LedgerAccount {
  address: string;
  /** The 512-byte RSA modulus as base64url: the wallet's `owner`. */
  owner: string;
  publicKey: Bytes;
}

export interface LedgerSignOptions {
  /** Largest payload the device can buffer; see `ledgerMaxPayloadBytes`. */
  maxBytes?: number;
}

/** The payload cap for the device that answered GET_VERSION. */
export function ledgerMaxPayloadBytes(version: LedgerAppVersion): number {
  return version.targetId === LEDGER_NANO_S_TARGET_ID ? LEDGER_NANO_S_MAX_PAYLOAD_BYTES : LEDGER_MAX_PAYLOAD_BYTES;
}

function invalidResponse(what: string): LedgerError {
  return new LedgerError("invalid-response", `Your Ledger sent an unexpected reply (${what}).`);
}

/** Parses the reply to `B0 01 00 00`: format 1, then length-prefixed name and version. */
export function parseLedgerAppInfo(data: Uint8Array): LedgerAppInfo {
  if (data[0] !== 1) throw invalidResponse("app info format");
  const readField = (offset: number): [string, number] => {
    const length = data[offset];
    if (length === undefined || offset + 1 + length > data.byteLength) throw invalidResponse("app info length");
    let text = "";
    for (const byte of data.subarray(offset + 1, offset + 1 + length)) text += String.fromCharCode(byte);
    return [text, offset + 1 + length];
  };
  const [name, versionOffset] = readField(1);
  const [version] = readField(versionOffset);
  const app = name === "Arweave" || name === "Permaweb" ? name : null;
  return { name, version, app };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
}

function ownerMismatch(): LedgerError {
  return new LedgerError("owner-mismatch", "This request belongs to a different account than the connected Ledger.");
}

export class LedgerArweaveClient {
  constructor(private readonly transport: LedgerTransport) {}

  close(): Promise<void> {
    return this.transport.close();
  }

  /** Sends one APDU; resolves with the response data, or throws the status word's `LedgerError`. */
  private async send(apdu: Uint8Array): Promise<Bytes> {
    const reply = await this.transport.exchange(apdu);
    if (reply.byteLength < 2) throw invalidResponse("no status word");
    const statusWord = (reply[reply.byteLength - 2]! << 8) | reply[reply.byteLength - 1]!;
    const body = Uint8Array.from(reply.subarray(0, reply.byteLength - 2));
    if (statusWord !== SW_OK) throw statusWordError(statusWord, body);
    return body;
  }

  private command(ins: number, p1 = 0, p2 = 0, data: Uint8Array = new Uint8Array()): Promise<Bytes> {
    if (data.byteLength > 255) throw new Error("APDU data is limited to 255 bytes.");
    return this.send(concatBytes(Uint8Array.from([CLA, ins, p1, p2, data.byteLength]), data));
  }

  async getVersion(): Promise<LedgerAppVersion> {
    const data = await this.command(INS.getVersion);
    if (data.byteLength < 5) throw invalidResponse("version length");
    const version: LedgerAppVersion = {
      testMode: data[0] !== 0,
      major: data[1]!,
      minor: data[2]!,
      patch: data[3]!,
      locked: data[4] !== 0,
    };
    if (data.byteLength >= 9) {
      version.targetId = ((data[5]! << 24) | (data[6]! << 16) | (data[7]! << 8) | data[8]!) >>> 0;
    }
    return version;
  }

  /** Which app is open: "Arweave" (stock), "Permaweb" (the fork that signs data items), or null. */
  async getAppInfo(): Promise<LedgerAppInfo> {
    return parseLedgerAppInfo(await this.send(APP_INFO_APDU));
  }

  /** The 43-character address. With `verify`, the device shows it and waits for the user to confirm. */
  async getAddress({ verify = false }: { verify?: boolean } = {}): Promise<string> {
    const data = await this.command(INS.getAddress, verify ? 1 : 0);
    let address = "";
    for (const byte of data) address += String.fromCharCode(byte);
    if (!/^[A-Za-z0-9_-]{43}$/.test(address)) throw invalidResponse("address");
    return address;
  }

  /** The 512-byte RSA modulus, read in two halves. */
  async getPublicKey(): Promise<Bytes> {
    return this.readTwoHalves(INS.getPublicKey, "public key");
  }

  /** Address and public key, checked against each other. */
  async getAccount({ verify = false }: { verify?: boolean } = {}): Promise<LedgerAccount> {
    const address = await this.getAddress({ verify });
    const publicKey = await this.getPublicKey();
    if (bytesToBase64Url(await sha256(publicKey)) !== address) {
      throw new LedgerError("identity-mismatch", "Your Ledger's address doesn't match its public key.");
    }
    return { address, owner: bytesToBase64Url(publicKey), publicKey };
  }

  /** Signs a payload from `core/vault/signing`'s `prepare*` step. Returns the raw 512-byte signature. */
  async signPayload(payload: UnsignedPayload, options?: LedgerSignOptions): Promise<Bytes> {
    switch (payload.kind) {
      case "transaction":
        return this.signTransaction(payload.transaction, options);
      case "dataItem":
        return this.signDataItem(payload.raw, options);
      case "message":
        throw new LedgerError("unsupported-payload", LEDGER_MESSAGE_UNSUPPORTED);
    }
  }

  /** Signs an unsigned format-2 transaction owned by the device's key. Returns the raw 512-byte signature. */
  async signTransaction(tx: ArweaveTransactionJson, { maxBytes = LEDGER_MAX_PAYLOAD_BYTES }: LedgerSignOptions = {}): Promise<Bytes> {
    if (tx.format !== 2) {
      throw new LedgerError("unsupported-payload", "Ledger only signs format-2 Arweave transactions.");
    }
    // The app renders a Target screen before signing and fails with "Unexpected buffer end" when there is none.
    if (!tx.target) throw new LedgerError("unsupported-payload", LEDGER_TARGET_REQUIRED_MESSAGE);
    if (tx.tags.length > MAX_TAGS) {
      throw new LedgerError("too-many-tags", `Ledger signs at most ${MAX_TAGS} tags.`);
    }
    const header = encodeTransactionForLedger(tx);
    if (header.byteLength > maxBytes) {
      throw new LedgerError("payload-too-large", "This transaction's tags are too large for your Ledger to sign.");
    }
    const expected = await transactionSignatureData(tx);
    if (!equalBytes(await this.getPublicKey(), base64UrlToBytes(tx.owner))) throw ownerMismatch();

    // The first chunk once carried a 20-byte derivation path; the app ignores it but Zondax's client still sends it.
    const deepHash = await this.sendChunks(INS.sign, ledgerChunks(new Uint8Array(20), header));
    return this.finishSigning(deepHash, expected, tx.owner, "transaction");
  }

  /**
   * Signs a raw unsigned ANS-104 item (signature type 1, owned by the
   * device's key). Needs the Permaweb app; the stock Arweave app has no
   * data-item command. Returns the raw 512-byte signature.
   */
  async signDataItem(raw: Uint8Array, { maxBytes = LEDGER_MAX_PAYLOAD_BYTES }: LedgerSignOptions = {}): Promise<Bytes> {
    if (raw.byteLength < 2 || raw[0] !== 1 || raw[1] !== 0) {
      throw new LedgerError("unsupported-payload", "Ledger only signs Arweave (type 1) data items.");
    }
    if (raw.byteLength > maxBytes) {
      throw new LedgerError("payload-too-large", "This data item is too large for your Ledger to sign.");
    }
    let tags: DataItemTag[];
    let expected: Bytes;
    try {
      tags = readDataItemFields(raw).tags;
      expected = await dataItemSignatureData(raw);
    } catch (error) {
      throw new LedgerError("unsupported-payload", error instanceof Error ? error.message : String(error));
    }
    if (tags.length > MAX_TAGS) {
      throw new LedgerError("too-many-tags", `Ledger signs at most ${MAX_TAGS} tags.`);
    }
    checkPermawebTags(tags);

    const { app } = await this.getAppInfo();
    if (app === "Arweave") throw permawebRequired();
    if (app === null) throw statusWordError(0x6e00);
    const owner = raw.subarray(DATA_ITEM_OWNER_OFFSET, DATA_ITEM_OWNER_OFFSET + KEY_LENGTH);
    if (!equalBytes(await this.getPublicKey(), owner)) throw ownerMismatch();

    let deepHash: Bytes;
    try {
      deepHash = await this.sendChunks(INS.signDataItem, ledgerChunks(new Uint8Array(), raw));
    } catch (error) {
      if (error instanceof LedgerError && error.statusWord === SW_INS_NOT_SUPPORTED) throw permawebRequired();
      throw error;
    }
    return this.finishSigning(deepHash, expected, bytesToBase64Url(owner), "data item");
  }

  /** Sends init, add… and last; resolves with the last reply's 48-byte deep hash. */
  private async sendChunks(ins: number, chunks: Bytes[]): Promise<Bytes> {
    let reply = new Uint8Array();
    for (let index = 0; index < chunks.length; index += 1) {
      const p1 = index === 0 ? P1_INIT : index === chunks.length - 1 ? P1_LAST : P1_ADD;
      reply = await this.command(ins, p1, 0, chunks[index]);
    }
    if (reply.byteLength < DEEP_HASH_LENGTH) throw invalidResponse("deep hash length");
    return reply.slice(0, DEEP_HASH_LENGTH);
  }

  private async finishSigning(deepHash: Uint8Array, expected: Bytes, owner: string, what: string): Promise<Bytes> {
    if (!equalBytes(deepHash, expected)) {
      throw new LedgerError(
        "hash-mismatch",
        `Your Ledger signed a different ${what} than Gleam built. Nothing was sent; update the Ledger app and try again.`,
      );
    }
    // The device zeroizes the signature once the second half is read, so any failure here needs a fresh signing.
    let signature: Bytes;
    try {
      signature = await this.readTwoHalves(INS.getSignature, "signature");
    } catch (error) {
      throw new LedgerError("signature-incomplete", "Gleam couldn't read the signature from your Ledger. Sign again on your Ledger.", error instanceof LedgerError ? error.statusWord : undefined);
    }
    if (!(await verifyRsaPss(owner, expected, signature))) {
      throw new LedgerError("signature-invalid", "Your Ledger returned a signature that doesn't check out. Nothing was sent; sign again on your Ledger.");
    }
    return signature;
  }

  private async readTwoHalves(ins: number, what: string): Promise<Bytes> {
    const first = await this.command(ins, 0, 0);
    const second = await this.command(ins, 0, 1);
    if (first.byteLength !== KEY_HALF || second.byteLength !== KEY_HALF) throw invalidResponse(`${what} length`);
    return concatBytes(first, second);
  }
}

/** The Permaweb app's tag rules (`validate_tags` in its `parser_dataitem.c`): printable ASCII, non-empty unique names. */
function checkPermawebTags(tags: DataItemTag[]): void {
  const printable = (text: string) => /^[\x20-\x7e]*$/.test(text);
  const seen = new Set<string>();
  for (const { name, value } of tags) {
    if (!name || !printable(name) || !printable(value)) {
      throw new LedgerError(
        "unsupported-tags",
        `Your Ledger only signs tags written in plain ASCII text, with a name. "${name}" can't be shown on the device.`,
      );
    }
    if (seen.has(name)) {
      throw new LedgerError("unsupported-tags", `Your Ledger can't sign a data item with two "${name}" tags.`);
    }
    seen.add(name);
  }
}

/** The permawebOS wallet, which installs the beta Permaweb app on a Ledger; Gleam doesn't ship the app. */
export const LEDGER_PERMAWEB_INSTALLER_URL = "https://arweave.net/DkgYUWIl593qN_2OVeGxgK5ZHtv6ERIb_llTzzAQ594";

export const LEDGER_PERMAWEB_REQUIRED_MESSAGE =
  "Your Ledger can't send AO tokens or sign data items with the Arweave app. Install the beta Permaweb app on it " +
  `with the permawebOS wallet (${LEDGER_PERMAWEB_INSTALLER_URL}), then open the Permaweb app and try again.`;

export const LEDGER_TARGET_REQUIRED_MESSAGE =
  "The Ledger Arweave app only signs transactions sent to an address. Use a Keystone or a keyfile wallet for this one.";

export const LEDGER_MESSAGE_UNSUPPORTED = "The Ledger Arweave app can't sign messages. Use a Keystone or a keyfile wallet.";

function permawebRequired(): LedgerError {
  return new LedgerError("permaweb-app-required", LEDGER_PERMAWEB_REQUIRED_MESSAGE);
}
