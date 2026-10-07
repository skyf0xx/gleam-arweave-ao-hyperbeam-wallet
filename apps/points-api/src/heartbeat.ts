import {
  isFreshIssuedAt,
  parseDeviceMessage,
  verifyDeviceSignature,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import type { Queryable } from "./db";

export interface DeviceSignedRequest {
  deviceId: string;
  message: string;
  signature: string;
}

export type DeviceAuthOutcome = { ok: true; deviceId: string } | { ok: false; status: 400 | 401 | 404; error: string };

const THUMBPRINT = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function parseDeviceSignedRequest(body: unknown): DeviceSignedRequest | null {
  if (body === null || typeof body !== "object") return null;
  const { deviceId, message, signature } = body as Record<string, unknown>;
  if (typeof deviceId !== "string" || !THUMBPRINT.test(deviceId)) return null;
  if (typeof message !== "string" || message.length > 100) return null;
  if (typeof signature !== "string" || signature.length > 200 || !BASE64URL.test(signature)) return null;
  return { deviceId, message, signature };
}

/** Checks a device-signed `heartbeat` or `me` request against the stored device key. */
export async function authenticateDevice(
  db: Queryable,
  kind: "heartbeat" | "me",
  request: DeviceSignedRequest,
  now: Date,
): Promise<DeviceAuthOutcome> {
  const issuedAt = parseDeviceMessage(kind, request.message);
  if (issuedAt === null) return { ok: false, status: 400, error: `Malformed ${kind} message.` };
  if (!isFreshIssuedAt(issuedAt, Math.floor(now.getTime() / 1000))) {
    return { ok: false, status: 401, error: `${kind} message is stale.` };
  }

  const device = await db.query<{ public_key_jwk: DevicePublicJwk }>(
    "SELECT public_key_jwk FROM devices WHERE id = $1",
    [request.deviceId],
  );
  const publicKey = device.rows[0]?.public_key_jwk;
  if (!publicKey) return { ok: false, status: 404, error: "Unknown device." };
  if (!(await verifyDeviceSignature(publicKey, request.message, request.signature))) {
    return { ok: false, status: 401, error: "Device signature is invalid." };
  }
  return { ok: true, deviceId: request.deviceId };
}

export async function recordHeartbeat(db: Queryable, deviceId: string, now: Date): Promise<void> {
  await db.query("UPDATE devices SET last_heartbeat_at = $2 WHERE id = $1", [deviceId, now]);
}
