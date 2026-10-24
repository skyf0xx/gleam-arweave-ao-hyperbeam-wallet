import type { ProviderMethod } from "./method-privileges";
import type { WalletMethod } from "./wallet";

/**
 * What a wallet of a given kind can do. Hardware wallets sign on the
 * device, so anything that needs the private key in Gleam (decrypt,
 * export) is out, and some signing formats depend on what
 * the device firmware supports.
 */
export interface WalletCapabilities {
  /** Sign Arweave L1 transactions: AR sends, dApp `sign`/`dispatch`. */
  signTransaction: boolean;
  /** Let `dispatch` post small data transactions as a bundled data item instead of on L1. */
  dispatchViaBundler: boolean;
  /** Sign ANS-104 data items: AO sends, `signDataItem`, `batchSignDataItem`. */
  signDataItem: boolean;
  /** `signMessage`. A device may support only SHA-256 (see `HARDWARE_MESSAGE_HASH`). */
  signMessage: boolean;
  decrypt: boolean;
  exportKey: boolean;
  /** Encrypt to the wallet's own public key. */
  encrypt: boolean;
  /** Tagged Arweave uploads from the Upload screen. */
  upload: boolean;
  /**
   * Join or leave Gleam Points. A keyfile proves ownership with
   * `signMessage`, a hardware wallet by signing a 0-AR transaction that is
   * never posted (`points/ownership.ts`).
   */
  points: boolean;
}

const KEYFILE: WalletCapabilities = {
  signTransaction: true,
  dispatchViaBundler: true,
  signDataItem: true,
  signMessage: true,
  decrypt: true,
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
  exportKey: false,
  encrypt: false,
  upload: false,
  points: false,
};

const CAPABILITIES: Record<WalletMethod, WalletCapabilities> = {
  jwk: KEYFILE,
  // The Keystone hashes a message and signs the hash, which is
  // `signMessage` with SHA-256.
  keystone: {
    ...NONE,
    signTransaction: true,
    dispatchViaBundler: true,
    signDataItem: true,
    signMessage: true,
    encrypt: true,
    points: true,
  },
  // The Ledger Arweave app has no data-item command, so AO sends and
  // `signDataItem` are off and `dispatch` stays on L1. The client can still
  // sign data items on the experimental Permaweb app; turn this on once
  // Gleam can install it.
  ledger: {
    ...NONE,
    signTransaction: true,
    encrypt: true,
    points: true,
  },
  // Modeled but never produced: no Arweave operation applies.
  ethereum: NONE,
};

/** The only `signMessage` hash a hardware wallet signs with. */
export const HARDWARE_MESSAGE_HASH = "SHA-256";

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
  signMessage: { capability: "signMessage", action: "sign messages" },
  decrypt: { capability: "decrypt", action: "decrypt data" },
  encrypt: { capability: "encrypt", action: "encrypt data" },
};

export function unsupportedOperationMessage(action: string): string {
  return `This wallet can't ${action}. Switch to a keyfile wallet.`;
}

/** Why a wallet of `walletMethod` can't `action`, or null when it has `capability`. */
export function capabilityRefusal(
  walletMethod: WalletMethod,
  capability: keyof WalletCapabilities,
  action: string,
): string | null {
  if (capabilitiesFor(walletMethod)[capability]) return null;
  // A Keystone signs data items, so it's the hardware wallet to point a Ledger user to.
  if (walletMethod === "ledger" && capability === "signDataItem") {
    return `Ledger only supports sending AR for now, so it can't ${action}. Use a Keystone instead.`;
  }
  return unsupportedOperationMessage(action);
}

/**
 * Why a wallet of `walletMethod` can't serve provider `method`, or null
 * when it can (or the method signs nothing).
 */
export function providerMethodRefusal(walletMethod: WalletMethod, method: ProviderMethod): string | null {
  const requirement = PROVIDER_REQUIREMENTS[method];
  return requirement ? capabilityRefusal(walletMethod, requirement.capability, requirement.action) : null;
}
