import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { Db } from "./db";
import { authenticateDevice, parseDeviceSignedRequest, recordHeartbeat } from "./heartbeat";
import { checkInviteCode, parseInviteCode, parseRedeemRequest, redeemInviteCode } from "./invite";
import { randomInviteCode } from "./invite-code";
import { parseLeaveRequest, leave } from "./leave";
import { RateLimiter } from "./rate-limit";
import { parseRegisterRequest, register } from "./register";
import { scoresForDevice } from "./score";

export interface AppDeps {
  db: Db;
  now?: () => Date;
  newInviteCode?: () => string;
  /** Defaults to 1, like `POINTS_PHASE`. */
  pointsPhase?: 1 | 2;
}

const HOUR_MS = 3_600_000;
const STATS_TTL_MS = 60_000;

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? (() => new Date());
  const pointsPhase = deps.pointsPhase ?? 1;
  const newInviteCode = deps.newInviteCode ?? randomInviteCode;
  const registerByIp = new RateLimiter(20, HOUR_MS);
  const leaveByIp = new RateLimiter(20, HOUR_MS);
  const heartbeatByIp = new RateLimiter(120, HOUR_MS);
  const heartbeatByDevice = new RateLimiter(6, HOUR_MS);
  const scoreByIp = new RateLimiter(600, HOUR_MS);
  const scoreByDevice = new RateLimiter(60, HOUR_MS);
  const statsByIp = new RateLimiter(600, HOUR_MS);
  // Shared by check and redeem, so codes can't be enumerated through either.
  // 30 an hour covers a person retrying typos and reopening the invite page.
  const inviteByIp = new RateLimiter(30, HOUR_MS);
  let statsCache: { foundingMembers: number; expiresAt: number } | null = null;

  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 16 * 1024 }));

  app.get("/health", async (c) => {
    await deps.db.query("SELECT 1");
    return c.json({ ok: true });
  });

  // Read by static pages on other origins.
  app.use("/stats", cors({ origin: "*" }));
  app.get("/stats", async (c) => {
    if (!statsByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    if (!statsCache || now().getTime() >= statsCache.expiresAt) {
      const { rows } = await deps.db.query<{ count: string }>("SELECT count(founding_number)::text AS count FROM wallets");
      statsCache = { foundingMembers: Number(rows[0]!.count), expiresAt: now().getTime() + STATS_TTL_MS };
    }
    c.header("Cache-Control", "public, max-age=60");
    return c.json({ foundingMembers: statsCache.foundingMembers });
  });

  // Read by invite.html, a static page on another origin.
  app.use("/invite/check", cors({ origin: "*" }));
  app.post("/invite/check", async (c) => {
    if (!inviteByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const body = await readJson(c);
    const code = parseInviteCode(body !== null && typeof body === "object" ? (body as { code?: unknown }).code : null);
    if (!code) return c.json({ error: "Malformed invite code." }, 400);
    return c.json(await checkInviteCode(deps.db, code, pointsPhase));
  });

  app.post("/invite/redeem", async (c) => {
    if (!inviteByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const request = parseRedeemRequest(await readJson(c));
    if (!request) return c.json({ error: "Malformed request." }, 400);

    const outcome = await redeemInviteCode(deps.db, request, now(), pointsPhase);
    return outcome.ok ? c.json({ result: outcome.result }) : c.json({ error: outcome.error }, outcome.status);
  });

  app.post("/register", async (c) => {
    if (!registerByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const request = parseRegisterRequest(await readJson(c));
    if (!request) return c.json({ error: "Malformed request." }, 400);

    const outcome = await register(deps.db, request, now(), newInviteCode, pointsPhase);
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
    return c.json(await scoresForDevice(deps.db, auth.deviceId, pointsPhase));
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

// Railway's edge replaces any X-Forwarded-For the client sends, so its first
// entry is the connecting client and can't be spoofed (checked against the
// live service on 2026-10-09). Recheck if the API moves off Railway.
function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function tooManyRequests(c: Context) {
  return c.json({ error: "Too many requests." }, 429);
}
