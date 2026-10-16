import { describe, expect, it } from "vitest";
import { attestationId, parseAttestation } from "./attestation";
import { decodeAttestationPayload, encodeAttestationPayload } from "./payload";

const attestation = {
  release: "1.4.0",
  commit: "a".repeat(40),
  model: "claude-opus-5-5",
  challenge: "A".repeat(22),
  answers: [
    { file: "packages/core/src/a.ts", symbol: "one", line: 3, check: "Rejects a negative amount before signing." },
    { file: "packages/core/src/b.ts", symbol: "two", line: 9, check: "Refuses an empty address — “quoted” ✓." },
    { file: "packages/core/src/c.tsx", symbol: "Three.run", line: 12, check: "Checks the origin matches the approved one." },
  ],
  result: "pass",
  report: "Read the surface.\nNo issues; 日本語 and emoji 🦔 survive.",
};

describe("attestation payload", () => {
  it("round-trips to the same attestation and id", async () => {
    const parsed = parseAttestation(attestation);
    if (!parsed.ok) throw new Error("fixture invalid");
    const payload = encodeAttestationPayload(parsed.attestation);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeAttestationPayload(payload);
    if (!decoded.ok) throw new Error("decode failed");
    expect(decoded.attestation).toEqual(parsed.attestation);
    expect(await attestationId(decoded.attestation)).toBe(await attestationId(parsed.attestation));
  });

  it("rejects garbage and invalid attestations with an issue", () => {
    expect(decodeAttestationPayload("not base64!").ok).toBe(false);
    expect(decodeAttestationPayload("e30").ok).toBe(false);
    expect(decodeAttestationPayload("").ok).toBe(false);
  });
});
