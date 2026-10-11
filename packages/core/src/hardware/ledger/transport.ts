/**
 * A connection to a Ledger device, implemented by the extension's
 * WebHID adapter. `core` only frames and parses APDUs; the adapter owns
 * HID packet framing, device selection and permissions.
 */
export interface LedgerTransport {
  /**
   * Sends one raw command APDU (CLA, INS, P1, P2, Lc, data) and resolves
   * with the device's full reply: the response data followed by the
   * 2-byte status word. Rejects only on a transport failure, never on a
   * non-0x9000 status word.
   */
  exchange(apdu: Uint8Array): Promise<Uint8Array>;
  close(): Promise<void>;
}
