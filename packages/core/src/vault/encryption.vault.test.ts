import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { generateJWK } from "../keys/jwk";
import { encrypt, decrypt, normalizeEncryptAlgorithm } from "./encryption";
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

  describe("WebCrypto params", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Chrome rejects `label` whenever the key is present and not a
    // BufferSource, including `label: undefined`; Node accepts it.
    it("never passes a label key to encrypt or decrypt when no label was given", async () => {
      const encryptSpy = vi.spyOn(crypto.subtle, "encrypt");
      const decryptSpy = vi.spyOn(crypto.subtle, "decrypt");
      const plaintext = new TextEncoder().encode("x") as Uint8Array<ArrayBuffer>;

      const ciphertext = await encrypt(jwk, plaintext, { name: "RSA-OAEP", label: undefined });
      await decrypt(jwk, ciphertext as Uint8Array<ArrayBuffer>, { name: "RSA-OAEP", label: null } as never);

      expect(encryptSpy.mock.calls[0]![0]).toStrictEqual({ name: "RSA-OAEP" });
      expect(decryptSpy.mock.calls[0]![0]).toStrictEqual({ name: "RSA-OAEP" });
    });

    it("keeps a real label and requires it to match on decrypt", async () => {
      const plaintext = new TextEncoder().encode("x") as Uint8Array<ArrayBuffer>;
      const label = new TextEncoder().encode("ctx").buffer;
      const ciphertext = (await encrypt(jwk, plaintext, { name: "RSA-OAEP", label })) as Uint8Array<ArrayBuffer>;

      const decrypted = await decrypt(jwk, ciphertext, { name: "RSA-OAEP", label });
      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
      await expect(decrypt(jwk, ciphertext, { name: "RSA-OAEP" })).rejects.toThrow();
    });
  });

  describe("normalizeEncryptAlgorithm", () => {
    it("drops null and undefined optionals and keeps only known fields", () => {
      expect(normalizeEncryptAlgorithm({ name: "RSA-OAEP", label: null, extra: 1 })).toStrictEqual({ name: "RSA-OAEP" });
      expect(
        normalizeEncryptAlgorithm({ name: "AES-GCM", iv: new Uint8Array([1, 2]), additionalData: null, tagLength: undefined }),
      ).toStrictEqual({ name: "AES-GCM", iv: new Uint8Array([1, 2]).buffer });
    });

    it("rejects a stray label, a missing iv and a missing counter", () => {
      expect(() => normalizeEncryptAlgorithm({ name: "RSA-OAEP", label: {} })).toThrow(/label must be an ArrayBuffer/);
      expect(() => normalizeEncryptAlgorithm({ name: "AES-CBC", iv: null })).toThrow(/AES-CBC iv is required/);
      expect(() => normalizeEncryptAlgorithm({ name: "AES-GCM", iv: {} })).toThrow(/AES-GCM iv must be/);
      expect(() => normalizeEncryptAlgorithm({ name: "AES-CTR", counter: new Uint8Array(16) })).toThrow(/length is required/);
      expect(() => normalizeEncryptAlgorithm({ name: "RSA-PSS" })).toThrow(/Unsupported/);
    });
  });
});
