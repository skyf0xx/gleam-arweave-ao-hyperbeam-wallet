import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app";
import { createBalanceReader } from "./balances";
import { readConfig } from "./config";
import { dbFromPool } from "./db";
import { migrate } from "./migrate";
import { startSnapshotScheduler } from "./scheduler";

const config = readConfig(process.env);
const db = dbFromPool(new pg.Pool({ connectionString: config.databaseUrl }));

const applied = await migrate(db);
if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);

serve({ fetch: createApp({ db }).fetch, port: config.port }, (info) => {
  console.log(`Points API listening on :${info.port}`);
});

startSnapshotScheduler(db, { readBalances: createBalanceReader(config) });
