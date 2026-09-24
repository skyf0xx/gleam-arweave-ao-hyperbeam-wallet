export interface HyperBeamPeer {
  url: string;
  enabled: boolean;
}

/** The configured Arweave gateway and list of AO-Core/HyperBEAM peer URLs. */
export interface NetworkSettings {
  gatewayUrl: string;
  peers: HyperBeamPeer[];
  /** URL of the currently active peer, or `null` if none is selected. */
  activePeerUrl: string | null;
}

/**
 * HyperBEAM peers shipped with the wallet so AO balance reads work out of
 * the box, with no user setup. Granted statically in the extension's
 * `host_permissions` (apps/extension/wxt.config.ts must list the same
 * origins — build config can't import this package, so keep the two in
 * sync by hand) rather than through the runtime `chrome.permissions.request`
 * flow a user-added peer goes through.
 *
 * These peers must never be removable from Network & peers settings, only
 * disabled — see NetworkPeersView's use of this constant — or a user could
 * end up back at the "no peer configured" state this default exists to
 * prevent.
 */
export const DEFAULT_HYPERBEAM_PEER_URLS: readonly string[] = ["https://state.forward.computer"];

/**
 * ANS-104 bundler that uploads and bundled `dispatch` items are posted to.
 * Also listed in apps/extension/wxt.config.ts's `host_permissions`.
 */
export const DEFAULT_BUNDLER_URL = "https://up.arweave.net";
