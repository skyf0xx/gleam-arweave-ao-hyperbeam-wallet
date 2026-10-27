import * as Comlink from "comlink";
import type { StoragePort } from "@gleam/core";
import { STORE_REQUEST, type SqliteStore, type StoredRow } from "./sqlite-channel";

type Area = "local" | "session";

function areaOf(key: string): Area {
  const area = key.slice(0, key.indexOf(":"));
  if (area !== "local" && area !== "session") {
    throw new Error(`Invalid storage key "${key}": must start with "local:" or "session:".`);
  }
  return area;
}

/**
 * A row that isn't JSON fails the load rather than reading as missing: if
 * it were the vault, the app would offer to create a wallet and the new
 * one would overwrite the sealed keys.
 */
function parseRow(key: string, json: string): [string, unknown] {
  try {
    return [key, JSON.parse(json) as unknown];
  } catch {
    throw new Error(`Gleam's stored "${key}" is damaged, so storage won't load.`);
  }
}

/**
 * `StoragePort` for the runtime worker. `session:` keys live only in this
 * worker's memory, the counterpart of `chrome.storage.session`, so they
 * never reach the UI thread or disk and are gone when the app is killed.
 * `local:` keys persist in SQLite through `store`.
 *
 * The worker is the database's only writer, so it holds every `local:` row
 * in memory and answers reads from there. A write commits to SQLite first
 * and changes the memory copy only once it has, all in one step, so a
 * reader sees a whole `setMany` batch or none of it. Writes run one at a
 * time, in the order they were made.
 */
export class MobileStoragePort implements StoragePort {
  private readonly session = new Map<string, unknown>();
  private loaded: Promise<Map<string, unknown>> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly watchers = new Map<string, Set<(value: unknown) => void>>();

  constructor(private readonly store: Pick<SqliteStore, "load" | "write">) {
    // Starts loading at once; a failure surfaces through the next read or write.
    this.local().catch(() => {});
  }

  /** The `local:` rows, loaded once. A failed load is tried again on the next access. */
  private local(): Promise<Map<string, unknown>> {
    this.loaded ??= this.store.load().then(
      (rows) => new Map(rows.map(([key, json]) => parseRow(key, json))),
      (error: unknown) => {
        this.loaded = undefined;
        throw error;
      },
    );
    return this.loaded;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = areaOf(key) === "session" ? this.session.get(key) : (await this.local()).get(key);
    return value === undefined ? null : (structuredClone(value) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (value == null) return this.remove(key);
    await this.commit(areaOf(key), { [key]: value }, []);
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(entries);
    if (keys.length === 0) return;
    const areas = new Set(keys.map(areaOf));
    if (areas.size > 1) throw new Error(`setMany keys must share one storage area, got ${[...areas].join(", ")}.`);
    const nullish = keys.find((key) => entries[key] == null);
    if (nullish !== undefined) {
      throw new Error(`setMany value for "${nullish}" is null or undefined; use remove to delete a key.`);
    }
    await this.commit([...areas][0]!, entries, []);
  }

  async remove(key: string): Promise<void> {
    await this.commit(areaOf(key), {}, [key]);
  }

  watch<T>(key: string, cb: (value: T | null) => void): () => void {
    const listeners = this.watchers.get(key) ?? new Set();
    const listener = cb as (value: unknown) => void;
    listeners.add(listener);
    this.watchers.set(key, listeners);
    return () => void listeners.delete(listener);
  }

  private async commit(area: Area, puts: Record<string, unknown>, deletes: string[]): Promise<void> {
    // Cloned before the first await, so a caller editing the object after
    // the call doesn't change what is written.
    const values = Object.entries(puts).map(([key, value]) => [key, structuredClone(value)] as const);
    if (area === "session") return this.apply(this.session, values, deletes);

    const run = this.writes.then(async () => {
      const local = await this.local();
      const rows: StoredRow[] = values.map(([key, value]) => [key, JSON.stringify(value)]);
      const removed = deletes.filter((key) => local.has(key));
      if (rows.length === 0 && removed.length === 0) return;
      await this.store.write(rows, removed);
      // Read back from the JSON that was stored, so memory holds exactly what a restart would load.
      this.apply(
        local,
        rows.map(([key, json]) => [key, JSON.parse(json) as unknown]),
        removed,
      );
    });
    this.writes = run.catch(() => {});
    return run;
  }

  private apply(area: Map<string, unknown>, values: ReadonlyArray<readonly [string, unknown]>, deletes: string[]): void {
    const removed = deletes.filter((key) => area.delete(key));
    for (const [key, value] of values) area.set(key, value);
    // Notified only once every entry is in place, so no watcher sees part of a batch.
    for (const [key, value] of values) this.notify(key, value);
    for (const key of removed) this.notify(key, null);
  }

  private notify(key: string, value: unknown): void {
    for (const listener of this.watchers.get(key) ?? []) {
      // The write has committed; a failing watcher mustn't make it look as if it hadn't.
      try {
        listener(structuredClone(value));
      } catch (error) {
        console.error(`A watcher of "${key}" failed.`, error);
      }
    }
  }
}

/** Opens a channel to the UI thread's `serveSqliteStore` and returns the store on it. */
export function connectSqliteStore(scope: { postMessage(message: unknown, transfer: Transferable[]): void }): SqliteStore {
  const channel = new MessageChannel();
  scope.postMessage({ type: STORE_REQUEST, port: channel.port2 }, [channel.port2]);
  return Comlink.wrap<SqliteStore>(channel.port1);
}
