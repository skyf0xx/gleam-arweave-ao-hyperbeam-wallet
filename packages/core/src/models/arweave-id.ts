/**
 * An Arweave address, transaction id or AO process id on the wire: 43
 * base64url characters (a 32-byte value). Also the shape of an ECDSA
 * P-256 coordinate. Has no `g` or `y` flag, so `.test` keeps no state.
 */
export const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;

export function isArweaveId(value: string): boolean {
  return ARWEAVE_ID.test(value);
}
