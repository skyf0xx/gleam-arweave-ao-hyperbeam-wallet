import pg from "pg";
import { dbFromPool } from "../src/db";
import { formatFunnel, readFunnel } from "../src/funnel";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  console.log(formatFunnel(await readFunnel(dbFromPool(pool), new Date())));
} finally {
  await pool.end();
}
