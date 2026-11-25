import { COMMUNITY_HYPERBEAM_PEER_URLS, L1_TOKEN_NODE_URLS, isRecord, type NetworkSettings, type StoragePort, type TimerPort } from "@gleam/core";
import { discoverHyperBeamPeers, findL1TokenNodes, stripTrailingSlashes } from "@gleam/core/src/ao/peer-discovery.ts";
import { updateStored } from "./storage-update";
import { NETWORK_SETTINGS_KEY } from "./storage-keys";

export const DISCOVERED_PEERS_KEY = "local:discoveredPeers";
/** Community or discovered peers the user removed in Network & peers; merging skips them. */
export const DISMISSED_PEERS_KEY = "local:dismissedPeers";
export const PEER_DISCOVERY_ALARM_NAME = "gleam-peer-discovery";

const DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface DiscoveredPeers {
  at: number;
  urls: string[];
  /** The community and discovered peers that compute `arweave-scheduler@1.0` processes (`findL1TokenNodes`). */
  l1Urls?: string[];
  /** The `L1_TOKEN_NODE_URLS` that failed that probe, skipped until one passes. */
  l1Down?: string[];
}

/**
 * `settings` with each discovered node the user doesn't already list, and
 * hasn't removed, appended as enabled. The user's own list keeps its order
 * and its enabled flags, so a peer they turned off stays off.
 */
export function mergeDiscoveredPeers(
  settings: NetworkSettings,
  discovered: DiscoveredPeers | string[] | null,
  dismissed: readonly string[] = [],
): NetworkSettings {
  const urls = Array.isArray(discovered) ? discovered : (discovered?.urls ?? []);
  const known = new Set([...settings.peers.map((peer) => stripTrailingSlashes(peer.url)), ...dismissed]);
  const added = urls.filter((url) => !known.has(url) && (known.add(url), true));
  if (added.length === 0) return settings;
  return { ...settings, peers: [...settings.peers, ...added.map((url) => ({ url, enabled: true }))] };
}

/** The peers merged into every settings read: the shipped community list, then the last discovery result. */
export async function readExtraPeerUrls(storage: StoragePort): Promise<string[]> {
  const discovered = await readDiscoveredPeers(storage);
  return [...COMMUNITY_HYPERBEAM_PEER_URLS, ...(discovered?.urls ?? [])];
}

/** Community or discovered peers the user has removed. */
function dismissedPeersOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((url): url is string => typeof url === "string") : [];
}

export async function readDismissedPeers(storage: StoragePort): Promise<string[]> {
  try {
    return dismissedPeersOf(await storage.get<unknown>(DISMISSED_PEERS_KEY));
  } catch {
    return [];
  }
}

/**
 * Saves the settings Network & peers sends back. That screen shows the
 * community and discovered peers merged in, so one missing from `next` was
 * removed by the user and is remembered as dismissed, or the merge would
 * add it back.
 */
export async function saveNetworkSettings(storage: StoragePort, next: NetworkSettings): Promise<void> {
  const kept = new Set(next.peers.map((peer) => stripTrailingSlashes(peer.url)));
  // Saving writes the merged peers into the stored list, so a peer can
  // outlive the discovery result that brought it. Counting the stored list
  // too keeps its removal from being undone when discovery finds it again.
  const shown = [...(await readStoredPeerUrls(storage)), ...(await readExtraPeerUrls(storage))];
  const removed = [...new Set(shown)].filter((url) => !kept.has(url));
  if (removed.length > 0) {
    await updateStored(storage, DISMISSED_PEERS_KEY, (raw) => [...new Set([...dismissedPeersOf(raw), ...removed])]);
  }
  // A whole-value write, queued behind the other updates of this key.
  await updateStored(storage, NETWORK_SETTINGS_KEY, () => next);
}

/** The stored peers with their URLs trimmed of trailing slashes; whatever isn't a peer record is skipped. */
async function storedPeers(storage: StoragePort): Promise<Array<{ url: string; enabled: unknown }>> {
  try {
    const raw = await storage.get<{ peers?: unknown }>(NETWORK_SETTINGS_KEY);
    if (!Array.isArray(raw?.peers)) return [];
    return raw.peers.flatMap((peer: unknown) =>
      isRecord(peer) && typeof peer.url === "string" ? [{ url: stripTrailingSlashes(peer.url), enabled: peer.enabled }] : [],
    );
  } catch {
    return [];
  }
}

async function readStoredPeerUrls(storage: StoragePort): Promise<string[]> {
  return (await storedPeers(storage)).map((peer) => peer.url);
}

function httpsUrls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string" && url.startsWith("https://")) : [];
}

/** Peers the user turned off in Network & peers. */
async function readDisabledPeerUrls(storage: StoragePort): Promise<string[]> {
  return (await storedPeers(storage)).filter((peer) => peer.enabled === false).map((peer) => peer.url);
}

/**
 * Where L1 token reads go besides the gateway: the `L1_TOKEN_NODE_URLS`
 * that passed the last probe, then the peers it found serving them, less
 * any the user removed or turned off. With none of those left, the shipped
 * nodes the user kept, even ones the probe found down. That can be none:
 * the reads still ask the gateway and the active peer.
 */
export async function readL1NodeUrls(storage: StoragePort): Promise<string[]> {
  const [stored, dismissed, disabled] = await Promise.all([
    readDiscoveredPeers(storage),
    readDismissedPeers(storage),
    readDisabledPeerUrls(storage),
  ]);
  const refused = new Set([...dismissed, ...disabled]);
  const kept = (url: string) => !refused.has(stripTrailingSlashes(url));
  const down = new Set(httpsUrls(stored?.l1Down));
  const urls = [...new Set([...L1_TOKEN_NODE_URLS, ...httpsUrls(stored?.l1Urls)])].filter(
    (url) => kept(url) && !down.has(stripTrailingSlashes(url)),
  );
  return urls.length > 0 ? urls : L1_TOKEN_NODE_URLS.filter(kept);
}

/** Reads the last discovery result, if any. */
export async function readDiscoveredPeers(storage: StoragePort): Promise<DiscoveredPeers | null> {
  try {
    return await storage.get<DiscoveredPeers>(DISCOVERED_PEERS_KEY);
  } catch {
    return null;
  }
}

/**
 * Re-runs discovery, and the L1 probe over the shipped L1 nodes and the
 * community and discovered peers, when the stored result is over a day
 * old. An empty result never overwrites a non-empty one, so an outage
 * doesn't wipe either list.
 */
export async function refreshDiscoveredPeersIfDue(
  storage: StoragePort,
  gatewayUrl: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<void> {
  try {
    const existing = await readDiscoveredPeers(storage);
    if (existing && now() - existing.at < DISCOVERY_INTERVAL_MS) return;
    const found = await discoverHyperBeamPeers({ gatewayUrl: await gatewayUrl(), fetchImpl });
    const urls = found.length === 0 && existing && existing.urls.length > 0 ? existing.urls : found;
    const shipped = new Set(L1_TOKEN_NODE_URLS);
    const passed = await findL1TokenNodes({ candidates: [...L1_TOKEN_NODE_URLS, ...COMMUNITY_HYPERBEAM_PEER_URLS, ...urls], fetchImpl });
    // Nothing passing, the shipped nodes included, is this device offline,
    // not every node down: keep the last probe's answer.
    const probed = passed.length > 0;
    const l1Urls = probed ? passed.filter((url) => !shipped.has(url)) : (existing?.l1Urls ?? []);
    const l1Down = probed ? L1_TOKEN_NODE_URLS.filter((url) => !passed.includes(url)) : (existing?.l1Down ?? []);
    if (found.length === 0 && !probed && existing) return;
    // eslint-disable-next-line gleam/no-storage-read-modify-write -- a cache fill from the network
    await storage.set<DiscoveredPeers>(DISCOVERED_PEERS_KEY, { at: now(), urls, l1Urls, l1Down });
  } catch (error) {
    console.error("HyperBEAM peer discovery failed:", error);
  }
}

/** Checks hourly and on start; `refreshDiscoveredPeersIfDue` limits real runs to once a day. */
export function registerPeerDiscoveryAlarm(storage: StoragePort, timer: TimerPort, gatewayUrl: () => Promise<string>): void {
  timer.every(PEER_DISCOVERY_ALARM_NAME, 60, () => {
    void refreshDiscoveredPeersIfDue(storage, gatewayUrl);
  });
  void refreshDiscoveredPeersIfDue(storage, gatewayUrl);
}
