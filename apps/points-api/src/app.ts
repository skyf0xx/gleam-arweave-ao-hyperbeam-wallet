import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import {
  AttestationListCache,
  checkAttestation,
  countAttestations,
  listAttestations,
  parseListQuery,
  parseCheckRequest,
  parseSubmitRequest,
  scanRewardBasis,
  submitAttestation,
} from "./attestations";
import { poolBalance } from "./bounty";
import type { Db } from "./db";
import { createGithubClient, type GithubClient } from "./github";
import { authenticateDevice, parseDeviceSignedRequest, recordHeartbeat } from "./heartbeat";
import { checkInviteCode, parseInviteCode, parseRedeemRequest, redeemInviteCode } from "./invite";
import { randomInviteCode } from "./invite-code";
import { parseLeaveRequest, leave } from "./leave";
import { createPriceService, parseHistoryQuery, parseSpotQuery, type PriceService } from "./prices";
import { RateLimiter } from "./rate-limit";
import { parseRegisterRequest, register } from "./register";
import { issueChallenge } from "./scan-challenge";
import type { ScanFailure } from "./scan-errors";
import { scoresForDevice } from "./score";

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
  tailScanRewardAtomic: string;
  bountyPoolAtomic: string;
}

const HOUR_MS = 3_600_000;
const STATS_TTL_MS = 60_000;
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
  let rewardsCache: { body: ScanRewards; expiresAt: number } | null = null;
  let statsCache: { foundingMembers: number; expiresAt: number } | null = null;

  const app = new Hono();
  app.use("*", async (c, next) => {
    const limit = ATTESTATION_PATHS.includes(c.req.path) ? ATTESTATION_BODY_LIMIT : 16 * 1024;
    return bodyLimit({ maxSize: limit })(c, next);
  });

  // The extension calls these without a host permission, so the browser
  // enforces CORS on them. Any extension id is allowed so unpacked dev
  // builds work too; every one of these requests is checked on its own
  // merits, so the origin is never what authorises it.
  const extensionCors = cors({ origin: (origin) => (origin.startsWith("chrome-extension://") ? origin : null) });
  for (const path of ["/invite/redeem", "/register", "/heartbeat", "/leave", "/me", "/prices", "/prices/history"]) app.use(path, extensionCors);

  // Scan endpoints are open to any origin: the CLI sends no origin, the site
  // reads the list and rewards, and the signature (not the origin) authorises a submission.
  for (const path of [...ATTESTATION_PATHS, "/attestations/count", "/scan/challenge", "/scan/rewards"]) app.use(path, cors({ origin: "*" }));

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

  // Proxies CoinGecko/CoinPaprika for users whose network blocks them. Only
  // registry ids are accepted, so this can't be used to relay arbitrary lookups.
  app.get("/prices", async (c) => {
    if (!pricesByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const ids = parseSpotQuery(c.req.query());
    if (!ids) return c.json({ error: "Unknown or missing price ids." }, 400);
    return c.json({ prices: await prices.spot(ids) });
  });

  app.get("/prices/history", async (c) => {
    if (!pricesByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const query = parseHistoryQuery(c.req.query());
    if (!query) return c.json({ error: "Unknown price id or range." }, 400);
    return c.json({ series: await prices.history(query.id, query.range) });
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
    return outcome.ok ? c.json({ result: outcome.result, kind: outcome.kind }) : c.json({ error: outcome.error }, outcome.status);
  });

  app.post("/register", async (c) => {
    if (!registerByIp.allow(clientIp(c), now().getTime())) return tooManyRequests(c);
    const request = parseRegisterRequest(await readJson(c));
    if (!request) return c.json({ error: "Malformed request." }, 400);

    const outcome = await register(deps.db, request, now(), newInviteCode, pointsPhase);
    if (outcome.ok) return c.json(outcome.result);
    if (outcome.status === 403) return c.json({ error: outcome.error, code: outcome.code }, 403);
    return c.json({ error: outcome.error }, outcome.status);
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

  app.get("/scan/challenge", async (c) => {
    if (!challengeByIp.allow(clientIp(c), now().getTime())) return scanRateLimited(c, challengeByIp, now().getTime());
    const outcome = await issueChallenge(deps.db, github, now());
    return outcome.ok ? c.json(outcome.challenge) : scanFailure(c, outcome);
  });

  app.get("/scan/rewards", async (c) => {
    if (!rewardsByIp.allow(clientIp(c), now().getTime())) return scanRateLimited(c, rewardsByIp, now().getTime());
    if (!rewardsCache || now().getTime() >= rewardsCache.expiresAt) {
      const [basis, pool] = await Promise.all([scanRewardBasis(deps.db, now()), poolBalance(deps.db)]);
      rewardsCache = {
        body: {
          day: basis.day,
          issuedAtomic: basis.issuedAtomic.toString(),
          scanRewardAtomic: basis.rewardAtomic.toString(),
          tailScanRewardAtomic: basis.tailRewardAtomic.toString(),
          bountyPoolAtomic: pool.toString(),
        },
        expiresAt: now().getTime() + STATS_TTL_MS,
      };
    }
    c.header("Cache-Control", "public, max-age=60");
    return c.json(rewardsCache.body);
  });

  app.post("/attestations/check", async (c) => {
    if (!checkByIp.allow(clientIp(c), now().getTime())) return scanRateLimited(c, checkByIp, now().getTime());
    const request = parseCheckRequest(await readJson(c));
    if (!request) return scanMalformed(c);
    const outcome = await checkAttestation(deps.db, github, request, now());
    return outcome.ok ? c.json({ ok: true, ...outcome.result }) : scanFailure(c, outcome);
  });

  app.post("/attestations", async (c) => {
    if (!attestByIp.allow(clientIp(c), now().getTime())) return scanRateLimited(c, attestByIp, now().getTime());
    const request = parseSubmitRequest(await readJson(c));
    if (!request) return scanMalformed(c);
    const outcome = await submitAttestation(deps.db, github, request, now(), attestationListings);
    return outcome.ok ? c.json({ ok: true, ...outcome.result }) : scanFailure(c, outcome);
  });

  app.get("/attestations/count", async (c) => {
    if (!attestationsListByIp.allow(clientIp(c), now().getTime())) return scanRateLimited(c, attestationsListByIp, now().getTime());
    const outcome = await countAttestations(deps.db, c.req.query());
    if (!outcome.ok) return scanFailure(c, outcome);
    c.header("Cache-Control", "public, max-age=60");
    return c.json({ release: outcome.release, total: outcome.total, paidPlacesLeft: outcome.paidPlacesLeft });
  });

  app.get("/attestations", async (c) => {
    if (!attestationsListByIp.allow(clientIp(c), now().getTime())) return scanRateLimited(c, attestationsListByIp, now().getTime());
    const query = parseListQuery(c.req.query());
    if ("ok" in query) return scanFailure(c, query);
    const outcome = await listAttestations(deps.db, github, attestationListings, query);
    if (!outcome.ok) return scanFailure(c, outcome);
    c.header("Cache-Control", "public, max-age=60");
    return c.json(outcome.listing);
  });

  return app;
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
