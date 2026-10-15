import { beforeAll, describe, expect, it } from "vitest";
import Arweave from "arweave";
import { generateJWK } from "../keys/jwk";
import type { JWKInterface } from "../models/wallet";
import { verifyRsaPss } from "../arweave/rsa-pss";
import { encrypt } from "./encryption";
import { signerFromJwk, type Signer } from "./signer";

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

async function verifyPss(owner: string, hash: string, saltLength: number, data: Uint8Array, signature: Uint8Array) {
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", e: "AQAB", n: owner, ext: true }, { name: "RSA-PSS", hash }, false, [
    "verify",
  ]);
  return crypto.subtle.verify({ name: "RSA-PSS", saltLength }, key, new Uint8Array(signature), new Uint8Array(data));
}

describe("vault/signer", () => {
  let jwk: JWKInterface;
  let signer: Signer;

  beforeAll(async () => {
    jwk = await generateJWK();
    signer = signerFromJwk(jwk, "address-a");
  }, 60_000);

  it("exposes the owner modulus and the address it was given", () => {
    expect(signer.owner).toBe(jwk.n);
    expect(signer.address).toBe("address-a");
  });

  describe("signPss", () => {
    it("signs with Arweave's parameters (SHA-256, salt 32), checked by arweave-js and verifyRsaPss", async () => {
      const data = bytes("deep hash stand-in");
      const signature = await signer.signPss(data, { hash: "SHA-256", saltLength: 32 });

      expect(signature.byteLength).toBe(512);
      await expect(verifyRsaPss(jwk.n, data, signature)).resolves.toBe(true);
      await expect(Arweave.crypto.verify(jwk.n, data, signature)).resolves.toBe(true);
    });

    it.each(["SHA-256", "SHA-384", "SHA-512"] as const)("binds the key to %s", async (hash) => {
      const data = bytes("message digest");
      const signature = await signer.signPss(data, { hash, saltLength: 32 });

      await expect(verifyPss(jwk.n, hash, 32, data, signature)).resolves.toBe(true);
      const other = hash === "SHA-256" ? "SHA-512" : "SHA-256";
      await expect(verifyPss(jwk.n, other, 32, data, signature)).resolves.toBe(false);
    });

    it("uses the requested salt length", async () => {
      const data = bytes("salted");
      const signature = await signer.signPss(data, { hash: "SHA-256", saltLength: 0 });

      await expect(verifyPss(jwk.n, "SHA-256", 0, data, signature)).resolves.toBe(true);
      await expect(verifyPss(jwk.n, "SHA-256", 32, data, signature)).resolves.toBe(false);
    });

    it("signs with a stored JWK whose alg/key_ops name another algorithm", async () => {
      const hinted = signerFromJwk({ ...jwk, alg: "RSA-OAEP-256", key_ops: ["decrypt"] } as JWKInterface, "address-a");
      const data = bytes("hinted");

      await expect(verifyRsaPss(jwk.n, data, await hinted.signPss(data, { hash: "SHA-256", saltLength: 32 }))).resolves.toBe(
        true,
      );
    });
  });

  describe("decryptOaep", () => {
    it("opens what encrypt sealed to the owner, with and without a label", async () => {
      const label = bytes("ctx").buffer;
      const plain = (await encrypt(signer.owner, bytes("secret"), { name: "RSA-OAEP" })) as Uint8Array<ArrayBuffer>;
      const labelled = (await encrypt(signer.owner, bytes("secret"), { name: "RSA-OAEP", label })) as Uint8Array<ArrayBuffer>;

      expect(new TextDecoder().decode(await signer.decryptOaep(plain))).toBe("secret");
      expect(new TextDecoder().decode(await signer.decryptOaep(labelled, label))).toBe("secret");
      await expect(signer.decryptOaep(labelled)).rejects.toThrow();
    });

    it("can't open ciphertext sealed to another key", async () => {
      const other = await generateJWK();
      const ciphertext = (await encrypt(other.n, bytes("secret"), { name: "RSA-OAEP" })) as Uint8Array<ArrayBuffer>;

      await expect(signer.decryptOaep(ciphertext)).rejects.toThrow();
    });
  });

  describe("privateHash", () => {
    it("digests the data followed by the UTF-8 text of d", async () => {
      const data = bytes("payload");
      const expected = await crypto.subtle.digest("SHA-384", new Uint8Array([...data, ...new TextEncoder().encode(jwk.d)]));

      expect(Array.from(await signer.privateHash(data, "SHA-384"))).toEqual(Array.from(new Uint8Array(expected)));
    });

    it("refuses a key with no private exponent", async () => {
      const publicOnly = signerFromJwk({ kty: "RSA", e: "AQAB", n: jwk.n } as JWKInterface, "address-a");

      await expect(publicOnly.privateHash(bytes("x"), "SHA-256")).rejects.toThrow(/no 'd' field/);
    });
  });
});
