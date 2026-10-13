import { bytesToBase64Url } from "@gleam/core";
import { ArweaveCryptoAccount } from "@keystonehq/bc-ur-registry-arweave";

export const KEYSTONE_ACCOUNT_UR_TYPE = "arweave-crypto-account";

export interface KeystoneAccount {
  /** Base64url RSA modulus, the form `addHardwareWallet` takes. */
  publicKey: string;
  /** Master fingerprint, 8 lowercase hex characters. */
  xfp: string;
}

export class WrongKeystoneQrError extends Error {
  constructor(type: string) {
    super(`Expected an "${KEYSTONE_ACCOUNT_UR_TYPE}" QR, got "${type}".`);
    this.name = "WrongKeystoneQrError";
  }
}

/** Reads the account a Keystone shows as an `arweave-crypto-account` UR. */
export function decodeKeystoneAccount(ur: { type: string; cbor: Buffer }): KeystoneAccount {
  if (ur.type !== KEYSTONE_ACCOUNT_UR_TYPE) throw new WrongKeystoneQrError(ur.type);
  const account = ArweaveCryptoAccount.fromCBOR(ur.cbor);
  return {
    publicKey: bytesToBase64Url(account.getKeyData()),
    xfp: account.getMasterFingerprint().toString("hex"),
  };
}
