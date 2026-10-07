import { Hono } from "hono";
import type { Db } from "./db";

export interface AppDeps {
  db: Db;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    await deps.db.query("SELECT 1");
    return c.json({ ok: true });
  });

  return app;
}
