import { parseAttestation, type Attestation, type ParseAttestationResult } from "./attestation";
import { canonicalJson } from "./canonical";
import { base64UrlToBytes, bytesToBase64Url } from "../vault/base64";

/**
 * The `attest.html#<payload>` fragment: base64url (no padding) of the UTF-8
 * canonical JSON. The static page decodes it in plain JS, so there is no
 * compression or other framing.
 */
export function encodeAttestationPayload(attestation: Attestation): string {
  return bytesToBase64Url(new TextEncoder().encode(canonicalJson(attestation)));
}

/** Decodes a payload and runs it through `parseAttestation`, so only a valid attestation comes out. */
export function decodeAttestationPayload(payload: string): ParseAttestationResult {
  let value: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("not base64url");
    const bytes = base64UrlToBytes(payload);
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return {
      ok: false,
      issues: [{ code: "not-an-object", path: "$", message: "The link's payload isn't base64url of a JSON attestation; use the link `pnpm scan finish` printed, unchanged." }],
    };
  }
  return parseAttestation(value);
}
