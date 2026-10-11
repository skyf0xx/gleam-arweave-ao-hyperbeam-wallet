import type { LedgerTransport } from "@gleam/core";

/*
 * Ledger's HID framing is implemented here rather than through
 * @ledgerhq/hw-transport-webhid: that package pulls in Buffer, the
 * @ledgerhq/errors stack and a device registry, and throws
 * TransportStatusError on non-0x9000 status words, which the core client
 * wants to see as plain bytes. The framing is ~60 lines.
 */

export const LEDGER_VENDOR_ID = 0x2c97;
const CHANNEL = 0x0101;
const TAG_APDU = 0x05;
const PACKET_SIZE = 64;
const HEADER_SIZE = 5;

/** The slice of the WebHID `HIDDevice` this adapter uses. */
export interface HidDeviceLike {
  readonly opened: boolean;
  readonly productName: string;
  readonly vendorId: number;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: "inputreport", listener: (event: { data: DataView }) => void): void;
  removeEventListener(type: "inputreport", listener: (event: { data: DataView }) => void): void;
}

/** The slice of `navigator.hid` this adapter uses. */
export interface HidLike {
  getDevices(): Promise<HidDeviceLike[]>;
  requestDevice(options: { filters: { vendorId: number }[] }): Promise<HidDeviceLike[]>;
  addEventListener(type: "disconnect", listener: (event: { device: HidDeviceLike }) => void): void;
  removeEventListener(type: "disconnect", listener: (event: { device: HidDeviceLike }) => void): void;
}

export type LedgerTransportFailure =
  | "unsupported"
  | "no-device"
  | "busy"
  | "disconnected"
  | "invalid-response";

const FAILURE_COPY: Record<LedgerTransportFailure, string> = {
  unsupported: "This browser can't talk to a Ledger. Open Gleam in Chrome or another Chromium browser.",
  "no-device": "No Ledger was selected. Plug it in, unlock it and try again.",
  busy: "Close Ledger Live or other wallet windows and try again.",
  disconnected: "The Ledger was disconnected. Plug it back in and try again.",
  "invalid-response": "Your Ledger sent an unexpected reply. Unplug it, plug it back in and try again.",
};

export class LedgerTransportError extends Error {
  readonly failure: LedgerTransportFailure;

  constructor(failure: LedgerTransportFailure) {
    super(FAILURE_COPY[failure]);
    this.name = "LedgerTransportError";
    this.failure = failure;
  }
}

export function getWebHid(): HidLike | null {
  const hid = (globalThis.navigator as unknown as { hid?: HidLike } | undefined)?.hid;
  return hid ?? null;
}

/** Splits one APDU into 64-byte HID packets: channel, tag, sequence, then a 2-byte length on the first. */
export function frameApdu(apdu: Uint8Array): Uint8Array<ArrayBuffer>[] {
  const payload = new Uint8Array(2 + apdu.byteLength);
  payload[0] = apdu.byteLength >> 8;
  payload[1] = apdu.byteLength & 0xff;
  payload.set(apdu, 2);

  const packets: Uint8Array<ArrayBuffer>[] = [];
  const body = PACKET_SIZE - HEADER_SIZE;
  for (let seq = 0, offset = 0; offset < payload.byteLength; seq += 1, offset += body) {
    const packet = new Uint8Array(new ArrayBuffer(PACKET_SIZE));
    packet[0] = CHANNEL >> 8;
    packet[1] = CHANNEL & 0xff;
    packet[2] = TAG_APDU;
    packet[3] = seq >> 8;
    packet[4] = seq & 0xff;
    packet.set(payload.subarray(offset, offset + body), HEADER_SIZE);
    packets.push(packet);
  }
  return packets;
}

export class WebHidLedgerTransport implements LedgerTransport {
  /** The HID product name, e.g. "Nano S Plus". */
  readonly model: string | undefined;

  private readonly queue: Uint8Array[] = [];
  private waiter: { resolve: (packet: Uint8Array) => void; reject: (error: Error) => void } | null = null;
  private failure: LedgerTransportError | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;

  private readonly onReport = (event: { data: DataView }) => {
    const packet = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength).slice();
    if (this.waiter) {
      const { resolve } = this.waiter;
      this.waiter = null;
      resolve(packet);
    } else {
      this.queue.push(packet);
    }
  };

  private readonly onDisconnect = (event: { device: HidDeviceLike }) => {
    if (event.device === this.device) this.fail(new LedgerTransportError("disconnected"));
  };

  private constructor(
    private readonly device: HidDeviceLike,
    private readonly hid: HidLike | null,
  ) {
    this.model = device.productName || undefined;
  }

  /** Opens the device. Rejects with `busy` when another page or app holds it. */
  static async open(device: HidDeviceLike, hid: HidLike | null = getWebHid()): Promise<WebHidLedgerTransport> {
    if (!device.opened) {
      try {
        await device.open();
      } catch {
        throw new LedgerTransportError("busy");
      }
    }
    const transport = new WebHidLedgerTransport(device, hid);
    device.addEventListener("inputreport", transport.onReport);
    hid?.addEventListener("disconnect", transport.onDisconnect);
    return transport;
  }

  exchange(apdu: Uint8Array): Promise<Uint8Array> {
    const run = this.chain.then(() => this.exchangeNow(apdu));
    this.chain = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.device.removeEventListener("inputreport", this.onReport);
    this.hid?.removeEventListener("disconnect", this.onDisconnect);
    this.fail(new LedgerTransportError("disconnected"));
    try {
      await this.device.close();
    } catch {
      // Already gone (unplugged); nothing left to release.
    }
  }

  private fail(error: LedgerTransportError): void {
    this.failure ??= error;
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(error);
    }
  }

  private nextPacket(): Promise<Uint8Array> {
    if (this.failure) return Promise.reject(this.failure);
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  private async exchangeNow(apdu: Uint8Array): Promise<Uint8Array> {
    if (this.failure) throw this.failure;
    this.queue.length = 0;
    try {
      for (const packet of frameApdu(apdu)) await this.device.sendReport(0, packet);
    } catch {
      throw new LedgerTransportError("disconnected");
    }

    let expected = Infinity;
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (let seq = 0; received < expected; seq += 1) {
      const packet = await this.nextPacket();
      const channel = (packet[0]! << 8) | packet[1]!;
      const sequence = (packet[3]! << 8) | packet[4]!;
      if (packet.byteLength < HEADER_SIZE || channel !== CHANNEL || packet[2] !== TAG_APDU || sequence !== seq) {
        throw new LedgerTransportError("invalid-response");
      }
      let data = packet.subarray(HEADER_SIZE);
      if (seq === 0) {
        expected = (data[0]! << 8) | data[1]!;
        data = data.subarray(2);
      }
      const take = data.subarray(0, Math.min(data.byteLength, expected - received));
      chunks.push(take);
      received += take.byteLength;
    }
    const out = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }
}

/**
 * Connects to a Ledger. Reuses a device the user already granted, so a
 * later connection needs no chooser; otherwise `requestDevice` shows it,
 * which Chrome only allows from a user gesture.
 */
export async function connectLedger(hid: HidLike | null = getWebHid()): Promise<WebHidLedgerTransport> {
  if (!hid) throw new LedgerTransportError("unsupported");
  const granted = await hid.getDevices();
  const ledgers = granted.filter(isLedger);
  let device = ledgers.length === 1 ? ledgers[0] : undefined;
  if (!device) {
    try {
      device = (await hid.requestDevice({ filters: [{ vendorId: LEDGER_VENDOR_ID }] }))[0];
    } catch {
      throw new LedgerTransportError("no-device");
    }
  }
  if (!device) throw new LedgerTransportError("no-device");
  return WebHidLedgerTransport.open(device, hid);
}

function isLedger(device: HidDeviceLike): boolean {
  return device.vendorId === LEDGER_VENDOR_ID;
}
