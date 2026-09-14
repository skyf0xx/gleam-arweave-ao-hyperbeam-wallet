import { getTokenBalance } from "@gleam/core/src/ao/index.ts";
import { getBalance as getArBalance } from "@gleam/core/src/arweave/balance.ts";
import { queryActivityTransactions } from "@gleam/core/src/arweave/graphql.ts";
import { mergeActivity } from "@gleam/core/src/activity/index.ts";
import type {
  ActivityEntry,
  ActivityPage,
  Grant,
  HyperBeamPeer,
  NetworkSettings,
  StoragePort,
  TokenBalance,
  Winston,
} from "@gleam/core";

/**
 * Background-side implementation of `ProtocolMap`'s read methods
 * (`getBalance`/`getTokenBalances`/`getActivity`/`getConnectedApps`) —
 * same constructor-injected-`StoragePort` shape as
 * `WalletLifecycleHandler` (`handlers/wallet-lifecycle.ts`), for the same
 * hexagonal reason: this file knows `StoragePort`'s shape, never
 * `wxt/utils/storage`.
 *
 * Storage schema this handler owns:
 * - `local:networkSettings` — `NetworkSettings`, defaulting to
 *   `arweave.net` with no HyperBEAM peers configured (an AO balance read
 *   with no active peer throws a named "no HyperBEAM peer configured"
 *   error rather than silently returning a zero balance — HONESTY: a
 *   value this handler can't compute is surfaced as unavailable, not as
 *   a plausible default).
 * - `local:activityLog:{address}` — `ActivityEntry[]`, the local
 *   append-only action log `handlers/transfer.ts` writes optimistic
 *   entries into. Read-only from this handler's side; `transfer.ts` owns
 *   writing it. Keyed per-address since the log is scoped to whichever
 *   wallet's activity is being viewed.
 *
 * `getTokenBalances`'s AO process list: `TokenBalance` has no
 * "which processIds does this wallet hold" registry anywhere in `core`'s
 * models or this task's ALLOWED SCOPE — no layer owns a token-list/watch
 * list concept yet. This handler resolves that against
 * `local:watchedProcessIds:{address}` (a simple `string[]` this handler
 * also defaults to empty), which is the least-invented storage key that
 * makes `getTokenBalances` return something rather than nothing; see this
 * task's final report for why a real "add a token" flow isn't included
 * here (out of ALLOWED SCOPE — no popup screen for it was requested by
 * this packet either).
 */
const NETWORK_SETTINGS_KEY = "local:networkSettings";
const ACTIVITY_LOG_KEY_PREFIX = "local:activityLog:";
const WATCHED_PROCESS_IDS_KEY_PREFIX = "local:watchedProcessIds:";
const ACTIVITY_PAGE_LIMIT = 50;

const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  gatewayUrl: "https://arweave.net",
  peers: [],
  activePeerUrl: null,
};

function isValidHyperBeamPeer(value: unknown): value is HyperBeamPeer {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.url === "string" && typeof candidate.enabled === "boolean";
}

function isValidNetworkSettings(value: unknown): value is NetworkSettings {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.gatewayUrl === "string" &&
    Array.isArray(candidate.peers) &&
    candidate.peers.every(isValidHyperBeamPeer) &&
    (candidate.activePeerUrl === null || typeof candidate.activePeerUrl === "string")
  );
}

function isValidActivityEntry(value: unknown): value is ActivityEntry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.txId === "string" &&
    (candidate.type === "send" || candidate.type === "receive" || candidate.type === "upload") &&
    (candidate.status === "pending" ||
      candidate.status === "confirmed" ||
      candidate.status === "failed") &&
    typeof candidate.address === "string" &&
    (candidate.amount === null || typeof candidate.amount === "string") &&
    Array.isArray(candidate.tags) &&
    typeof candidate.timestamp === "number"
  );
}

export class ReadsHandler {
  constructor(private readonly storage: StoragePort) {}

  async loadNetworkSettings(): Promise<NetworkSettings> {
    const raw = await this.storage.get<unknown>(NETWORK_SETTINGS_KEY);
    return isValidNetworkSettings(raw) ? raw : DEFAULT_NETWORK_SETTINGS;
  }

  /**
   * `ProtocolMap.getNetworkSettings`'s backing read — same shape as
   * `loadNetworkSettings` (used internally by `getBalance`/
   * `getTokenBalances`/`getActivity`), exposed under the exact protocol
   * method name so the dispatcher (`entrypoints/background/index.ts`,
   * outside this task's ALLOWED SCOPE — see this task's final report)
   * has a call site to wire `getNetworkSettings` to.
   */
  async getNetworkSettings(): Promise<NetworkSettings> {
    return this.loadNetworkSettings();
  }

  async loadActivityLog(address: string): Promise<ActivityEntry[]> {
    const raw = await this.storage.get<unknown>(`${ACTIVITY_LOG_KEY_PREFIX}${address}`);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidActivityEntry);
  }

  async loadWatchedProcessIds(address: string): Promise<string[]> {
    const raw = await this.storage.get<unknown>(`${WATCHED_PROCESS_IDS_KEY_PREFIX}${address}`);
    if (!Array.isArray(raw)) return [];
    return raw.filter((id): id is string => typeof id === "string");
  }

  async getBalance(req: { address: string }): Promise<Winston> {
    const settings = await this.loadNetworkSettings();
    return getArBalance(req.address, settings.gatewayUrl);
  }

  async getTokenBalances(req: { address: string }): Promise<TokenBalance[]> {
    const settings = await this.loadNetworkSettings();
    const processIds = await this.loadWatchedProcessIds(req.address);

    if (processIds.length === 0) return [];

    if (settings.activePeerUrl === null) {
      throw new Error(
        "No HyperBEAM peer configured. Add one in Network settings to read AO token balances.",
      );
    }

    const activePeerUrl = settings.activePeerUrl;
    return Promise.all(
      processIds.map((processId) => getTokenBalance(processId, req.address, activePeerUrl)),
    );
  }

  async getActivity(req: { address: string; cursor?: string }): Promise<ActivityPage> {
    void req.cursor; // most-recent-N only in this phase — no deeper pagination cursor is implemented yet, see final report.
    const settings = await this.loadNetworkSettings();
    const [localLog, gatewayEntries] = await Promise.all([
      this.loadActivityLog(req.address),
      queryActivityTransactions(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT),
    ]);

    return mergeActivity(localLog, gatewayEntries, ACTIVITY_PAGE_LIMIT);
  }

  /**
   * Stubbed: `Grant`/connected-apps storage doesn't exist yet — no layer
   * before this one owns writing a `Grant` record, and `provider-bridge`
   * (the layer that builds the connection-approval flow that would create
   * one) hasn't been built. Returns an empty array rather than throwing,
   * since "no connected apps yet" is a legitimate, common state this
   * stub's behavior happens to match exactly — but it cannot yet
   * distinguish "no apps connected" from "grants aren't implemented," so
   * `provider-bridge` must replace this method's body (not just add to
   * it) once `Grant` storage is real. See this task's final report.
   */
  async getConnectedApps(): Promise<Grant[]> {
    return [];
  }
}
