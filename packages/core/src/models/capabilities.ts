import type { ProviderMethod } from "./method-privileges";
import type { WalletMethod } from "./wallet";

/**
 * What a wallet of a given kind can do. Hardware wallets sign on the
 * device, so anything that needs the private key in Gleam (decrypt,
 * privateHash, export) is out, and some signing formats depend on what
 * the device firmware supports.
 */
export interface WalletCapabilities {
  /** Sign Arweave L1 transactions: AR sends, dApp `sign`/`dispatch`. */
  signTransaction: boolean;
  /** Let `dispatch` post small data transactions as a bundled data item instead of on L1. */
  dispatchViaBundler: boolean;
  /** Sign ANS-104 data items: AO sends, `signDataItem`, `batchSignDataItem`. */
  signDataItem: boolean;
  /** Sign arbitrary bytes: `signMessage`, `signature`. */
  signMessage: boolean;
  decrypt: boolean;
  privateHash: boolean;
  exportKey: boolean;
  /** Encrypt to the wallet's own public key. */
  encrypt: boolean;
  /** Tagged Arweave uploads from the Upload screen. */
  upload: boolean;
  /** Join or leave Gleam Points, which signs with `signMessage` and the keyfile's owner. */
  points: boolean;
}

const KEYFILE: WalletCapabilities = {
  signTransaction: true,
  dispatchViaBundler: true,
  signDataItem: true,
  signMessage: true,
  decrypt: true,
  privateHash: true,
  exportKey: true,
  encrypt: true,
  upload: true,
  points: true,
};

const NONE: WalletCapabilities = {
  signTransaction: false,
  dispatchViaBundler: false,
  signDataItem: false,
  signMessage: false,
  decrypt: false,
  privateHash: false,
  exportKey: false,
  encrypt: false,
  upload: false,
  points: false,
};

const CAPABILITIES: Record<WalletMethod, WalletCapabilities> = {
  jwk: KEYFILE,
  // Message signing stays off until it is confirmed on a device.
  keystone: {
    ...NONE,
    signTransaction: true,
    dispatchViaBundler: true,
    signDataItem: true,
    encrypt: true,
  },
  // Data items sign only on the Permaweb device app, which the device
  // reports at signing time, so they are allowed here. The Arweave app
  // can't sign them, so `dispatch` must stay on L1.
  ledger: {
    ...NONE,
    signTransaction: true,
    signDataItem: true,
    encrypt: true,
  },
  // Modeled but never produced: no Arweave operation applies.
  ethereum: NONE,
};

export function capabilitiesFor(method: WalletMethod): WalletCapabilities {
  return CAPABILITIES[method];
}

type ProviderCapability = Exclude<keyof WalletCapabilities, "dispatchViaBundler" | "exportKey" | "upload" | "points">;

/** The capability each signing provider method needs, and how to name it to the user. */
const PROVIDER_REQUIREMENTS: Partial<Record<ProviderMethod, { capability: ProviderCapability; action: string }>> = {
  sign: { capability: "signTransaction", action: "sign transactions" },
  dispatch: { capability: "signTransaction", action: "send transactions" },
  signDataItem: { capability: "signDataItem", action: "sign data items" },
  batchSignDataItem: { capability: "signDataItem", action: "sign data items" },
  transferAoTokens: { capability: "signDataItem", action: "send AO tokens" },
  signature: { capability: "signMessage", action: "sign messages" },
  signMessage: { capability: "signMessage", action: "sign messages" },
  decrypt: { capability: "decrypt", action: "decrypt data" },
  privateHash: { capability: "privateHash", action: "create private hashes" },
  encrypt: { capability: "encrypt", action: "encrypt data" },
};

export function unsupportedOperationMessage(action: string): string {
  return `This wallet can't ${action}. Switch to a keyfile wallet.`;
}

/**
 * Why a wallet of `walletMethod` can't serve provider `method`, or null
 * when it can (or the method signs nothing).
 */
export function providerMethodRefusal(walletMethod: WalletMethod, method: ProviderMethod): string | null {
  const requirement = PROVIDER_REQUIREMENTS[method];
  if (!requirement || capabilitiesFor(walletMethod)[requirement.capability]) return null;
  return unsupportedOperationMessage(requirement.action);
}
