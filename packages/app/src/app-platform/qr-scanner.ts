/**
 * - `permission-denied`: the camera is off for the app in the device's settings.
 * - `failed`: the scanner couldn't start or read.
 */
export type QrScanErrorReason = "permission-denied" | "failed";

export class QrScanError extends Error {
  constructor(
    readonly reason: QrScanErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "QrScanError";
  }
}

// Wallets encode an address as a bare string or behind one of these schemes.
const ADDRESS_SCHEME = /^(?:ar:\/\/|arweave:(?:\/\/)?)/i;

/**
 * The text a scanned code puts in an address field. Only the scheme is
 * dropped: anything else a code carries (an amount, a token, a query)
 * stays in the text, so the address check rejects it instead of the app
 * acting on it.
 */
export function addressFromQr(payload: string): string {
  return payload.trim().replace(ADDRESS_SCHEME, "").trim();
}
