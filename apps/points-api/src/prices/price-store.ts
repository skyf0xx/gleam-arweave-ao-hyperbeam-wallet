import type { Queryable } from "../db";

export interface StoredPrice {
  key: string;
  value: unknown;
  fetchedAt: number;
  expiresAt: number;
}

/** Where the price cache keeps its last good answers across restarts. */
export interface PriceStore {
  load(): Promise<StoredPrice[]>;
  save(entry: StoredPrice): Promise<void>;
}

export function createPgPriceStore(db: Queryable): PriceStore {
  return {
    async load() {
      const { rows } = await db.query<{ key: string; value: unknown; fetched_at: Date; expires_at: Date }>(
        "SELECT key, value, fetched_at, expires_at FROM price_cache",
      );
      return rows.map((row) => ({
        key: row.key,
        value: row.value,
        fetchedAt: new Date(row.fetched_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(),
      }));
    },

    async save({ key, value, fetchedAt, expiresAt }) {
      await db.query(
        `INSERT INTO price_cache (key, value, fetched_at, expires_at) VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
        [key, JSON.stringify(value), new Date(fetchedAt), new Date(expiresAt)],
      );
    },
  };
}
