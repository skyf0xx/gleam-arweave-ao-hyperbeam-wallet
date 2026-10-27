/**
 * What the runtime worker and the UI thread share about the SQLite store.
 * It imports no plugin, so the worker bundle stays free of Capacitor,
 * whose native bridge only exists on the page.
 */

/** The rows of the `kv` table: a key and its value as JSON text. */
export type StoredRow = [key: string, json: string];

/**
 * The persistent `local:` area, served to the runtime worker. Capacitor
 * plugins reach native code through the page's bridge, which a worker
 * doesn't have, so the database is opened on the UI thread and the worker
 * calls in.
 */
export interface SqliteStore {
  /** Every row, for the worker to hold in memory. */
  load(): Promise<StoredRow[]>;
  /** Applies `puts` and `deletes` in one transaction: all of them or none. */
  write(puts: StoredRow[], deletes: string[]): Promise<void>;
}

/** The message a worker sends to ask for the store, carrying its end of the channel. */
export const STORE_REQUEST = "gleam:sqlite-store";
