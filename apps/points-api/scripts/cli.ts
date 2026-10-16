import { createInterface } from "node:readline/promises";
import pg from "pg";
import { dbFromPool, type Db } from "../src/db";

/** Runs a script body against `DATABASE_URL`, printing a thrown message instead of a stack. */
export async function runScript(usage: string, parse: () => void, body: (db: Db) => Promise<void>): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  try {
    parse();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage);
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await body(dbFromPool(pool));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

export async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}
