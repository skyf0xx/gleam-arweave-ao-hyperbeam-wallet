import type { ProviderSurfaceMethod } from "@gleam/messaging/src/page-protocol.ts";

/** Another wallet on the page, as `PageOtherWalletEnvelope` reports it. */
export interface OtherWalletReport {
  walletName: string;
  used: boolean;
  permissions?: string[];
}

/**
 * How the page-world provider reaches the wallet. The extension relays
 * through its content script (`createWindowMessageTransport`); a native
 * dApp browser would implement this over its own message channel.
 *
 * A transport never adds an origin to what it sends. The wallet takes the
 * origin from whoever delivered the message (Chrome's `sender`, or the
 * native host's view of the frame), so a page can't claim to be another
 * site.
 */
export interface ProviderTransport {
  /**
   * Sends one call and settles with its result, or rejects with the
   * wallet's error. `params` and the result are JSON-safe: binary values
   * travel as `TaggedBinary`. Throwing or rejecting at once means nothing
   * was sent.
   *
   * `signal` aborts when the provider gives up on the call (its timeout or
   * the dApp's own abort). The transport then forgets the call, and must
   * not send anything else for it: there is no cancel message.
   */
  request(method: ProviderSurfaceMethod, params: unknown, signal: AbortSignal): Promise<unknown>;
  /** Wallet-pushed events (`PROVIDER_EVENT`). Returns an unsubscribe. */
  onEvent(listener: (event: string, data: unknown) => void): () => void;
  /** Asks whether this site uses Gleam over another wallet on the page. The answer arrives through `onSiteMode`. */
  requestSiteMode(): void;
  /** Returns an unsubscribe. */
  onSiteMode(listener: (useGleam: boolean) => void): () => void;
  reportOtherWallet(report: OtherWalletReport): void;
}
