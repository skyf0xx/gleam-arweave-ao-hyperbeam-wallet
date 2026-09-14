/**
 * Pre-upload secret scan (PRD/CLAUDE.md item 7 — "reject if payload looks
 * like a private key/JWK/PEM block"). Pure domain logic: no chrome
 * extension API, window, or document dependency, per core-design.md's
 * "core package logic has zero chrome/window/document dependency" rule.
 *
 * Heuristic, not exhaustive, per this task's packet ("this doesn't need
 * to be perfect, just catch the obvious cases per the spec's intent") —
 * it catches the shapes the spec names explicitly (PEM headers,
 * JWK-shaped JSON, raw base64 key-sized blobs) and nothing more exotic.
 */

export type SecretScanResult = { flagged: true; matchType: string } | { flagged: false };

const PEM_HEADER_PATTERN = /-----BEGIN [A-Z0-9 ]+-----/;

/**
 * Arweave JWKs (RFC 7517 RSA private keys) always carry `kty: "RSA"` plus
 * the private-exponent field `d` — a public-only JWK never has `d`. `n`/`e`
 * are present on both public and private RSA JWKs, so `d`'s presence is
 * the actual private-vs-public signal; `kty` alone would false-positive on
 * any public key payload.
 */
const JWK_PRIVATE_FIELDS = ["kty", "n", "e", "d"];

/**
 * A bare base64(url)-encoded blob long enough to plausibly be raw
 * symmetric/private key material (256+ bits => 43+ base64 chars with no
 * padding). Deliberately loose: this only fires when the *entire*
 * trimmed payload is one base64 token, not when a long base64 string
 * appears inside otherwise-ordinary text.
 */
const BARE_BASE64_BLOB_PATTERN = /^[A-Za-z0-9+/_-]{86,}={0,2}$/;

function toText(payload: string | Uint8Array): string {
  if (typeof payload === "string") return payload;
  return new TextDecoder().decode(payload);
}

function looksLikeJwkPrivateKey(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object") return false;

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  return candidates.some((candidate) => {
    if (candidate === null || typeof candidate !== "object") return false;
    const record = candidate as Record<string, unknown>;
    return JWK_PRIVATE_FIELDS.every((field) => typeof record[field] === "string" && record[field] !== "");
  });
}

/**
 * Detects payloads that look like a private key, JWK, or PEM block.
 * Returns the specific match type on a hit (e.g. `"PEM block"`, `"JWK"`,
 * `"raw key material"`) so callers can state it plainly rather than a
 * generic warning (RELEVANT RULES: "stating the specific match type").
 */
export function scanForSecrets(payload: string | Uint8Array): SecretScanResult {
  const text = toText(payload);
  const trimmed = text.trim();

  if (PEM_HEADER_PATTERN.test(text)) {
    return { flagged: true, matchType: "PEM block" };
  }

  if (looksLikeJwkPrivateKey(trimmed)) {
    return { flagged: true, matchType: "JWK" };
  }

  if (BARE_BASE64_BLOB_PATTERN.test(trimmed)) {
    return { flagged: true, matchType: "raw key material" };
  }

  return { flagged: false };
}
