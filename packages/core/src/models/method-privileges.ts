/**
 * The three privilege tiers over `ProtocolMap` methods. Modeled here, in
 * `core/models`, because `messaging/src/protocol.ts` references these
 * sets when typing `ProtocolMap`, and `messaging` depends on
 * `core/models`, never the reverse.
 *
 * Enforcing the boundary — routing a page-originated message through
 * `PROVIDER_METHODS` only, at a single dispatcher choke point — is the
 * background dispatcher's job, outside this layer's scope.
 */

/** Reachable from a web page via the injected provider. */
export const PROVIDER_METHODS = [
  "connect",
  "disconnect",
  "getPermissions",
  "getActiveAddress",
  "getAllAddresses",
  "getActivePublicKey",
  "getWalletNames",
  "getArweaveConfig",
  "getBalances",
  "sign",
  "dispatch",
  "encrypt",
  "decrypt",
  "signMessage",
  "verifyMessage",
  "signDataItem",
  "batchSignDataItem",
  "transferAoTokens",
  "tokenBalance",
  "userTokens",
  "addToken",
  "isTokenAdded",
] as const;

/**
 * Methods `window.arweaveWallet` still defines, so a dApp gets a clear
 * error instead of `undefined`, but that the background refuses before
 * any grant check or approval window. `privateHash` digests the private
 * exponent's text, which non-extractable session keys can't provide.
 * `signature` signs dApp-chosen bytes raw, so a site could pass a hash it
 * computed and get a `signMessage`, transaction or Gleam Points signature
 * no preview could reveal.
 */
export const REFUSED_PROVIDER_METHODS = {
  privateHash: "privateHash is not supported. Use encrypt/decrypt instead.",
  signature: "signature is not supported. Use signMessage or signDataItem instead.",
} as const;

/** Reachable only from the approval window. */
export const APPROVAL_METHODS = ["getApproval", "resolveApproval", "submitDeviceSignature", "deviceActivity"] as const;

/** Reachable only from trusted extension UI, never a page. */
export const KEY_METHODS = [
  "createWallet",
  "importWallet",
  "downloadKeyfile",
  "cancelKeyfileDownload",
  "addHardwareWallet",
  "resetAllWallets",
  "enrollPasskey",
] as const;

export type ProviderMethod = (typeof PROVIDER_METHODS)[number];
export type RefusedProviderMethod = keyof typeof REFUSED_PROVIDER_METHODS;
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];
export type KeyMethod = (typeof KEY_METHODS)[number];
