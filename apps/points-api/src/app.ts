import { ROUND_STEP_PERCENT } from "@gleam/core/src/scan/index.ts";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import type { z } from "zod";
import {
  AttestationListCache,
  checkAttestation,
  countAttestations,
  listAttestations,
  checkRequest,
  parseListQuery,
  scanRewardBasis,
  submitAttestation,
  submitRequest,
} from "./scans/attestations";
import { poolBalance } from "./scans/bounty";
import type { Db } from "./db";
import { createGithubClient, type GithubClient } from "./scans/github";
import { authenticateDevice, deviceSignedRequest, recordHeartbeat } from "./wallets/heartbeat";
import { checkInviteCode, inviteCheckRequest, redeemInviteCode, redeemRequest } from "./wallets/invite";
import { randomInviteCode } from "./wallets/invite-code";
import { leave, leaveRequest } from "./wallets/leave";
import { createPriceService, parseFxQuery, parseHistoryQuery, parseSpotQuery, type PriceService } from "./prices/prices";
import { RateLimiter } from "./rate-limit";
import { register, registerRequest } from "./wallets/register";
import type { AreaSummary } from "./scans/areas";
import { issueChallenge, parseChallengeQuery } from "./scans/challenge";
import type { ScanFailure } from "./scans/errors";
import { listAreas, scanNext } from "./scans/rounds";
import { scoresForDevice } from "./points/score";

const MOBILE_ORIGINS = new Set(["https://localhost", "capacitor://localhost"]);

export interface AppDeps {
  db: Db;
  now?: () => Date;
  newInviteCode?: () => string;
  /** Defaults to 1, like `POINTS_PHASE`. */
  pointsPhase?: 1 | 2;
  /** Reads releases and their files from GitHub; defaults to the public repo. */
  github?: GithubClient;
  /** Looks up CoinGecko/CoinPaprika prices; defaults to the live providers. */
  prices?: PriceService;
}

/** `GET /scan/rewards`; amounts are atomic-unit integer strings. */
interface ScanRewards {
  day: string | null;
  issuedAtomic: string;
  scanRewardAtomic: string;
  bountyPoolAtomic: string;
  roundStepPercent: number;
}

const HOUR_MS = 3_600_000;
const STATS_TTL_MS = 60_000;
const SHARED_CACHE_CONTROL = `public, max-age=${STATS_TTL_MS / 1000}`;
const ATTESTATION_PATHS = ["/attestations", "/attestations/check"];
// An attestation carries a report of up to 20,000 characters.
const ATTESTATION_BODY_LIMIT = 160 * 1024;

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? (() => new Date());
  const pointsPhase = deps.pointsPhase ?? 1;
  const newInviteCode = deps.newInviteCode ?? randomInviteCode;
  const github = deps.github ?? createGithubClient({ now: () => now().getTime() });
  const prices = deps.prices ?? createPriceService({ now: () => now().getTime() });
  const registerByIp = new RateLimiter(20, HOUR_MS);
  const leaveByIp = new RateLimiter(20, HOUR_MS);
  const heartbeatByIp = new RateLimiter(120, HOUR_MS);
  const heartbeatByDevice = new RateLimiter(6, HOUR_MS);
  const scoreByIp = new RateLimiter(600, HOUR_MS);
  const scoreByDevice = new RateLimiter(60, HOUR_MS);
  const statsByIp = new RateLimiter(600, HOUR_MS);
  const pricesByIp = new RateLimiter(1200, HOUR_MS);
  // Shared by check and redeem, so codes can't be enumerated through either.
  // 30 an hour covers a person retrying typos and reopening the invite page.
  const inviteByIp = new RateLimiter(30, HOUR_MS);
  // The scan limits are per IP. Agents rerun `pnpm scan finish` several
  // times, so the dry run gets more room than the real submission.
  const attestationListings = new AttestationListCache(() => now().getTime());
  const challengeByIp = new RateLimiter(30, HOUR_MS);
  const checkByIp = new RateLimiter(120, HOUR_MS);
  const attestByIp = new RateLimiter(20, HOUR_MS);
  const attestationsListByIp = new RateLimiter(600, HOUR_MS);
  const rewardsByIp = new RateLimiter(600, HOUR_MS);
  const areasByIp = new RateLimiter(600, HOUR_MS);
  const nextByIp = new RateLimiter(120, HOUR_MS);
  const nowMs = () => now().getTime();
  const rewardsCache = ttlCache<ScanRewards>(STATS_TTL_MS, nowMs);
  const areasCache = ttlCache<{ release: string; areas: AreaSummary[] }>(STATS_TTL_MS, nowMs);
  const statsCache = ttlCache<number>(STATS_TTL_MS, nowMs);

  // Route middleware, so the limit runs before the body is read.
  const limit = (limiter: RateLimiter) =>
    createMiddleware(async (c, next) => {
      if (!limiter.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
      await next();
    });
  const scanLimit = (limiter: RateLimiter) =>
    createMiddleware(async (c, next) => {
      if (!limiter.allow(clientIp(c), now().getTime())) return scanRateLimited(c, limiter, now().getTime());
      await next();
    });

  const app = new Hono();
  // The JSON validator throws on a body that isn't JSON, before a route's
  // own invalid-input answer can run, so that answer is given here.
  app.onError((err, c) => {
    if (err instanceof HTTPException && err.status === 400 && err.message === MALFORMED_JSON) {
      if (ATTESTATION_PATHS.includes(c.req.path)) return scanMalformed(c);
      return c.json({ error: c.req.path === "/invite/check" ? "Malformed invite code." : "Malformed request." }, 400);
    }
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.text("Internal Server Error", 500);
  });
  app.use("*", async (c, next) => {
    const limit = ATTESTATION_PATHS.includes(c.req.path) ? ATTESTATION_BODY_LIMIT : 16 * 1024;
    return bodyLimit({ maxSize: limit })(c, next);
  });

  // The extension and the mobile app's WebView (Capacitor's fixed
  // `https://localhost` on Android, `capacitor://localhost` on iOS) call
  // these from a browser context, so CORS applies. Any extension id is
  // allowed so unpacked dev builds work too; every one of these requests is
  // checked on its own merits, so the origin is never what authorises it.
  const walletCors = cors({
    origin: (origin) => (origin.startsWith("chrome-extension://") || MOBILE_ORIGINS.has(origin) ? origin : null),
  });
  for (const path of ["/invite/redeem", "/register", "/heartbeat", "/leave", "/me", "/prices", "/prices/history", "/prices/fx"]) app.use(path, walletCors);

  // Scan endpoints are open to any origin: the CLI sends no origin, the site
  // reads the list and rewards, and the signature (not the origin) authorises a submission.
  for (const path of [...ATTESTATION_PATHS, "/attestations/count", "/scan/challenge", "/scan/rewards", "/scan/areas", "/scan/next"]) app.use(path, cors({ origin: "*" }));

  app.get("/health", async (c) => {
    await deps.db.query("SELECT 1");
    return c.json({ ok: true });
  });

  // Read by static pages on other origins.
  app.use("/stats", cors({ origin: "*" }));
  app.get("/stats", limit(statsByIp), async (c) => {
    const foundingMembers =
      statsCache.get() ??
      statsCache.set(
        Number((await deps.db.query<{ count: string }>("SELECT count(founding_number)::text AS count FROM wallets")).rows[0]!.count),
      );
    c.header("Cache-Control", SHARED_CACHE_CONTROL);
    return c.json({ foundingMembers });
  });

  // Proxies CoinGecko/CoinPaprika for users whose network blocks them. Only
  // registry ids are accepted, so this can't be used to relay arbitrary lookups.
  app.get("/prices", limit(pricesByIp), async (c) => {
    const ids = parseSpotQuery(c.req.query());
    if (!ids) return c.json({ error: "Unknown or missing price ids." }, 400);
    return c.json({ prices: await prices.spot(ids) });
  });

  app.get("/prices/history", limit(pricesByIp), async (c) => {
    const query = parseHistoryQuery(c.req.query());
    if (!query) return c.json({ error: "Unknown price id or range." }, 400);
    return c.json({ series: await prices.history(query.id, query.range) });
  });

  app.get("/prices/fx", limit(pricesByIp), async (c) => {
    const currency = parseFxQuery(c.req.query());
    if (!currency) return c.json({ error: "Unknown or missing currency." }, 400);
    return c.json({ currency, rate: await prices.fx(currency) });
  });

  // Read by invite.html, a static page on another origin.
  app.use("/invite/check", cors({ origin: "*" }));
  app.post("/invite/check", limit(inviteByIp), jsonBody(inviteCheckRequest, "Malformed invite code."), async (c) => {
    return c.json(await checkInviteCode(deps.db, c.req.valid("json").code, pointsPhase));
  });

  app.post("/invite/redeem", limit(inviteByIp), jsonBody(redeemRequest), async (c) => {
    const request = c.req.valid("json");

    const outcome = await redeemInviteCode(deps.db, request, now(), pointsPhase);
    return outcome.ok ? c.json({ result: outcome.result, kind: outcome.kind }) : c.json({ error: outcome.error }, outcome.status);
  });

  app.post("/register", limit(registerByIp), jsonBody(registerRequest), async (c) => {
    const request = c.req.valid("json");

    const outcome = await register(deps.db, request, now(), newInviteCode, pointsPhase);
    if (outcome.ok) return c.json(outcome.result);
    if (outcome.status === 403) return c.json({ error: outcome.error, code: outcome.code }, 403);
    return c.json({ error: outcome.error }, outcome.status);
  });

  app.post("/heartbeat", limit(heartbeatByIp), jsonBody(deviceSignedRequest), async (c) => {
    const request = c.req.valid("json");
    if (!heartbeatByDevice.allow(request.deviceId, now().getTime())) return tooManyRequests(c);

    const auth = await authenticateDevice(deps.db, "heartbeat", request, now());
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    await recordHeartbeat(deps.db, auth.deviceId, now());
    return c.json({ ok: true });
  });

  app.post("/leave", limit(leaveByIp), jsonBody(leaveRequest), async (c) => {
    const request = c.req.valid("json");

    const outcome = await leave(deps.db, request, now());
    return outcome.ok ? c.json({ ok: true }) : c.json({ error: outcome.error }, outcome.status);
  });

  app.post("/me", limit(scoreByIp), jsonBody(deviceSignedRequest), async (c) => {
    const request = c.req.valid("json");
    if (!scoreByDevice.allow(request.deviceId, now().getTime())) return tooManyRequests(c);

    const auth = await authenticateDevice(deps.db, "me", request, now());
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    return c.json(await scoresForDevice(deps.db, auth.deviceId, pointsPhase, now()));
  });

  app.get("/scan/challenge", scanLimit(challengeByIp), async (c) => {
    const query = parseChallengeQuery(c.req.query());
    if ("ok" in query) return scanFailure(c, query);
    const outcome = await issueChallenge(deps.db, github, now(), query.area);
    return outcome.ok ? c.json(outcome.challenge) : scanFailure(c, outcome);
  });

  app.get("/scan/areas", scanLimit(areasByIp), async (c) => {
    let body = areasCache.get();
    if (!body) {
      const outcome = await listAreas(deps.db, github);
      if (!outcome.ok) return scanFailure(c, outcome);
      body = areasCache.set(outcome.body);
    }
    c.header("Cache-Control", SHARED_CACHE_CONTROL);
    return c.json(body);
  });

  app.get("/scan/next", scanLimit(nextByIp), async (c) => {
    const outcome = await scanNext(deps.db, github, c.req.query(), now());
    return outcome.ok ? c.json(outcome.body) : scanFailure(c, outcome);
  });

  app.get("/scan/rewards", scanLimit(rewardsByIp), async (c) => {
    let body = rewardsCache.get();
    if (!body) {
      const [basis, pool] = await Promise.all([scanRewardBasis(deps.db, now()), poolBalance(deps.db)]);
      body = rewardsCache.set({
        day: basis.day,
        issuedAtomic: basis.issuedAtomic.toString(),
        scanRewardAtomic: basis.rewardAtomic.toString(),
        bountyPoolAtomic: pool.toString(),
        roundStepPercent: ROUND_STEP_PERCENT,
      });
    }
    c.header("Cache-Control", SHARED_CACHE_CONTROL);
    return c.json(body);
  });

  app.post("/attestations/check", scanLimit(checkByIp), scanBody(checkRequest), async (c) => {
    const request = c.req.valid("json");
    const outcome = await checkAttestation(deps.db, github, request, now());
    return outcome.ok ? c.json({ ok: true, ...outcome.result }) : scanFailure(c, outcome);
  });

  app.post("/attestations", scanLimit(attestByIp), scanBody(submitRequest), async (c) => {
    const request = c.req.valid("json");
    const outcome = await submitAttestation(deps.db, github, request, now(), attestationListings);
    return outcome.ok ? c.json({ ok: true, ...outcome.result }) : scanFailure(c, outcome);
  });

  app.get("/attestations/count", scanLimit(attestationsListByIp), async (c) => {
    const outcome = await countAttestations(deps.db, github, c.req.query());
    if (!outcome.ok) return scanFailure(c, outcome);
    c.header("Cache-Control", SHARED_CACHE_CONTROL);
    return c.json({ release: outcome.release, total: outcome.total, paidPlacesLeft: outcome.paidPlacesLeft, paidScans: outcome.paidScans });
  });

  app.get("/attestations", scanLimit(attestationsListByIp), async (c) => {
    const query = parseListQuery(c.req.query());
    if ("ok" in query) return scanFailure(c, query);
    const outcome = await listAttestations(deps.db, github, attestationListings, query);
    if (!outcome.ok) return scanFailure(c, outcome);
    c.header("Cache-Control", SHARED_CACHE_CONTROL);
    return c.json(outcome.listing);
  });

  return app;
}

/** Holds one value for `ttlMs`; `set` returns the value so a miss reads `get() ?? set(await load())`. */
function ttlCache<T>(ttlMs: number, nowMs: () => number) {
  let entry: { value: T; expiresAt: number } | null = null;
  return {
    get: (): T | undefined => (entry && nowMs() < entry.expiresAt ? entry.value : undefined),
    set: (value: T): T => {
      entry = { value, expiresAt: nowMs() + ttlMs };
      return value;
    },
  };
}

function scanFailure(c: Context, failure: ScanFailure) {
  if (failure.retryAfterSeconds) c.header("Retry-After", String(failure.retryAfterSeconds));
  return c.json(
    { error: failure.error, code: failure.code, ...(failure.issues.length > 0 ? { issues: failure.issues } : {}) },
    failure.status,
  );
}

function scanMalformed(c: Context) {
  return c.json(
    {
      error: "Send a JSON body with the attestation (and, to submit, message, signature and owner); use the link `pnpm scan finish` printed.",
      code: "malformed_request",
    },
    400,
  );
}

function scanRateLimited(c: Context, limiter: RateLimiter, nowMs: number) {
  const seconds = limiter.retryAfterSeconds(clientIp(c), nowMs);
  c.header("Retry-After", String(seconds));
  const wait = seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
  return c.json({ error: `Too many scan requests from this address; try again in about ${wait}.`, code: "rate_limited" }, 429);
}

const MALFORMED_JSON = "Malformed JSON in request body";

function jsonBody<S extends z.ZodType>(schema: S, error = "Malformed request.") {
  return zValidator("json", schema, (result, c) => {
    if (!result.success) return c.json({ error }, 400);
  });
}

function scanBody<S extends z.ZodType>(schema: S) {
  return zValidator("json", schema, (result, c) => {
    if (!result.success) return scanMalformed(c);
  });
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
