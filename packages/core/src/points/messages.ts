/**
 * The plain-text payloads Gleam Points signs (see POINTS.md § Identity).
 * The extension builds them and the points API parses them, so both sides
 * share one definition of each format.
 *
 * Every payload starts with `gleam-points:` and a kind, so a signature
 * over one can never be replayed as another kind, as a transaction, or as
 * a dApp `signMessage` request.
 */

export const POINTS_MESSAGE_PREFIX = "gleam-points:";

/** How old a signed payload's `issuedAt` may be before the server rejects it. */
export const POINTS_MESSAGE_MAX_AGE_SECONDS = 600;

/** Clock skew tolerated for an `issuedAt` slightly in the future. */
const MAX_FUTURE_SKEW_SECONDS = 60;

const INVITE_CODE_PATTERN = /^[A-Z0-9]{6,16}$/;
const THUMBPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UNIX_SECONDS_PATTERN = /^\d{1,12}$/;

export function isValidInviteCode(code: string): boolean {
  return INVITE_CODE_PATTERN.test(code);
}

/** Invite codes are typed by hand, so case and surrounding spaces don't matter. */
export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface RegisterMessage {
  deviceKeyThumbprint: string;
  inviteCode: string | null;
  issuedAt: number;
}

/** Signed by the wallet's RSA key, binding its address to an install's device key. */
export function buildRegisterMessage(message: RegisterMessage): string {
  if (!THUMBPRINT_PATTERN.test(message.deviceKeyThumbprint)) {
    throw new Error("Device key thumbprint must be a 43-character base64url SHA-256 digest.");
  }
  if (message.inviteCode !== null && !isValidInviteCode(message.inviteCode)) {
    throw new Error(`"${message.inviteCode}" isn't a valid invite code.`);
  }
  assertUnixSeconds(message.issuedAt);
  return [
    "gleam-points",
    "register",
    "v1",
    message.deviceKeyThumbprint,
    message.inviteCode ?? "-",
    String(message.issuedAt),
  ].join(":");
}

export function parseRegisterMessage(text: string): RegisterMessage | null {
  const parts = text.split(":");
  if (parts.length !== 6) return null;
  const [scheme, kind, version, thumbprint, inviteCode, issuedAt] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (scheme !== "gleam-points" || kind !== "register" || version !== "v1") return null;
  if (!THUMBPRINT_PATTERN.test(thumbprint)) return null;
  if (inviteCode !== "-" && !isValidInviteCode(inviteCode)) return null;
  if (!UNIX_SECONDS_PATTERN.test(issuedAt)) return null;
  return {
    deviceKeyThumbprint: thumbprint,
    inviteCode: inviteCode === "-" ? null : inviteCode,
    issuedAt: Number(issuedAt),
  };
}

const ADDRESS_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Signed by the wallet's RSA key to leave Gleam Points and delete its
 * data. Naming the address binds the signature to that one wallet.
 */
export function buildLeaveMessage(address: string, issuedAt: number): string {
  if (!ADDRESS_PATTERN.test(address)) throw new Error(`"${address}" isn't an Arweave address.`);
  assertUnixSeconds(issuedAt);
  return `gleam-points:leave:v1:${address}:${issuedAt}`;
}

export function parseLeaveMessage(text: string): { address: string; issuedAt: number } | null {
  const parts = text.split(":");
  if (parts.length !== 5) return null;
  const [scheme, kind, version, address, issuedAt] = parts as [string, string, string, string, string];
  if (scheme !== "gleam-points" || kind !== "leave" || version !== "v1") return null;
  if (!ADDRESS_PATTERN.test(address) || !UNIX_SECONDS_PATTERN.test(issuedAt)) return null;
  return { address, issuedAt: Number(issuedAt) };
}

/** Device-key-signed payloads that carry only a timestamp. */
export type DeviceMessageKind = "heartbeat" | "me";

export function buildDeviceMessage(kind: DeviceMessageKind, issuedAt: number): string {
  assertUnixSeconds(issuedAt);
  return `gleam-points:${kind}:v1:${issuedAt}`;
}

/** Returns the payload's `issuedAt`, or null if it isn't a `kind` payload. */
export function parseDeviceMessage(kind: DeviceMessageKind, text: string): number | null {
  const parts = text.split(":");
  if (parts.length !== 4) return null;
  const [scheme, parsedKind, version, issuedAt] = parts as [string, string, string, string];
  if (scheme !== "gleam-points" || parsedKind !== kind || version !== "v1") return null;
  if (!UNIX_SECONDS_PATTERN.test(issuedAt)) return null;
  return Number(issuedAt);
}

export function isFreshIssuedAt(issuedAt: number, nowSeconds: number): boolean {
  return (
    issuedAt <= nowSeconds + MAX_FUTURE_SKEW_SECONDS &&
    nowSeconds - issuedAt <= POINTS_MESSAGE_MAX_AGE_SECONDS
  );
}

function assertUnixSeconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || !UNIX_SECONDS_PATTERN.test(String(value))) {
    throw new Error(`issuedAt must be a non-negative whole number of Unix seconds, got ${value}.`);
  }
}
