import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Db } from "./db";
import { authenticateDevice, parseDeviceSignedRequest, recordHeartbeat } from "./heartbeat";
import { randomInviteCode } from "./invite-code";
import { parseLeaveRequest, leave } from "./leave";
import { RateLimiter } from "./rate-limit";
import { parseRegisterRequest, register } from "./register";
import { scoresForDevice } from "./score";

export interface AppDeps {
  db: Db;
  now?: () => Date;
  newInviteCode?: () => string;
}

const HOUR_MS = 3_600_000;

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? (() => new Date());
  const newInviteCode = deps.newInviteCode ?? randomInviteCode;
  const registerByIp = new RateLimiter(20, HOUR_MS);
  const leaveByIp = new RateLimiter(20, HOUR_MS);
  const heartbeatByIp = new RateLimiter(120, HOUR_MS);
  const heartbeatByDevice = new RateLimiter(6, HOUR_MS);
  const scoreByIp = new RateLimiter(600, HOUR_MS);
  const scoreByDevice = new RateLimiter(60, HOUR_MS);

  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 16 * 1024 }));

  app.get("/health", async (c) => {
    await deps.db.query("SELECT 1");
    return c.json({ ok: true });
  });

  app.post("/register", async (c) => {
    if (!registerByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const request = parseRegisterRequest(await readJson(c));
    if (!request) return c.json({ error: "Malformed request." }, 400);

    const outcome = await register(deps.db, request, now(), newInviteCode);
    return outcome.ok ? c.json(outcome.result) : c.json({ error: outcome.error }, outcome.status);
  });

  app.post("/heartbeat", async (c) => {
    if (!heartbeatByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const request = parseDeviceSignedRequest(await readJson(c));
    if (!request) return c.json({ error: "Malformed request." }, 400);
    if (!heartbeatByDevice.allow(request.deviceId, now().getTime())) return tooManyRequests(c);

    const auth = await authenticateDevice(deps.db, "heartbeat", request, now());
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    await recordHeartbeat(deps.db, auth.deviceId, now());
    return c.json({ ok: true });
  });

  app.post("/leave", async (c) => {
    if (!leaveByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const request = parseLeaveRequest(await readJson(c));
    if (!request) return c.json({ error: "Malformed request." }, 400);

    const outcome = await leave(deps.db, request, now());
    return outcome.ok ? c.json({ ok: true }) : c.json({ error: outcome.error }, outcome.status);
  });

  app.post("/me", async (c) => {
    if (!scoreByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const request = parseDeviceSignedRequest(await readJson(c));
    if (!request) return c.json({ error: "Malformed request." }, 400);
    if (!scoreByDevice.allow(request.deviceId, now().getTime())) return tooManyRequests(c);

    const auth = await authenticateDevice(deps.db, "me", request, now());
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    return c.json(await scoresForDevice(deps.db, auth.deviceId));
  });

  return app;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

// Railway's proxy appends the caller to X-Forwarded-For; its first entry is the client.
function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function tooManyRequests(c: Context) {
  return c.json({ error: "Too many requests." }, 429);
}
