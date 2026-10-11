import { describe, expect, it, vi } from "vitest";
import {
  connectLedger,
  frameApdu,
  LedgerTransportError,
  WebHidLedgerTransport,
  type HidDeviceLike,
  type HidLike,
} from "./webhid-transport";

type Listener = (event: { data: DataView }) => void;

function reportOf(bytes: number[]): { data: DataView } {
  const packet = new Uint8Array(64);
  packet.set(bytes);
  return { data: new DataView(packet.buffer) };
}

/** Packets a device would send back for `data`, framed like Ledger does. */
function replyPackets(data: Uint8Array): { data: DataView }[] {
  const payload = Uint8Array.from([data.length >> 8, data.length & 0xff, ...data]);
  const out: { data: DataView }[] = [];
  for (let seq = 0, at = 0; at < payload.length; seq += 1, at += 59) {
    out.push(reportOf([0x01, 0x01, 0x05, seq >> 8, seq & 0xff, ...payload.subarray(at, at + 59)]));
  }
  return out;
}

function fakeDevice(respond: (sent: Uint8Array[]) => { data: DataView }[] | null, opts: Partial<HidDeviceLike> = {}) {
  const listeners = new Set<Listener>();
  const sent: Uint8Array[] = [];
  const device = {
    opened: false,
    productName: "Nano S Plus",
    vendorId: 0x2c97,
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    sendReport: vi.fn(async (_id: number, data: BufferSource) => {
      sent.push(new Uint8Array(data as ArrayBuffer).slice());
      const reply = respond(sent);
      if (reply) for (const r of reply) for (const l of listeners) l(r);
    }),
    addEventListener: (_t: string, l: Listener) => void listeners.add(l),
    removeEventListener: (_t: string, l: Listener) => void listeners.delete(l),
    ...opts,
  } as unknown as HidDeviceLike;
  return { device, sent, listeners };
}

describe("frameApdu", () => {
  it("prefixes channel, tag, sequence and length, and pads to 64 bytes", () => {
    const [packet, ...rest] = frameApdu(Uint8Array.from([0xb0, 0x01, 0, 0, 0]));
    expect(rest).toEqual([]);
    expect(Array.from(packet!.subarray(0, 9))).toEqual([0x01, 0x01, 0x05, 0, 0, 0, 5, 0xb0, 0x01]);
    expect(packet!.byteLength).toBe(64);
  });

  it("continues a long APDU across numbered packets", () => {
    const apdu = new Uint8Array(200).fill(7);
    const packets = frameApdu(apdu);
    expect(packets).toHaveLength(4);
    expect(Array.from(packets[3]!.subarray(0, 5))).toEqual([0x01, 0x01, 0x05, 0, 3]);
    expect(packets.every((p) => p.byteLength === 64)).toBe(true);
  });
});

describe("WebHidLedgerTransport", () => {
  it("returns data plus the status word, including a non-9000 one", async () => {
    const { device } = fakeDevice(() => replyPackets(Uint8Array.from([0x69, 0x87])));
    const transport = await WebHidLedgerTransport.open(device, null);
    expect(await transport.exchange(Uint8Array.from([0xb0, 1, 0, 0, 0]))).toEqual(Uint8Array.from([0x69, 0x87]));
    expect(transport.model).toBe("Nano S Plus");
    expect(device.open).toHaveBeenCalledOnce();
  });

  it("reassembles a reply that spans several packets", async () => {
    const body = Uint8Array.from({ length: 150 }, (_, i) => i);
    const reply = Uint8Array.from([...body, 0x90, 0x00]);
    const { device } = fakeDevice(() => replyPackets(reply));
    const transport = await WebHidLedgerTransport.open(device, null);
    expect(await transport.exchange(Uint8Array.from([1]))).toEqual(reply);
  });

  it("rejects a packet on the wrong channel", async () => {
    const { device } = fakeDevice(() => [reportOf([0x02, 0x02, 0x05, 0, 0, 0, 2, 0x90, 0])]);
    const transport = await WebHidLedgerTransport.open(device, null);
    await expect(transport.exchange(Uint8Array.from([1]))).rejects.toMatchObject({ failure: "invalid-response" });
  });

  it("reports busy when the device can't be opened", async () => {
    const { device } = fakeDevice(() => null, {
      open: vi.fn().mockRejectedValue(new DOMException("Failed to open the device", "NetworkError")),
    });
    await expect(WebHidLedgerTransport.open(device, null)).rejects.toMatchObject({ failure: "busy" });
  });

  it("fails a pending exchange when the device disconnects, then closes once", async () => {
    const { device } = fakeDevice(() => null);
    let onDisconnect: ((e: { device: HidDeviceLike }) => void) | undefined;
    const hid = {
      addEventListener: (_t: string, l: typeof onDisconnect) => void (onDisconnect = l),
      removeEventListener: vi.fn(),
    } as unknown as HidLike;
    const transport = await WebHidLedgerTransport.open(device, hid);
    const pending = transport.exchange(Uint8Array.from([1]));
    await vi.waitFor(() => expect(device.sendReport).toHaveBeenCalled());
    onDisconnect!({ device });
    await expect(pending).rejects.toMatchObject({ failure: "disconnected" });
    await transport.close();
    await transport.close();
    expect(device.close).toHaveBeenCalledOnce();
  });

  it("stops listening on close", async () => {
    const { device, listeners } = fakeDevice(() => null);
    const transport = await WebHidLedgerTransport.open(device, null);
    expect(listeners.size).toBe(1);
    await transport.close();
    expect(listeners.size).toBe(0);
  });
});

describe("connectLedger", () => {
  const hidOf = (granted: HidDeviceLike[], requested: HidDeviceLike[] | Error): HidLike => ({
    getDevices: async () => granted,
    requestDevice: vi.fn(async () => {
      if (requested instanceof Error) throw requested;
      return requested;
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  it("reuses a single already-granted Ledger without the chooser", async () => {
    const { device } = fakeDevice(() => null);
    const hid = hidOf([device], []);
    await connectLedger(hid);
    expect(hid.requestDevice).not.toHaveBeenCalled();
  });

  it("asks the chooser when nothing was granted", async () => {
    const { device } = fakeDevice(() => null);
    const hid = hidOf([], [device]);
    await connectLedger(hid);
    expect(hid.requestDevice).toHaveBeenCalledWith({ filters: [{ vendorId: 0x2c97 }] });
  });

  it("maps a dismissed chooser to no-device", async () => {
    const hid = hidOf([], new DOMException("No device selected.", "NotFoundError"));
    await expect(connectLedger(hid)).rejects.toBeInstanceOf(LedgerTransportError);
    await expect(connectLedger(hid)).rejects.toMatchObject({ failure: "no-device" });
  });

  it("explains a browser without WebHID", async () => {
    await expect(connectLedger(null)).rejects.toMatchObject({ failure: "unsupported" });
  });
});
