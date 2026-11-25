import { discoverCollectibles } from "@gleam/core/src/ao/index.ts";
import { z } from "zod";
import { peerFailoverOrder, withPeerFailover } from "@gleam/core/src/ao/peer-failover.ts";
import type { Collectible, NetworkSettings, StoragePort } from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { loadActivityLog } from "../stored-data";
import { readL1NodeUrls } from "../peers";
import { updateStored } from "../storage-update";
import { schemaGuard } from "../schema-guard";

export const COLLECTIBLES_KEY_PREFIX = "local:collectibles:";
// Holdings change rarely and discovery is dozens of requests, so a popup
// open within this window reuses the last result.
/**
 * How long a discovered list is reused. The popup shows its own copy while
 * a rediscovery runs, so a short life costs no wait. Holdings changes the
 * wallet can see (a receive, a send or order settling) mark it stale sooner.
 */
const COLLECTIBLES_TTL_MS = 90 * 1000;

export interface CollectiblesCache {
  savedAt: number;
  collectibles: Collectible[];
  /** The gateway and peer it was read from; a list read elsewhere is stale. */
  source?: string;
}

function collectiblesSource(settings: NetworkSettings): string {
  return `${settings.gatewayUrl} ${settings.activePeerUrl ?? ""}`;
}

const cachedCollectibleSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentType: z.string().optional(),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  description: z.string().optional(),
  collectionId: z.string().optional(),
  collectionName: z.string().optional(),
  permawebName: z.object({ label: z.string(), target: z.string().optional(), listed: z.literal(true).optional() }).optional(),
});

export const isCollectiblesCache = schemaGuard<CollectiblesCache>(
  z.object({ savedAt: z.number(), source: z.string().optional(), collectibles: z.array(cachedCollectibleSchema) }),
);

/** Cached discovery of what a wallet holds. */
export class CollectiblesReads {
  private readonly inFlight = new Map<string, Promise<Collectible[]>>();

  constructor(
    private readonly storage: StoragePort,
    private readonly loadSettings: () => Promise<NetworkSettings>,
  ) {}

  /**
   * Cached per wallet in `local:collectibles:{address}`. A failed
   * rediscovery serves the stale cache instead of an error; with no cache
   * it throws, so the popup can show its error state. Concurrent calls for
   * one wallet share one discovery.
   */
  async get(req: { address: string; refresh?: boolean }): Promise<Collectible[]> {
    const key = `${COLLECTIBLES_KEY_PREFIX}${req.address}`;
    const raw = await this.storage.get<unknown>(key);
    const cached = isCollectiblesCache(raw) ? raw : null;
    const source = collectiblesSource(await this.loadSettings());
    if (cached && req.refresh !== true && cached.source === source && Date.now() - cached.savedAt < COLLECTIBLES_TTL_MS) {
      return cached.collectibles;
    }

    const running = this.inFlight.get(req.address);
    if (running) return running;

    const run = (async () => {
      try {
        const settings = await this.loadSettings();
        if (settings.activePeerUrl === null) {
          throw new Error(userErrorMessage("noPeerConfigured"));
        }
        const l1NodeUrls = await readL1NodeUrls(this.storage);
        const discovered = await withPeerFailover(peerFailoverOrder(settings), (peerUrl) =>
          discoverCollectibles({ address: req.address, gatewayUrl: settings.gatewayUrl, peerUrl, l1NodeUrls }),
        );
        // A send still pending hasn't reached the asset yet, so its balance
        // reads as held. It stays off the list until the send settles.
        const sending = new Set(
          (await loadActivityLog(this.storage, req.address)).flatMap((entry) =>
            entry.type === "send" && entry.status === "pending" && entry.collectible ? [entry.collectible.id] : [],
          ),
        );
        const collectibles = discovered.filter((collectible) => !sending.has(collectible.id));
        // Queued behind forgetCollectible, which updates the same cache.
        await updateStored<CollectiblesCache>(this.storage, key, () => ({
          savedAt: Date.now(),
          collectibles,
          source: collectiblesSource(settings),
        }));
        return collectibles;
      } catch (error) {
        if (cached) return cached.collectibles;
        throw error;
      } finally {
        this.inFlight.delete(req.address);
      }
    })();
    this.inFlight.set(req.address, run);
    return run;
  }

  /**
   * Drops a collectible the wallet just sent from its cache. Its balance
   * only moves once the asset process reads the L1 transaction, so a
   * rediscovery right after the send would still list it.
   */
  async forget(req: { address: string; id: string }): Promise<void> {
    await updateStored<CollectiblesCache>(this.storage, `${COLLECTIBLES_KEY_PREFIX}${req.address}`, (raw) =>
      isCollectiblesCache(raw)
        ? { ...raw, collectibles: raw.collectibles.filter((collectible) => collectible.id !== req.id) }
        : undefined,
    );
  }

  /**
   * Points a cached name at the target its accepted `set` names. The
   * carrier reads the set once the transaction is mined, so a rediscovery
   * meanwhile still reads the old target.
   */
  async setCachedNameTarget(req: { address: string; id: string; target: string }): Promise<void> {
    await updateStored<CollectiblesCache>(this.storage, `${COLLECTIBLES_KEY_PREFIX}${req.address}`, (raw) =>
      isCollectiblesCache(raw)
        ? {
            ...raw,
            collectibles: raw.collectibles.map((collectible) =>
              collectible.id === req.id && collectible.permawebName
                ? { ...collectible, permawebName: { ...collectible.permawebName, target: req.target } }
                : collectible,
            ),
          }
        : undefined,
    );
  }

  /** Makes the next `getCollectibles` rediscover, keeping the list to show meanwhile. */
  async markStale(address: string): Promise<void> {
    await updateStored<CollectiblesCache>(this.storage, `${COLLECTIBLES_KEY_PREFIX}${address}`, (current) =>
      isCollectiblesCache(current) ? { ...current, savedAt: 0 } : undefined,
    );
  }
}
