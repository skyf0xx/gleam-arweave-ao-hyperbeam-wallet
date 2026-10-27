import * as Comlink from "comlink";
import { CapacitorSQLite, SQLiteConnection, type capSQLiteSet } from "@capacitor-community/sqlite";
import { STORE_REQUEST, type SqliteStore } from "./sqlite-channel";

/** The part of the plugin's `SQLiteDBConnection` this store uses. */
export interface SqliteDb {
  execute(statements: string, transaction?: boolean): Promise<unknown>;
  query(statement: string, values?: unknown[]): Promise<{ values?: unknown[] }>;
  executeSet(set: capSQLiteSet[], transaction?: boolean): Promise<unknown>;
}

const SCHEMA = "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)";

/** Opens the database once, on first use, and creates the table if it's missing. */
export function createSqliteStore(openDb: () => Promise<SqliteDb>): SqliteStore {
  let ready: Promise<SqliteDb> | undefined;
  // A failed open is tried again on the next call rather than kept.
  const db = () =>
    (ready ??= openDb().then(
      async (opened) => {
        await opened.execute(SCHEMA, false);
        return opened;
      },
    ).catch((error: unknown) => {
      ready = undefined;
      throw error;
    }));
  return {
    async load() {
      const { values = [] } = await (await db()).query("SELECT key, value FROM kv");
      return values.map((row) => {
        const { key, value } = row as { key: string; value: string };
        return [key, value];
      });
    },
    async write(puts, deletes) {
      const set: capSQLiteSet[] = [
        ...puts.map(([key, json]) => ({ statement: "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", values: [key, json] })),
        ...deletes.map((key) => ({ statement: "DELETE FROM kv WHERE key = ?", values: [key] })),
      ];
      if (set.length > 0) await (await db()).executeSet(set, true);
    },
  };
}

const DATABASE = "gleam";

/** The app's database through `@capacitor-community/sqlite`, unencrypted: the vault inside is already sealed. */
export async function openCapacitorDb(): Promise<SqliteDb> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await sqlite.checkConnectionsConsistency();
  const existing = (await sqlite.isConnection(DATABASE, false)).result;
  const db = existing
    ? await sqlite.retrieveConnection(DATABASE, false)
    : await sqlite.createConnection(DATABASE, false, "no-encryption", 1, false);
  await db.open();
  return db;
}

/**
 * Serves `store` to the worker on the channel it opens with
 * `connectSqliteStore`. Only the first request is served, so the worker's
 * storage stays the database's one writer.
 */
export function serveSqliteStore(worker: Worker, store: SqliteStore): void {
  let served = false;
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; port?: unknown } | null;
    if (served || data?.type !== STORE_REQUEST || !(data.port instanceof MessagePort)) return;
    served = true;
    Comlink.expose(store, data.port);
  });
}
