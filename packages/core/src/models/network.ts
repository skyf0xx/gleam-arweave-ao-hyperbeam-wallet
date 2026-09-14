export interface HyperBeamPeer {
  url: string;
  enabled: boolean;
}

/**
 * The configured Arweave gateway and list of AO-Core/HyperBEAM peer URLs
 * (PRD §3 Glossary — NetworkSettings).
 */
export interface NetworkSettings {
  gatewayUrl: string;
  peers: HyperBeamPeer[];
  /** URL of the currently active peer, or `null` if none is selected. */
  activePeerUrl: string | null;
}
