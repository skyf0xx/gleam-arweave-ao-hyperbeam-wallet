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
  "signature",
  "signMessage",
  "privateHash",
  "verifyMessage",
  "signDataItem",
  "batchSignDataItem",
  "transferAoTokens",
  "tokenBalance",
  "userTokens",
] as const;

/** Reachable only from the approval window. */
export const APPROVAL_METHODS = ["getApproval", "resolveApproval"] as const;

/** Reachable only from trusted extension UI, never a page. */
export const KEY_METHODS = [
  "createWallet",
  "importWallet",
  "exportWallet",
  "addLedgerWallet",
  "resetAllWallets",
] as const;

export type ProviderMethod = (typeof PROVIDER_METHODS)[number];
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];
export type KeyMethod = (typeof KEY_METHODS)[number];
