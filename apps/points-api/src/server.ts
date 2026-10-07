import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app";
import { readConfig } from "./config";
import { dbFromPool } from "./db";
import { migrate } from "./migrate";

const config = readConfig(process.env);
const db = dbFromPool(new pg.Pool({ connectionString: config.databaseUrl }));

const applied = await migrate(db);
if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);

serve({ fetch: createApp({ db }).fetch, port: config.port }, (info) => {
  console.log(`Points API listening on :${info.port}`);
});
