import { describe, expect, it, beforeAll } from "vitest";
import { generateJWK } from "../keys/jwk";
import { encrypt, decrypt } from "./encryption";
import type { JWKInterface } from "../models/wallet";

describe("vault/encryption", () => {
  let jwk: JWKInterface;

  beforeAll(async () => {
    jwk = await generateJWK();
  });

  describe("RSA-OAEP", () => {
    it("round-trips plaintext through encrypt/decrypt", async () => {
      const plaintext = new TextEncoder().encode("secret message") as Uint8Array<ArrayBuffer>;

      const ciphertext = await encrypt(jwk, plaintext, { name: "RSA-OAEP" });
      expect(ciphertext).not.toEqual(plaintext);

      const decrypted = await decrypt(
        jwk,
        ciphertext as Uint8Array<ArrayBuffer>,
        { name: "RSA-OAEP" },
      );
      expect(new TextDecoder().decode(decrypted)).toBe("secret message");
    });

    it("fails to decrypt with a mismatched key", async () => {
      const otherJwk = await generateJWK();
      const plaintext = new TextEncoder().encode("secret") as Uint8Array<ArrayBuffer>;
      const ciphertext = await encrypt(jwk, plaintext, { name: "RSA-OAEP" });

      await expect(
        decrypt(otherJwk, ciphertext as Uint8Array<ArrayBuffer>, { name: "RSA-OAEP" }),
      ).rejects.toThrow();
    });
  });

  describe("AES-GCM", () => {
    it("round-trips plaintext through encrypt/decrypt", async () => {
      const plaintext = new TextEncoder().encode("aes gcm secret") as Uint8Array<ArrayBuffer>;
      const iv = crypto.getRandomValues(new Uint8Array(12)).buffer;

      const ciphertext = await encrypt(jwk, plaintext, { name: "AES-GCM", iv });
      const decrypted = await decrypt(
        jwk,
        ciphertext as Uint8Array<ArrayBuffer>,
        { name: "AES-GCM", iv },
      );

      expect(new TextDecoder().decode(decrypted)).toBe("aes gcm secret");
    });
  });

  describe("AES-CBC", () => {
    it("round-trips plaintext through encrypt/decrypt", async () => {
      const plaintext = new TextEncoder().encode("aes cbc secret!!") as Uint8Array<ArrayBuffer>;
      const iv = crypto.getRandomValues(new Uint8Array(16)).buffer;

      const ciphertext = await encrypt(jwk, plaintext, { name: "AES-CBC", iv });
      const decrypted = await decrypt(
        jwk,
        ciphertext as Uint8Array<ArrayBuffer>,
        { name: "AES-CBC", iv },
      );

      expect(new TextDecoder().decode(decrypted)).toBe("aes cbc secret!!");
    });
  });

  describe("AES-CTR", () => {
    it("round-trips plaintext through encrypt/decrypt", async () => {
      const plaintext = new TextEncoder().encode("aes ctr secret!!") as Uint8Array<ArrayBuffer>;
      const counter = new Uint8Array(16).buffer;

      const ciphertext = await encrypt(jwk, plaintext, { name: "AES-CTR", counter, length: 64 });
      const decrypted = await decrypt(
        jwk,
        ciphertext as Uint8Array<ArrayBuffer>,
        { name: "AES-CTR", counter, length: 64 },
      );

      expect(new TextDecoder().decode(decrypted)).toBe("aes ctr secret!!");
    });
  });
});
