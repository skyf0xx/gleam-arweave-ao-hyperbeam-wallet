import { readdir, readFile } from "node:fs/promises";
import type { Db } from "./db";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

/**
 * Applies every `migrations/NNN_*.sql` file not yet recorded, in name
 * order, each in its own transaction. Runs on every boot; applied files
 * must never be edited, only followed by new ones.
 */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.name));
  const pending = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql") && !applied.has(name)).sort();

  for (const name of pending) {
    const sql = await readFile(new URL(name, MIGRATIONS_DIR), "utf8");
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(sql)) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    });
  }
  return pending;
}

// Parameterless multi-statement strings aren't accepted by every client,
// so statements run one by one. Migrations contain no semicolons inside
// literals or function bodies.
function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
