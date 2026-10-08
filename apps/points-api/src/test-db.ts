import { PGlite } from "@electric-sql/pglite";
import { dbFromPglite, type Db } from "./db";
import { migrate } from "./migrate";

/** A fresh, fully migrated in-memory Postgres for one test. */
export async function createTestDb(): Promise<Db> {
  const db = dbFromPglite(new PGlite());
  await migrate(db);
  return db;
}
