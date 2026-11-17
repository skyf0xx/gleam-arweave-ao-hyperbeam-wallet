import { describe, expect, it } from "vitest";
import { attestFailure, serverAttestFailure } from "./attest-errors";
import type { SiteAttestErrorCode } from "@gleam/messaging/src/site-protocol.ts";

// Every code the site protocol defines, so a code added without a sentence fails here.
const ALL_CODES: SiteAttestErrorCode[] = [
  "refused",
  "invalid_attestation",
  "malformed_request",
  "no_wallet",
  "unsupported_wallet",
  "busy",
  "rejected",
  "timed_out",
  "signing_failed",
  "offline",
  "message_mismatch",
  "invalid_signature",
  "wallet_not_registered",
  "wallet_not_live",
  "no_release",
  "unknown_release",
  "release_not_latest",
  "commit_mismatch",
  "challenge_unknown",
  "challenge_wrong_release",
  "challenge_wrong_commit",
  "challenge_expired",
  "challenge_used",
  "answers_failed",
  "already_attested",
  "rate_limited",
  "github_unavailable",
  "challenge_unavailable",
  "server_error",
];

describe("attestFailure", () => {
  it("gives every error code a non-empty sentence", () => {
    for (const code of ALL_CODES) {
      const res = attestFailure(code, "1.48.0");
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("expected a failure");
      expect(res.code).toBe(code);
      expect(typeof res.error).toBe("string");
      expect(res.error.length).toBeGreaterThan(0);
    }
  });

  it("embeds server detail only in the signing_failed sentence, with a trailing period stripped", () => {
    const res = attestFailure("signing_failed", "1.48.0", "device broke.");
    if (res.ok) throw new Error("expected a failure");
    expect(res.error).toBe("Gleam couldn't sign the attestation: device broke. Try again from the link.");
  });

  it("never echoes a detail for codes that take none", () => {
    const res = attestFailure("answers_failed", "1.48.0", "server said boom");
    if (res.ok) throw new Error("expected a failure");
    expect(res.error).not.toContain("boom");
  });
});

describe("serverAttestFailure", () => {
  it("maps a known server code to that code and never echoes the server's error text", () => {
    const res = serverAttestFailure(400, { code: "answers_failed", error: "server said boom" }, "1.48.0");
    if (res.ok) throw new Error("expected a failure");
    expect(res.code).toBe("answers_failed");
    expect(res.error).not.toContain("boom");
  });

  it("maps an unknown server code to server_error without echoing the code; the server's error text surfaces only in that one sentence", () => {
    const res = serverAttestFailure(400, { code: "something_new", error: "server said boom" }, "1.48.0");
    if (res.ok) throw new Error("expected a failure");
    expect(res.code).toBe("server_error");
    expect(res.error).not.toContain("something_new");
    expect(res.error).toBe("The points server refused the attestation: server said boom. Open the link again later.");
  });

  it("maps 429 to rate_limited and 413 to invalid_attestation", () => {
    const rateLimited = serverAttestFailure(429, null, "1.48.0");
    if (rateLimited.ok) throw new Error("expected a failure");
    expect(rateLimited.code).toBe("rate_limited");
    const invalidAttestation = serverAttestFailure(413, null, "1.48.0");
    if (invalidAttestation.ok) throw new Error("expected a failure");
    expect(invalidAttestation.code).toBe("invalid_attestation");
  });

  it("falls back to server_error with the HTTP status when the body carries nothing usable", () => {
    const res = serverAttestFailure(500, null, "1.48.0");
    if (res.ok) throw new Error("expected a failure");
    expect(res.code).toBe("server_error");
    expect(res.error).toContain("HTTP 500");
  });
});
