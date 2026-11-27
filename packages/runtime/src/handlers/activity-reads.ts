import { getTransferOutcome, readTokenSwapHeight } from "@gleam/core/src/ao/index.ts";
import { COLLECTIBLE_TRANSFER_QUANTITY } from "@gleam/core/src/ao/collectible-transfer.ts";
import { queryActivityTransactions, queryBlockHeights, queryAoTransferActivity, queryL1TokenReceipts } from "@gleam/core/src/arweave/graphql.ts";
import { mergeActivity } from "@gleam/core/src/activity/index.ts";
import type {
  ActivityEntry,
  ActivityPage,
  CollectibleRef,
  NetworkSettings,
  PendingTransfer,
  StoragePort,
  TimerPort,
  TokenTransport,
} from "@gleam/core";
import { activityLogKey, loadActivityLog, loadWallets, parseActivityLog } from "../stored-data";
import { readL1NodeUrls } from "../peers";
import { updateStored } from "../storage-update";
import { COLLECTIBLES_KEY_PREFIX, isCollectiblesCache, type CollectiblesReads } from "./collectibles-reads";
import {
  DISCOVERED_TOKENS_KEY_PREFIX,
  TOKEN_METADATA_KEY_PREFIX,
  isDiscoveredTokensCache,
  isValidTokenMetadata,
  loadHiddenProcessIds,
  loadWatchedProcessIds,
  readBalance,
  tryTokenMetadata,
} from "./token-reads";

// A transaction's anchor block expires after about 100 minutes, so one
// still unmined past this can never land.
const NEVER_MINED_MS = 2 * 60 * 60 * 1000;
const NEVER_MINED_ERROR = "This send never reached a block, so nothing moved.";
/** Each unconfirmed receipt can cost a metadata and a balance read. */
const MAX_COLLECTIBLE_RECEIPTS = 10;
const ACTIVITY_PAGE_LIMIT = 50;

function settle<T>(promise: Promise<T>): Promise<{ ok: true; entries: T } | { ok: false; error: unknown }> {
  return promise.then(
    (entries) => ({ ok: true as const, entries }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/** The activity feed, and what is still in flight in it. */
export class ActivityReads {
  constructor(
    private readonly storage: StoragePort,
    private readonly loadSettings: () => Promise<NetworkSettings>,
    private readonly collectibles: CollectiblesReads,
  ) {}

  async getActivity(req: { address: string; cursor?: string }): Promise<ActivityPage> {
    void req.cursor; // most-recent-N only — no deeper pagination cursor is implemented yet.
    const settings = await this.loadSettings();
    const [localLog, arResult, aoResult, l1Receipts] = await Promise.all([
      loadActivityLog(this.storage, req.address),
      settle(queryActivityTransactions(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT)),
      settle(queryAoTransferActivity(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT)),
      // Receipts are extra detail; a failed query shouldn't blank the feed.
      queryL1TokenReceipts(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT).catch(() => []),
    ]);
    // A gateway slow on one query still answers the other. The local log
    // keeps every send this wallet made, so a page short one source is
    // still right about those; only when both fail is there nothing to add.
    if (!arResult.ok && !aoResult.ok) throw arResult.error;
    const arEntries = arResult.ok ? arResult.entries : [];
    const aoEntries = aoResult.ok ? aoResult.entries : [];
    const [receipts, collectibleReceipts] = await Promise.all([
      this.receiptsForListedTokens(req.address, l1Receipts, settings),
      this.heldCollectibleReceipts(req.address, l1Receipts, settings),
    ]);
    const gatewayEntries = [
      ...(await this.resolveSingleUnitTransfers([...arEntries, ...aoEntries], settings)),
      ...receipts,
      ...collectibleReceipts,
    ];

    return mergeActivity(localLog, gatewayEntries, ACTIVITY_PAGE_LIMIT);
  }

  /**
   * An L1 receipt is anyone's claim, so one is kept only for a token the
   * user already lists (watched, or discovered and not hidden) whose
   * spawn tags make it a fungible `arweave-scheduler@1.0` token. Reads
   * only cached discovery, never starting one.
   */
  private async receiptsForListedTokens(
    address: string,
    receipts: ActivityEntry[],
    settings: NetworkSettings,
  ): Promise<ActivityEntry[]> {
    if (receipts.length === 0) return [];
    const [watched, hidden, rawDiscovered] = await Promise.all([
      loadWatchedProcessIds(this.storage, address),
      loadHiddenProcessIds(this.storage, address),
      this.storage.get<unknown>(`${DISCOVERED_TOKENS_KEY_PREFIX}${address}`),
    ]);
    const discovered = isDiscoveredTokensCache(rawDiscovered) ? rawDiscovered.processIds : [];
    const listed = new Set([...watched, ...discovered].filter((id) => !hidden.includes(id)));
    const tokens = [...new Set(receipts.flatMap((entry) => (entry.token && listed.has(entry.token) ? [entry.token] : [])))];
    const fungible = new Set<string>();
    await Promise.all(
      tokens.map(async (id) => {
        const metadata = await tryTokenMetadata(this.storage, id, settings);
        if (metadata?.transport === "l1" && metadata.assetClass === "fungible") fungible.add(id);
      }),
    );
    return receipts.filter((entry) => entry.token && fungible.has(entry.token));
  }

  /**
   * L1 receipts of a collectible the wallet holds now, as collectible
   * receives. A receipt is anyone's claim, so one counts only for an asset
   * whose spawn tags make it unique and whose balance this wallet holds:
   * the cached collectibles, else a balance read, for the newest receipt
   * of each asset and at most `MAX_COLLECTIBLE_RECEIPTS` of them.
   */
  private async heldCollectibleReceipts(
    address: string,
    receipts: ActivityEntry[],
    settings: NetworkSettings,
  ): Promise<ActivityEntry[]> {
    const newest = new Map<string, ActivityEntry>();
    for (const entry of receipts) {
      if (entry.token && entry.amount === COLLECTIBLE_TRANSFER_QUANTITY && !newest.has(entry.token)) newest.set(entry.token, entry);
    }
    if (newest.size === 0) return [];
    const raw = await this.storage.get<unknown>(`${COLLECTIBLES_KEY_PREFIX}${address}`);
    const cached = new Map((isCollectiblesCache(raw) ? raw.collectibles : []).map((collectible) => [collectible.id, collectible]));
    const held = await Promise.all(
      [...newest.values()].slice(0, MAX_COLLECTIBLE_RECEIPTS).map(async (entry): Promise<ActivityEntry | null> => {
        const id = entry.token!;
        const metadata = await tryTokenMetadata(this.storage, id, settings);
        if (metadata?.transport !== "l1" || metadata.assetClass !== "unique") return null;
        const known = cached.get(id);
        if (!known) {
          const quantity = await readBalance(this.storage, settings, { processId: id, address, transport: "l1" }).catch(() => "0");
          if (BigInt(quantity) === 0n) return null;
        }
        const collectible: CollectibleRef = known
          ? { id, name: known.name, ...(known.imageUrl ? { imageUrl: known.imageUrl } : {}) }
          : { id, ...(metadata.name ? { name: metadata.name } : {}) };
        return {
          txId: entry.txId,
          type: "receive",
          status: entry.status,
          address: entry.address,
          amount: null,
          tags: entry.tags,
          timestamp: entry.timestamp,
          collectible,
          // Holding the asset doesn't show this receipt's sender moved it.
          ...(entry.unverified ? { unverified: true as const } : {}),
        };
      }),
    );
    const received = held.filter((entry): entry is ActivityEntry => entry !== null);
    // The cached list predates this receive.
    if (received.some((entry) => !cached.has(entry.collectible!.id))) await this.collectibles.markStale(address);
    return received;
  }

  /**
   * The gateway parser reads the wallet's own L1 transfer of exactly 1
   * unit as a collectible send. Where the process's spawn tags say it is
   * a fungible token, the entry becomes a 1-unit token send instead.
   */
  private async resolveSingleUnitTransfers(entries: ActivityEntry[], settings: NetworkSettings): Promise<ActivityEntry[]> {
    const ids = [...new Set(entries.flatMap((entry) => (entry.collectible && !entry.token ? [entry.collectible.id] : [])))];
    if (ids.length === 0) return entries;
    const fungible = new Set<string>();
    await Promise.all(
      ids.map(async (id) => {
        const metadata = await tryTokenMetadata(this.storage, id, settings);
        if (metadata?.assetClass === "fungible") fungible.add(id);
      }),
    );
    return entries.map((entry) => {
      if (!entry.collectible || !fungible.has(entry.collectible.id)) return entry;
      const { collectible, ...rest } = entry;
      return { ...rest, token: collectible.id, amount: "1" };
    });
  }

  /**
   * Background pending→confirmed promotion check
   * (`registerActivityPromotionAlarm` below): re-runs `getActivity` for
   * every address with a locally-pending entry and persists the result
   * back into the per-address activity log, so a pending entry the
   * gateway has since indexed is written back as confirmed even with no
   * popup open to trigger a read. Reuses `getActivity`'s existing
   * `mergeActivity`-based promotion logic rather than duplicating it —
   * this method only adds "run it on a timer and persist the outcome."
   *
   * Only entries `mergeActivity` actually resolved as no-longer-pending
   * are written back (a local entry `mergeActivity` still reports
   * `"pending"` is left as-is, since the gateway hasn't caught up to it
   * yet) — this never overwrites a still-genuinely-pending entry, and
   * never removes a local entry the gateway hasn't indexed at all.
   */
  async promotePendingActivity(address: string): Promise<void> {
    const storedLog = await loadActivityLog(this.storage, address);
    if (!storedLog.some((entry) => entry.status === "pending")) return;

    const localLog = await this.resolvePendingAoTransfers(address, storedLog);
    if (!localLog.some((entry) => entry.status === "pending")) return;

    const page = await this.getActivity({ address });
    const promoted = page.entries.filter((entry) => entry.status !== "pending");
    const promotedIds = new Set(promoted.map((entry) => entry.txId));

    // Asked by id: `page` only holds the newest entries, and a failure here
    // can't be undone once the send does turn up.
    const overdue = localLog.filter((entry) => entry.status === "pending" && !promotedIds.has(entry.txId) && Date.now() - entry.timestamp >= NEVER_MINED_MS);
    const unmined = new Set<string>();
    if (overdue.length > 0) {
      const ids = overdue.map((entry) => entry.txId).slice(0, 50);
      const settings = await this.loadSettings();
      await queryBlockHeights(ids, settings.gatewayUrl)
        .then((heights) => ids.filter((id) => !heights.has(id)).forEach((id) => unmined.add(id)))
        .catch(() => undefined);
    }
    const settled = new Map<string, ActivityEntry>();
    for (const entry of localLog) {
      const confirmed = promotedIds.has(entry.txId) ? promoted.find((candidate) => candidate.txId === entry.txId) : undefined;
      if (confirmed) settled.set(entry.txId, confirmed);
      else if (unmined.has(entry.txId) && (await this.neverMined(entry))) {
        settled.set(entry.txId, { ...entry, status: "failed", error: NEVER_MINED_ERROR });
      }
    }
    if (settled.size === 0) return;
    await this.settleActivity(address, settled);
    // A collectible send or market order that confirmed or failed has
    // changed what the wallet holds, or put back what it hid.
    if ([...settled.values()].some((entry) => entry.collectible || entry.swap)) await this.collectibles.markStale(address);
  }

  /**
   * Writes each settled entry over the one with its id in the stored log,
   * read afresh: a send recorded while the settle was waiting on the
   * network stays in the log.
   */
  private async settleActivity(address: string, settled: ReadonlyMap<string, ActivityEntry>): Promise<ActivityEntry[]> {
    const written = await updateStored(this.storage, activityLogKey(address), (raw) =>
      parseActivityLog(raw).map((entry) => settled.get(entry.txId) ?? entry),
    );
    return written ?? [];
  }

  /** A pending L1 transaction, AR or token, too old to be mined. A legacy AO send settles from its CU result instead. */
  private async neverMined(entry: ActivityEntry): Promise<boolean> {
    if (entry.status !== "pending" || Date.now() - entry.timestamp < NEVER_MINED_MS) return false;
    if (!entry.token) return true;
    const metadata = await this.storage.get<unknown>(`${TOKEN_METADATA_KEY_PREFIX}${entry.token}`);
    return isValidTokenMetadata(metadata) && metadata.transport === "l1";
  }

  /**
   * Settles pending AO sends from the token process's own evaluated result
   * (`core/ao/result.ts`) rather than the gateway index, which marks an
   * indexed AO message `"confirmed"` even when the process rejected the
   * transfer. Entries the CU hasn't evaluated yet stay pending for the
   * next tick. A `"failed"` outcome's reason is persisted on the entry's
   * `error` field for the activity row to show. Persists and returns the
   * updated log.
   */
  private async resolvePendingAoTransfers(address: string, localLog: ActivityEntry[]): Promise<ActivityEntry[]> {
    const settled = new Map<string, ActivityEntry>();
    await Promise.all(
      localLog.map(async (entry) => {
        if (entry.status !== "pending" || !entry.token) return;
        // An L1 token send settles through the gateway index, like an AR send.
        const metadata = await this.storage.get<unknown>(`${TOKEN_METADATA_KEY_PREFIX}${entry.token}`);
        if (isValidTokenMetadata(metadata) && metadata.transport === "l1") return;
        const outcome = await getTransferOutcome(entry.txId, entry.token);
        if (outcome.status === "pending") return;
        settled.set(entry.txId, {
          ...entry,
          status: outcome.status,
          error: outcome.status === "failed" ? outcome.error : entry.error,
        });
      }),
    );

    return settled.size > 0 ? this.settleActivity(address, settled) : localLog;
  }

  /**
   * Every address currently holding at least one local activity-log entry
   * — the set `promotePendingActivity` needs to check on each alarm tick.
   * `local:activityLog:{address}` keys have no separate index anywhere
   * (each is written directly by `handlers/transfer.ts`), so this derives
   * the address set from the one place this handler already knows
   * addresses live: the wallets list.
   */
  async loadTrackedAddresses(): Promise<string[]> {
    return (await loadWallets(this.storage)).map((wallet) => wallet.address);
  }

  /**
   * What each balance read doesn't include yet, for the popup to show and
   * to take off what can be spent. Not applied to the reads themselves, so
   * a dApp still sees the chain's balance.
   *
   * An AR or legacy send is outgoing while its activity entry is pending.
   * An L1 token send stays outgoing after it is mined, until the token
   * reaches its block (`readTokenSwapHeight`). If no node answers it stays
   * outgoing, and ages out with `NEVER_MINED_MS`.
   *
   * Incoming amounts are L1 receipts for listed tokens: claims by the
   * sender until the process applies them, so they only ever go in a note.
   */
  async getPendingTransfers(req: { address: string }): Promise<PendingTransfer[]> {
    const settings = await this.loadSettings();
    const recent = (entry: ActivityEntry) => Date.now() - entry.timestamp < NEVER_MINED_MS;
    const [log, receipts] = await Promise.all([
      loadActivityLog(this.storage, req.address),
      queryL1TokenReceipts(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT).catch(() => []),
    ]);
    const sends = log.filter((entry) => entry.type === "send" && entry.status !== "failed" && entry.amount !== null && !entry.collectible && recent(entry));
    const transportOf = new Map<string, TokenTransport | undefined>();
    const [listedReceipts] = await Promise.all([
      this.receiptsForListedTokens(req.address, receipts, settings),
      ...[...new Set(sends.flatMap((entry) => (entry.token ? [entry.token] : [])))].map(async (id) => {
        transportOf.set(id, (await tryTokenMetadata(this.storage, id, settings))?.transport);
      }),
    ]);
    const l1Sends = sends.filter((entry) => entry.token && transportOf.get(entry.token) === "l1");
    const otherSends = sends.filter((entry) => !l1Sends.includes(entry) && entry.status === "pending");
    // An unmined receipt has a timestamp of 0.
    const incoming = listedReceipts.filter((entry) => entry.timestamp === 0 || recent(entry));

    const l1Entries = [...l1Sends, ...incoming];
    const swapHeights = new Map<string, number>();
    const l1NodeUrls = await readL1NodeUrls(this.storage);
    const [heights] = await Promise.all([
      queryBlockHeights(
        l1Entries.map((entry) => entry.txId),
        settings.gatewayUrl,
      ).catch(() => new Map<string, number>()),
      ...[...new Set(l1Entries.flatMap((entry) => (entry.token ? [entry.token] : [])))].map(async (id) => {
        for (const node of l1NodeUrls) {
          try {
            swapHeights.set(id, await readTokenSwapHeight(id, node));
            return;
          } catch {
            // Try the next node.
          }
        }
      }),
    ]);
    const notApplied = (entry: ActivityEntry) => {
      const height = heights.get(entry.txId);
      const swapHeight = swapHeights.get(entry.token ?? "");
      return height === undefined || swapHeight === undefined || swapHeight < height;
    };

    const totals = new Map<string | null, { outgoing: bigint; incoming: bigint }>();
    const add = (entry: ActivityEntry, side: "outgoing" | "incoming") => {
      if (entry.amount === null || !/^\d+$/.test(entry.amount)) return;
      const token = entry.token ?? null;
      const total = totals.get(token) ?? { outgoing: 0n, incoming: 0n };
      total[side] += BigInt(entry.amount);
      totals.set(token, total);
    };
    [...otherSends, ...l1Sends.filter(notApplied)].forEach((entry) => add(entry, "outgoing"));
    incoming.filter(notApplied).forEach((entry) => add(entry, "incoming"));
    return [...totals].map(([token, total]) => ({
      token,
      outgoing: total.outgoing.toString(),
      incoming: total.incoming.toString(),
    }));
  }
}


/**
 * Name of the timer this module registers — namespaced
 * with the extension's own prefix convention (matches
 * `key-session.ts`/`wallet-lifecycle.ts`'s storage-key prefixes) so it
 * can't collide with an alarm another handler might register later.
 */
export const ACTIVITY_PROMOTION_ALARM_NAME = "gleam:activityPromotion";

/**
 * Every minute — frequent enough that a pending send/receive promotes to
 * confirmed within about the same window a user re-opening the popup
 * would already observe it (`getActivity` is called fresh on every popup
 * open), infrequent enough not to hammer the configured gateway on a
 * wallet with no pending activity (`promotePendingActivity` itself
 * short-circuits to a single storage read and no network call when there's
 * nothing pending, so most ticks cost nothing per tracked address anyway).
 * A tighter or looser interval is trivial to change here as a single
 * constant.
 */
const ACTIVITY_PROMOTION_INTERVAL_MINUTES = 1;

/** What the alarm needs from the activity reads; `ReadsHandler` passes its own methods. */
export type ActivityPromoter = Pick<ActivityReads, "loadTrackedAddresses" | "promotePendingActivity">;

/**
 * Registers the `TimerPort` interval that actively promotes a
 * locally-pending activity entry to confirmed once the gateway indexes
 * it — independent of any popup being open. Only the timer registration
 * lives here; all the actual promotion/merge logic is `ReadsHandler.promotePendingActivity`, reusing
 * the existing `mergeActivity`-backed `getActivity` path rather than
 * duplicating it.
 *
 * Call once from the background entrypoint with a `ReadsHandler`
 * instance, e.g.: `registerActivityPromotionAlarm(new
 * ReadsHandler(storage), timer)`. Errors from an individual address's promotion
 * check are caught and logged per-address so one failing gateway/address
 * never blocks promotion for the wallet's other tracked addresses on the
 * same tick.
 */
export function registerActivityPromotionAlarm(handler: ActivityPromoter, timer: TimerPort): void {
  timer.every(ACTIVITY_PROMOTION_ALARM_NAME, ACTIVITY_PROMOTION_INTERVAL_MINUTES, () => {
    void runActivityPromotionTick(handler);
  });
}

async function runActivityPromotionTick(handler: ActivityPromoter): Promise<void> {
  const addresses = await handler.loadTrackedAddresses();
  await Promise.all(
    addresses.map(async (address) => {
      try {
        await handler.promotePendingActivity(address);
      } catch (error) {
        console.error(`Activity promotion check failed for "${address}":`, error);
      }
    }),
  );
}
