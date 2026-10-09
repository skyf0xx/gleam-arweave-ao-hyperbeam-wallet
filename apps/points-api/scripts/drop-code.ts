import pg from "pg";
import { dbFromPool } from "../src/db";
import { createDropCode, formatDropCode, parseDropCodeArgs } from "../src/drop-codes";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

let options;
try {
  options = parseDropCodeArgs(process.argv.slice(2).filter((arg) => arg !== "--"));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error('Usage: drop-code --label "<text>" (--seats <n> | --unlimited) [--prefix <A-Z>]');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  console.log(formatDropCode(await createDropCode(dbFromPool(pool), options)));
} finally {
  await pool.end();
}
