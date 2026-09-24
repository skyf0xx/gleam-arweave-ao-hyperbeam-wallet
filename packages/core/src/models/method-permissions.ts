import type { ProviderMethod } from "./method-privileges";
import type { PermissionType } from "./permission";

/**
 * The grant permissions each provider method needs, all of them required.
 * Matches Wander's module table. `connect`, `disconnect` and
 * `getPermissions` need none: they manage or report the grant itself.
 * `transferAoTokens` is Gleam's own method; it signs an ANS-104 item, so it
 * sits with `signDataItem` under `SIGN_TRANSACTION`.
 */
export const METHOD_PERMISSIONS: Readonly<Record<ProviderMethod, readonly PermissionType[]>> = {
  connect: [],
  disconnect: [],
  getPermissions: [],
  getActiveAddress: ["ACCESS_ADDRESS"],
  getAllAddresses: ["ACCESS_ALL_ADDRESSES"],
  getWalletNames: ["ACCESS_ALL_ADDRESSES"],
  getActivePublicKey: ["ACCESS_PUBLIC_KEY"],
  getArweaveConfig: ["ACCESS_ARWEAVE_CONFIG"],
  getBalances: ["ACCESS_ADDRESS", "ACCESS_TOKENS"],
  sign: ["SIGN_TRANSACTION"],
  dispatch: ["DISPATCH"],
  encrypt: ["ENCRYPT"],
  decrypt: ["DECRYPT"],
  signature: ["SIGNATURE"],
  signMessage: ["SIGNATURE"],
  privateHash: ["SIGNATURE"],
  verifyMessage: ["SIGNATURE"],
  signDataItem: ["SIGN_TRANSACTION"],
  batchSignDataItem: ["SIGN_TRANSACTION"],
  transferAoTokens: ["SIGN_TRANSACTION"],
  tokenBalance: ["ACCESS_TOKENS"],
  userTokens: ["ACCESS_TOKENS"],
};

/** The permissions `method` needs that `granted` lacks, in table order. */
export function missingPermissions(
  method: ProviderMethod,
  granted: readonly PermissionType[],
): PermissionType[] {
  return METHOD_PERMISSIONS[method].filter((permission) => !granted.includes(permission));
}
