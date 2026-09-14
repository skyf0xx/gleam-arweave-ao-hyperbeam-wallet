import { describe, expect, it } from "vitest";
import { deriveAddress, generateJWK, validateJWKShape } from "./jwk";

describe("generateJWK", () => {
  it("produces a JWK with the expected RSA fields", async () => {
    const jwk = await generateJWK();
    expect(jwk.kty).toBe("RSA");
    expect(typeof jwk.n).toBe("string");
    expect(typeof jwk.d).toBe("string");
  }, 20_000);

  it("produces a keyfile that passes shape validation", async () => {
    const jwk = await generateJWK();
    const result = validateJWKShape(jwk);
    expect(result.valid).toBe(true);
  }, 20_000);
});

describe("deriveAddress", () => {
  it("is deterministic for the same JWK", async () => {
    const jwk = await generateJWK();
    const first = await deriveAddress(jwk);
    const second = await deriveAddress(jwk);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  }, 20_000);

  it("derives different addresses for different JWKs", async () => {
    const jwkA = await generateJWK();
    const jwkB = await generateJWK();
    const addressA = await deriveAddress(jwkA);
    const addressB = await deriveAddress(jwkB);
    expect(addressA).not.toBe(addressB);
  }, 20_000);
});

describe("validateJWKShape", () => {
  it("rejects null", () => {
    const result = validateJWKShape(null);
    expect(result.valid).toBe(false);
  });

  it("rejects a non-object", () => {
    const result = validateJWKShape("not a keyfile");
    expect(result.valid).toBe(false);
  });

  it("rejects an array", () => {
    const result = validateJWKShape([]);
    expect(result.valid).toBe(false);
  });

  it("rejects an object missing required fields, with a reason naming the missing field", () => {
    const result = validateJWKShape({ kty: "RSA", n: "abc" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/missing required field/i);
    }
  });

  it("rejects a non-RSA key type with a specific reason", () => {
    const result = validateJWKShape({
      kty: "EC",
      e: "AQAB",
      n: "abc",
      d: "abc",
      p: "abc",
      q: "abc",
      dp: "abc",
      dq: "abc",
      qi: "abc",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/RSA/);
    }
  });

  it("rejects a field with invalid base64url characters", () => {
    const result = validateJWKShape({
      kty: "RSA",
      e: "AQAB",
      n: "not valid base64url!!",
      d: "abc",
      p: "abc",
      q: "abc",
      dp: "abc",
      dq: "abc",
      qi: "abc",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/base64url/i);
    }
  });

  it("rejects an empty-string field", () => {
    const result = validateJWKShape({
      kty: "RSA",
      e: "",
      n: "abc",
      d: "abc",
      p: "abc",
      q: "abc",
      dp: "abc",
      dq: "abc",
      qi: "abc",
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed RSA JWK shape", () => {
    const result = validateJWKShape({
      kty: "RSA",
      e: "AQAB",
      n: "abc-_123",
      d: "abc-_123",
      p: "abc-_123",
      q: "abc-_123",
      dp: "abc-_123",
      dq: "abc-_123",
      qi: "abc-_123",
    });
    expect(result.valid).toBe(true);
  });
});
