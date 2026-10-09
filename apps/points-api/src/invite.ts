import {
  deviceKeyThumbprint,
  isDevicePublicJwk,
  isFreshIssuedAt,
  isValidInviteCode,
  normalizeInviteCode,
  parseRedeemMessage,
  verifyDeviceSignature,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import type { Db, Queryable } from "./db";

export const MEMBER_CODE_SEATS = 3;

/**
 * Redemptions of a member code whose install hasn't registered a wallet
 * yet, for the code in `wallets` alias `w`. Only these hold a seat: once
 * the let-in install registers, its seat goes back to the member. If that
 * install later leaves, its device and redemption are deleted, so the
 * count doesn't change either way.
 */
export const PENDING_MEMBER_REDEMPTIONS_SQL = `(SELECT count(*) FROM invite_redemptions ir
   WHERE ir.code = w.invite_code
     AND NOT EXISTS (SELECT 1 FROM wallets x WHERE x.device_id = ir.device_id))`;

export function memberSeatsLeft(pendingRedemptions: number, pointsPhase: 1 | 2): number | null {
  return pointsPhase === 1 ? Math.max(0, MEMBER_CODE_SEATS - pendingRedemptions) : null;
}

export type InviteCodeKind = "member" | "drop";

/**
 * `seatsLeft` is null when the code is unknown or has no seat limit (a
 * drop code with no seat count, or any code in Phase 2). A full code has
 * `seatsLeft: 0`.
 */
export type InviteCheck =
  | { exists: false; kind: null; seatsLeft: null }
  | { exists: true; kind: InviteCodeKind; seatsLeft: number | null };

export type RedeemResult = "ok" | "full" | "unknown";

export interface RedeemRequest {
  code: string;
  message: string;
  signature: string;
  devicePublicKey: DevicePublicJwk;
}

export type RedeemOutcome = { ok: true; result: RedeemResult } | { ok: false; status: 400 | 401; error: string };

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_RAW_CODE_LENGTH = 64;

/** Returns the trimmed, uppercased code, or null if it isn't a well-formed one. */
export function parseInviteCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_RAW_CODE_LENGTH) return null;
  const code = normalizeInviteCode(value);
  return isValidInviteCode(code) ? code : null;
}

export function parseRedeemRequest(body: unknown): RedeemRequest | null {
  if (body === null || typeof body !== "object") return null;
  const { code, message, signature, devicePublicKey } = body as Record<string, unknown>;
  const parsedCode = parseInviteCode(code);
  if (!parsedCode) return null;
  if (typeof message !== "string" || message.length > 100) return null;
  if (typeof signature !== "string" || signature.length > 200 || !BASE64URL.test(signature)) return null;
  if (!isDevicePublicJwk(devicePublicKey)) return null;
  return { code: parsedCode, message, signature, devicePublicKey };
}

export async function checkInviteCode(db: Queryable, code: string, pointsPhase: 1 | 2): Promise<InviteCheck> {
  const found = await seatsForCode(db, code, pointsPhase, false);
  return found ? { exists: true, ...found } : { exists: false, kind: null, seatsLeft: null };
}

/**
 * Takes a seat on `code` for the install that signed the request and
 * creates its device row if it's new. An install redeems once: asking
 * again answers `ok` without taking another seat, whichever code it
 * sends. Seats are limited only in Phase 1; in Phase 2 a known code is
 * always `ok` and the redemption is still recorded.
 */
export async function redeemInviteCode(
  db: Db,
  request: RedeemRequest,
  now: Date,
  pointsPhase: 1 | 2,
): Promise<RedeemOutcome> {
  const message = parseRedeemMessage(request.message);
  if (!message) return { ok: false, status: 400, error: "Malformed redeem message." };
  if (message.code !== request.code) {
    return { ok: false, status: 400, error: "Invite code doesn't match the signed message." };
  }
  if (!isFreshIssuedAt(message.issuedAt, Math.floor(now.getTime() / 1000))) {
    return { ok: false, status: 401, error: "Redeem message is stale." };
  }
  if (!(await verifyDeviceSignature(request.devicePublicKey, request.message, request.signature))) {
    return { ok: false, status: 401, error: "Device signature is invalid." };
  }
  const deviceId = await deviceKeyThumbprint(request.devicePublicKey);

  const result = await db.transaction(async (tx): Promise<RedeemResult> => {
    const already = await tx.query("SELECT 1 FROM invite_redemptions WHERE device_id = $1", [deviceId]);
    if (already.rows.length > 0) return "ok";

    const found = await seatsForCode(tx, request.code, pointsPhase, true);
    if (!found) return "unknown";
    if (found.seatsLeft === 0) return "full";

    // The id is the key's thumbprint, so an existing row already holds this key.
    const { kty, crv, x, y } = request.devicePublicKey;
    await tx.query("INSERT INTO devices (id, public_key_jwk) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [
      deviceId,
      JSON.stringify({ kty, crv, x, y }),
    ]);
    // Two requests from the same new install race on the primary key; the
    // loser has nothing left to do, since that install now holds a seat.
    await tx.query(
      "INSERT INTO invite_redemptions (device_id, code, redeemed_at) VALUES ($1, $2, $3) ON CONFLICT (device_id) DO NOTHING",
      [deviceId, request.code, now],
    );
    return "ok";
  });
  return { ok: true, result };
}

/**
 * With `lock`, holds the code's owning row (the member's wallet or the
 * drop code) until the transaction ends, so concurrent redemptions of the
 * same code count seats one at a time and can't both take the last one.
 * Seats are counted in a statement after the lock, so the count sees
 * whatever the previous holder committed.
 *
 * The wallet is locked `FOR NO KEY UPDATE` because `FOR UPDATE` would also
 * block the `KEY SHARE` lock that registering a wallet it referred takes
 * through the `referred_by` foreign key.
 */
async function seatsForCode(
  db: Queryable,
  code: string,
  pointsPhase: 1 | 2,
  lock: boolean,
): Promise<{ kind: InviteCodeKind; seatsLeft: number | null } | null> {
  if (lock) await db.query("SELECT 1 FROM wallets WHERE invite_code = $1 FOR NO KEY UPDATE", [code]);
  const member = await db.query<{ n: string }>(
    `SELECT ${PENDING_MEMBER_REDEMPTIONS_SQL}::text AS n FROM wallets w WHERE w.invite_code = $1`,
    [code],
  );
  if (member.rows[0]) return { kind: "member", seatsLeft: memberSeatsLeft(Number(member.rows[0].n), pointsPhase) };

  const drop = await db.query<{ seats: number | null }>(
    `SELECT seats FROM drop_codes WHERE code = $1 ${lock ? "FOR UPDATE" : ""}`,
    [code],
  );
  if (!drop.rows[0]) return null;
  const seats = drop.rows[0].seats;
  if (pointsPhase !== 1 || seats === null) return { kind: "drop", seatsLeft: null };
  const used = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM invite_redemptions WHERE code = $1", [
    code,
  ]);
  return { kind: "drop", seatsLeft: Math.max(0, seats - Number(used.rows[0]!.n)) };
}
