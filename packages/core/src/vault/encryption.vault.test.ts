import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { generateJWK } from "../keys/jwk";
import { encrypt, decrypt, normalizeEncryptAlgorithm } from "./encryption";
import type { JWKInterface } from "../models/wallet";
import type { RsaOaepParams } from "../models/signing";

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

  describe("AES params", () => {
    // Wander runs AES params against the wallet's RSA key, which WebCrypto
    // always rejects, so there is no Wander output to match.
    it.each([
      { name: "AES-GCM", iv: new Uint8Array(12) },
      { name: "AES-CBC", iv: new Uint8Array(16) },
      { name: "AES-CTR", counter: new Uint8Array(16), length: 64 },
    ])("refuses $name for encrypt and decrypt before touching the key", async (params) => {
      const encryptSpy = vi.spyOn(crypto.subtle, "encrypt");
      const input = new Uint8Array([1, 2, 3]);

      await expect(encrypt(jwk, input, params as never)).rejects.toThrow(
        new RegExp(`${params.name} is not supported.*RSA-OAEP`),
      );
      await expect(decrypt(jwk, input, params as never)).rejects.toThrow(/is not supported/);
      expect(encryptSpy).not.toHaveBeenCalled();
      encryptSpy.mockRestore();
    });
  });

  describe("Wander parity", () => {
    // Wander's decrypt path, transcribed from
    // src/api/modules/decrypt/decrypt.background.ts.
    async function wanderDecrypt(key: JWKInterface, data: Uint8Array<ArrayBuffer>, options: RsaOaepParams) {
      const imported = await crypto.subtle.importKey(
        "jwk",
        { ...key, alg: "RSA-OAEP-256", ext: true },
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["decrypt"],
      );
      return new Uint8Array(await crypto.subtle.decrypt(options, imported, data));
    }

    it("produces ciphertext Wander's decrypt opens, with and without a label", async () => {
      const plaintext = new TextEncoder().encode("to wander") as Uint8Array<ArrayBuffer>;
      const label = new TextEncoder().encode("ctx").buffer;

      const plain = (await encrypt(jwk, plaintext, { name: "RSA-OAEP" })) as Uint8Array<ArrayBuffer>;
      const labelled = (await encrypt(jwk, plaintext, { name: "RSA-OAEP", label })) as Uint8Array<ArrayBuffer>;

      expect(plain.byteLength).toBe(512);
      expect(new TextDecoder().decode(await wanderDecrypt(jwk, plain, { name: "RSA-OAEP" }))).toBe("to wander");
      expect(new TextDecoder().decode(await wanderDecrypt(jwk, labelled, { name: "RSA-OAEP", label }))).toBe(
        "to wander",
      );
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
      expect(normalizeEncryptAlgorithm({ name: "RSA-OAEP", label: new Uint8Array([1, 2]) })).toStrictEqual({
        name: "RSA-OAEP",
        label: new Uint8Array([1, 2]).buffer,
      });
    });

    it("rejects a stray label, AES params and other algorithms", () => {
      expect(() => normalizeEncryptAlgorithm({ name: "RSA-OAEP", label: {} })).toThrow(/label must be an ArrayBuffer/);
      expect(() => normalizeEncryptAlgorithm({ name: "AES-GCM", iv: new Uint8Array(12) })).toThrow(
        /AES-GCM is not supported/,
      );
      expect(() => normalizeEncryptAlgorithm({ name: "RSA-PSS" })).toThrow(/Unsupported/);
    });
  });
});
