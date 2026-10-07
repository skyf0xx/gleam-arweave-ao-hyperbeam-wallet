import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";

/**
 * The slice of a Postgres client the API uses. Production passes a `pg`
 * pool; tests pass PGlite (real Postgres in WASM), so SQL is exercised
 * against the same engine either way.
 */
export interface Queryable {
  query<Row>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface Db extends Queryable {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Runs `work` only if no other process holds `lockId`; returns null if one does. */
  withLock<T>(lockId: number, work: () => Promise<T>): Promise<T | null>;
}

export function dbFromPool(pool: Pool): Db {
  const asQueryable = (client: Pool | PoolClient): Queryable => ({
    query: async <Row>(text: string, params?: unknown[]) => {
      const result = await client.query(text, params);
      return { rows: result.rows as Row[] };
    },
  });

  return {
    ...asQueryable(pool),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(asQueryable(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    // Advisory locks belong to a session, so lock and unlock must use the
    // same pooled connection.
    async withLock(lockId, work) {
      const client = await pool.connect();
      try {
        const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [lockId]);
        if (!rows[0]?.locked) return null;
        try {
          return await work();
        } finally {
          await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
        }
      } finally {
        client.release();
      }
    },
  };
}

export function dbFromPglite(pg: PGlite): Db {
  const asQueryable = (client: PGlite | Transaction): Queryable => ({
    query: async <Row>(text: string, params?: unknown[]) => {
      const result = await client.query<Row>(text, params);
      return { rows: result.rows };
    },
  });

  return {
    ...asQueryable(pg),
    transaction: (work) => pg.transaction((tx) => work(asQueryable(tx))),
    // PGlite is single-connection, so there is never a competing holder.
    withLock: (_lockId, work) => work(),
  };
}
