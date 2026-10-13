import {
  addressFromOwner,
  isFreshIssuedAt,
  parseLeaveMessage,
  verifyPointsProof,
  type PointsProofKind,
} from "@gleam/core/src/points/index.ts";
import type { Db } from "./db";

export interface LeaveRequest {
  owner: string;
  message: string;
  signature: string;
  /** `transaction` for a hardware wallet; see `core/points/ownership.ts`. */
  proof: PointsProofKind;
}

export type LeaveOutcome = { ok: true } | { ok: false; status: 400 | 401; error: string };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function parseLeaveRequest(body: unknown): LeaveRequest | null {
  if (body === null || typeof body !== "object") return null;
  const { owner, message, signature, proof = "message" } = body as Record<string, unknown>;
  if (typeof owner !== "string" || owner.length > 700 || !BASE64URL.test(owner)) return null;
  if (typeof message !== "string" || message.length > 200) return null;
  if (typeof signature !== "string" || signature.length > 1000 || !BASE64URL.test(signature)) return null;
  if (proof !== "message" && proof !== "transaction") return null;
  return { owner, message, signature, proof };
}

/**
 * Deletes a wallet and everything stored about it (cascading to its
 * snapshots and points), plus its device once no other wallet uses it.
 * Leaving an address that isn't registered succeeds, so a retry after a
 * lost response is harmless.
 */
export async function leave(db: Db, request: LeaveRequest, now: Date): Promise<LeaveOutcome> {
  const message = parseLeaveMessage(request.message);
  if (!message) return { ok: false, status: 400, error: "Malformed leave message." };
  if (!isFreshIssuedAt(message.issuedAt, Math.floor(now.getTime() / 1000))) {
    return { ok: false, status: 401, error: "Leave message is stale." };
  }

  let ownsAddress = false;
  try {
    ownsAddress = (await addressFromOwner(request.owner)) === message.address;
  } catch {
    // An owner that isn't base64url names no address.
  }
  if (!ownsAddress || !(await verifyPointsProof(request.proof, request.owner, request.message, request.signature))) return { ok: false, status: 401, error: "Wallet signature is invalid." };

  await db.transaction(async (tx) => {
    // Lock the device before the wallet, as register does, so a register
    // can't add a wallet to the device between our delete and its cleanup.
    const current = await tx.query<{ device_id: string }>("SELECT device_id FROM wallets WHERE address = $1", [
      message.address,
    ]);
    if (current.rows[0]) {
      await tx.query("SELECT 1 FROM devices WHERE id = $1 FOR UPDATE", [current.rows[0].device_id]);
    }
    const deleted = await tx.query<{ device_id: string }>(
      "DELETE FROM wallets WHERE address = $1 RETURNING device_id",
      [message.address],
    );
    const deviceId = deleted.rows[0]?.device_id;
    if (deviceId) {
      await tx.query(
        "DELETE FROM devices WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM wallets WHERE device_id = $1)",
        [deviceId],
      );
    }
  });
  return { ok: true };
}
