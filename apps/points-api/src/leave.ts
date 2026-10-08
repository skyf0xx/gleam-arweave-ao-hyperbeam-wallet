import { addressFromOwner, isFreshIssuedAt, parseLeaveMessage } from "@gleam/core/src/points/index.ts";
import { base64UrlToBytes } from "@gleam/core/src/vault/base64.ts";
import { verifyMessage } from "@gleam/core/src/vault/message-signing.ts";
import type { Db } from "./db";

export interface LeaveRequest {
  owner: string;
  message: string;
  signature: string;
}

export type LeaveOutcome = { ok: true } | { ok: false; status: 400 | 401; error: string };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function parseLeaveRequest(body: unknown): LeaveRequest | null {
  if (body === null || typeof body !== "object") return null;
  const { owner, message, signature } = body as Record<string, unknown>;
  if (typeof owner !== "string" || owner.length > 700 || !BASE64URL.test(owner)) return null;
  if (typeof message !== "string" || message.length > 200) return null;
  if (typeof signature !== "string" || signature.length > 1000 || !BASE64URL.test(signature)) return null;
  return { owner, message, signature };
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

  let signatureValid = false;
  try {
    signatureValid =
      (await addressFromOwner(request.owner)) === message.address &&
      (await verifyMessage(
        request.owner,
        new TextEncoder().encode(request.message).buffer as ArrayBuffer,
        base64UrlToBytes(request.signature).buffer,
      ));
  } catch {
    // An owner that isn't a usable RSA modulus fails verification.
  }
  if (!signatureValid) return { ok: false, status: 401, error: "Wallet signature is invalid." };

  await db.transaction(async (tx) => {
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
