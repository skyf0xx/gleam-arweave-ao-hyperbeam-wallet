import { describe, expect, it } from "vitest";
import { scanForSecrets } from "./secret-scan";

const REAL_PEM_BLOCK = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
MZDIVaVZ4tGpxA9L+7EacoZo/EU4CFN4Z1KVOJ0O3d5PHT+p0OFo1TqTz2/z6qkm
-----END PRIVATE KEY-----`;

const REAL_JWK = JSON.stringify({
  kty: "RSA",
  n: "sXchDaQebHnPiGvyDOAT4saGEUetSyo9MKLOoWFsueri23bOdgWJ",
  e: "AQAB",
  d: "X4cTteJY_gn4FYPsXB8rdXix5vwsg1FLN5E3EaG6RJoVH-HLLKD9",
  p: "83i-7IvMGXoMXCskv73TKr8543dvVKfd1eBhIeQz5UwNw",
  q: "3dfOR9cuYq-0S-mkFLzgItgMEfFzB2q3hWehMuG0oCuqnb",
});

const PUBLIC_ONLY_JWK = JSON.stringify({
  kty: "RSA",
  n: "sXchDaQebHnPiGvyDOAT4saGEUetSyo9MKLOoWFsueri23bOdgWJ",
  e: "AQAB",
});

// 90 base64 characters — well past the 86-char raw-key-material threshold.
const PLAUSIBLE_BASE64_KEY_BLOB =
  "Tm90IGFuIGFjdHVhbCBrZXkgYnV0IGxvb2tzIGxpa2Ugb25lIGJlY2F1c2UgaXQncyBhIGxvbmcgYmFzZTY0IGJsb2Iu";

describe("scanForSecrets", () => {
  it("flags a PEM block and names the match type", () => {
    const result = scanForSecrets(REAL_PEM_BLOCK);
    expect(result.flagged).toBe(true);
    expect(result.flagged && result.matchType).toBe("PEM block");
  });

  it("flags a JWK-shaped JSON payload with a private exponent", () => {
    const result = scanForSecrets(REAL_JWK);
    expect(result.flagged).toBe(true);
    expect(result.flagged && result.matchType).toBe("JWK");
  });

  it("flags a plausible bare base64 key blob", () => {
    const result = scanForSecrets(PLAUSIBLE_BASE64_KEY_BLOB);
    expect(result.flagged).toBe(true);
    expect(result.flagged && result.matchType).toBe("raw key material");
  });

  it("does not flag normal prose text", () => {
    const result = scanForSecrets(
      "Notes from the field trip — day one. The site was quieter than expected.",
    );
    expect(result.flagged).toBe(false);
  });

  it("does not flag ordinary JSON with no private-key fields", () => {
    const result = scanForSecrets(JSON.stringify({ name: "field-notes", tags: ["a", "b"], count: 3 }));
    expect(result.flagged).toBe(false);
  });

  it("does not flag a public-only JWK (no private exponent)", () => {
    const result = scanForSecrets(PUBLIC_ONLY_JWK);
    expect(result.flagged).toBe(false);
  });

  it("accepts a Uint8Array payload the same way as a string", () => {
    const bytes = new TextEncoder().encode(REAL_PEM_BLOCK);
    const result = scanForSecrets(bytes);
    expect(result.flagged).toBe(true);
    expect(result.flagged && result.matchType).toBe("PEM block");
  });
});
