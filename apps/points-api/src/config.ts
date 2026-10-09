import { DEFAULT_HYPERBEAM_PEER_URLS } from "@gleam/core/src/models/network.ts";

export interface Config {
  databaseUrl: string;
  port: number;
  arweaveGatewayUrl: string;
  hyperbeamUrl: string;
  pointsPhase: 1 | 2;
}

export function readConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT must be a positive integer, got "${env.PORT}".`);

  const phase = env.POINTS_PHASE || "1";
  if (phase !== "1" && phase !== "2") throw new Error(`POINTS_PHASE must be 1 or 2, got "${env.POINTS_PHASE}".`);

  return {
    databaseUrl,
    port,
    arweaveGatewayUrl: env.ARWEAVE_GATEWAY_URL || "https://arweave.net",
    hyperbeamUrl: env.HYPERBEAM_URL || DEFAULT_HYPERBEAM_PEER_URLS[0]!,
    pointsPhase: phase === "1" ? 1 : 2,
  };
}
