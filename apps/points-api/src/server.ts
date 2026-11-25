import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app";
import { createBalanceReader } from "./points/balances";
import { readConfig } from "./config";
import { dbFromPool } from "./db";
import { createGithubClient } from "./scans/github";
import { migrate } from "./migrate";
import { createPgPriceStore } from "./prices/price-store";
import { createPriceService } from "./prices/prices";
import { startSnapshotScheduler } from "./scheduler";

const config = readConfig(process.env);
const db = dbFromPool(new pg.Pool({ connectionString: config.databaseUrl }));

const applied = await migrate(db);
if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);

if (!config.githubToken) {
  console.warn("Set GITHUB_TOKEN; unauthenticated GitHub allows 60 requests an hour, which community scans can exhaust.");
}

if (!config.coinGeckoApiKey) {
  console.warn("Set COINGECKO_API_KEY; without it, prices come from CoinPaprika alone.");
}

const app = createApp({
  db,
  pointsPhase: config.pointsPhase,
  github: createGithubClient({ repo: config.githubRepo, token: config.githubToken }),
  prices: createPriceService({ coinGeckoApiKey: config.coinGeckoApiKey, store: createPgPriceStore(db) }),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Points API listening on :${info.port}`);
});

startSnapshotScheduler(db, { readBalances: createBalanceReader(config) });
