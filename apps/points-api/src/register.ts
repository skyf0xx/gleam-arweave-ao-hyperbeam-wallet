import {
  addressFromOwner,
  deviceKeyThumbprint,
  isDevicePublicJwk,
  isFreshIssuedAt,
  parseRegisterMessage,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import { base64UrlToBytes } from "@gleam/core/src/vault/base64.ts";
import { verifyMessage } from "@gleam/core/src/vault/message-signing.ts";
import type { Db, Queryable } from "./db";

export interface RegisterRequest {
  owner: string;
  message: string;
  signature: string;
  devicePublicKey: DevicePublicJwk;
}

export interface RegisterResult {
  address: string;
  inviteCode: string;
  /** Whether the wallet is credited as referred, by this or an earlier registration. */
  referred: boolean;
}

export type RegisterOutcome =
  | { ok: true; result: RegisterResult }
  | { ok: false; status: 400 | 401; error: string }
  | { ok: false; status: 403; error: string; code: "invite_required" };

const INVITE_REQUIRED = { ok: false, status: 403, error: "Invite required.", code: "invite_required" } as const;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_OWNER_LENGTH = 700;
const MAX_INVITE_CODE_ATTEMPTS = 5;

export function parseRegisterRequest(body: unknown): RegisterRequest | null {
  if (body === null || typeof body !== "object") return null;
  const { owner, message, signature, devicePublicKey } = body as Record<string, unknown>;
  if (typeof owner !== "string" || owner.length > MAX_OWNER_LENGTH || !BASE64URL.test(owner)) return null;
  if (typeof message !== "string" || message.length > 200) return null;
  if (typeof signature !== "string" || signature.length > 1000 || !BASE64URL.test(signature)) return null;
  if (!isDevicePublicJwk(devicePublicKey)) return null;
  return { owner, message, signature, devicePublicKey };
}

/**
 * Binds a wallet to the install's device key. Registering also counts as
 * a heartbeat, so the wallet is live from its first snapshot.
 *
 * Registering an already-known wallet moves it to the new device (a
 * reinstall) and keeps its invite code and referrer. An invite code
 * counts only for the first wallet an install registers; an unknown code
 * is ignored rather than failing the registration.
 *
 * During Phase 1 a new wallet needs an install that redeemed an invite or
 * already has a registered wallet. Re-registering is always allowed, so a
 * founder who reinstalls gets back in.
 *
 * A new wallet registered during Phase 1 takes the next founding number
 * from a sequence, which is atomic across concurrent registrations and
 * never hands a number out twice, even after its wallet leaves.
 */
export async function register(
  db: Db,
  request: RegisterRequest,
  now: Date,
  newInviteCode: () => string,
  pointsPhase: 1 | 2,
): Promise<RegisterOutcome> {
  const message = parseRegisterMessage(request.message);
  if (!message) return { ok: false, status: 400, error: "Malformed register message." };
  if (!isFreshIssuedAt(message.issuedAt, Math.floor(now.getTime() / 1000))) {
    return { ok: false, status: 401, error: "Register message is stale." };
  }
  if ((await deviceKeyThumbprint(request.devicePublicKey)) !== message.deviceKeyThumbprint) {
    return { ok: false, status: 400, error: "Device key doesn't match the signed thumbprint." };
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyMessage(
      request.owner,
      new TextEncoder().encode(request.message).buffer as ArrayBuffer,
      base64UrlToBytes(request.signature).buffer,
    );
  } catch {
    // An owner that isn't a usable RSA modulus fails verification.
  }
  if (!signatureValid) return { ok: false, status: 401, error: "Wallet signature is invalid." };

  const address = await addressFromOwner(request.owner);
  const deviceId = message.deviceKeyThumbprint;

  return db.transaction(async (tx): Promise<RegisterOutcome> => {
    const existing = await tx.query<{ invite_code: string; referred_by: string | null }>(
      "SELECT invite_code, referred_by FROM wallets WHERE address = $1 FOR UPDATE",
      [address],
    );
    // Checked before the device upsert, so a refused install leaves no
    // device row and an existing device's heartbeat isn't bumped.
    if (!existing.rows[0] && pointsPhase === 1 && !(await installMayAddWallet(tx, deviceId))) return INVITE_REQUIRED;

    await tx.query(
      `INSERT INTO devices (id, public_key_jwk, last_heartbeat_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET last_heartbeat_at = EXCLUDED.last_heartbeat_at`,
      [deviceId, JSON.stringify(request.devicePublicKey), now],
    );

    if (existing.rows[0]) {
      await tx.query("UPDATE wallets SET device_id = $1 WHERE address = $2", [deviceId, address]);
      const { invite_code, referred_by } = existing.rows[0];
      return { ok: true, result: { address, inviteCode: invite_code, referred: referred_by !== null } };
    }

    const referredBy = message.inviteCode ? await referrerFor(tx, deviceId, message.inviteCode, address) : null;
    const inviteCode = await insertWallet(tx, { address, deviceId, referredBy, now, pointsPhase }, newInviteCode);
    return { ok: true, result: { address, inviteCode, referred: referredBy !== null } };
  });
}

async function installMayAddWallet(tx: Queryable, deviceId: string): Promise<boolean> {
  const { rows } = await tx.query<{ allowed: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM invite_redemptions WHERE device_id = $1)
         OR EXISTS (SELECT 1 FROM wallets WHERE device_id = $1) AS allowed`,
    [deviceId],
  );
  return rows[0]?.allowed === true;
}

async function referrerFor(tx: Queryable, deviceId: string, inviteCode: string, address: string): Promise<string | null> {
  const deviceWallets = await tx.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM wallets WHERE device_id = $1",
    [deviceId],
  );
  if (deviceWallets.rows[0]?.count !== "0") return null;
  const referrer = await tx.query<{ address: string }>("SELECT address FROM wallets WHERE invite_code = $1", [
    inviteCode,
  ]);
  const referrerAddress = referrer.rows[0]?.address ?? null;
  return referrerAddress === address ? null : referrerAddress;
}

async function insertWallet(
  tx: Queryable,
  wallet: { address: string; deviceId: string; referredBy: string | null; now: Date; pointsPhase: 1 | 2 },
  newInviteCode: () => string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt++) {
    const inviteCode = newInviteCode();
    const inserted = await tx.query<{ invite_code: string }>(
      `INSERT INTO wallets (address, device_id, invite_code, referred_by, registered_at, founding_number)
       SELECT $1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN nextval('founding_number_seq')::integer END
        WHERE NOT EXISTS (SELECT 1 FROM drop_codes WHERE code = $3)
       ON CONFLICT (invite_code) DO NOTHING
       RETURNING invite_code`,
      [wallet.address, wallet.deviceId, inviteCode, wallet.referredBy, wallet.now, wallet.pointsPhase === 1],
    );
    if (inserted.rows[0]) return inserted.rows[0].invite_code;
  }
  throw new Error("Couldn't generate a unique invite code.");
}
