import { describe, expect, it, beforeAll } from "vitest";
import { generateJWK } from "../keys/jwk";
import { signMessage, signature, privateHash, verifyMessage } from "./message-signing";
import type { JWKInterface } from "../models/wallet";

describe("vault/message-signing", () => {
  let jwk: JWKInterface;

  beforeAll(async () => {
    jwk = await generateJWK();
  });

  describe("signMessage / verifyMessage", () => {
    it("produces a signature verifiable against the wallet's public key", async () => {
      const data = new TextEncoder().encode("arbitrary message").buffer;

      const sig = await signMessage(jwk, data);
      const valid = await verifyMessage(jwk.n, data, sig);

      expect(valid).toBe(true);
    });

    it("rejects a signature verified against different data", async () => {
      const data = new TextEncoder().encode("original").buffer;
      const tampered = new TextEncoder().encode("tampered").buffer;

      const sig = await signMessage(jwk, data);
      const valid = await verifyMessage(jwk.n, tampered, sig);

      expect(valid).toBe(false);
    });

    it("rejects a signature verified against a different wallet's public key", async () => {
      const otherJwk = await generateJWK();
      const data = new TextEncoder().encode("message").buffer;

      const sig = await signMessage(jwk, data);
      const valid = await verifyMessage(otherJwk.n, data, sig);

      expect(valid).toBe(false);
    });

    it("supports non-default hash algorithms consistently between sign and verify", async () => {
      const data = new TextEncoder().encode("sha-512 message").buffer;

      const sig = await signMessage(jwk, data, "SHA-512");
      const valid = await verifyMessage(jwk.n, data, sig, "SHA-512");

      expect(valid).toBe(true);
    });
  });

  describe("signature (legacy alias)", () => {
    it("produces a signature verifiable the same way signMessage's is", async () => {
      const data = new TextEncoder().encode("legacy signature payload").buffer;

      const sig = await signature(jwk, data);
      const valid = await verifyMessage(jwk.n, data, sig);

      expect(valid).toBe(true);
    });
  });

  describe("privateHash", () => {
    it("is deterministic for the same wallet and input", async () => {
      const data = new TextEncoder().encode("hash me").buffer;

      const hash1 = await privateHash(jwk, data);
      const hash2 = await privateHash(jwk, data);

      expect(new Uint8Array(hash1)).toEqual(new Uint8Array(hash2));
    });

    it("differs for different input data", async () => {
      const hashA = await privateHash(jwk, new TextEncoder().encode("a").buffer);
      const hashB = await privateHash(jwk, new TextEncoder().encode("b").buffer);

      expect(new Uint8Array(hashA)).not.toEqual(new Uint8Array(hashB));
    });

    it("differs between two different wallets for the same input", async () => {
      const otherJwk = await generateJWK();
      const data = new TextEncoder().encode("same input").buffer;

      const hashA = await privateHash(jwk, data);
      const hashB = await privateHash(otherJwk, data);

      expect(new Uint8Array(hashA)).not.toEqual(new Uint8Array(hashB));
    });

    it("produces a 32-byte digest for the default SHA-256", async () => {
      const hash = await privateHash(jwk, new TextEncoder().encode("x").buffer);
      expect(hash.byteLength).toBe(32);
    });
  });
});
