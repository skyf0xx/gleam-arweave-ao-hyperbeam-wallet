import { describe, expect, it, beforeAll } from "vitest";
import Arweave from "arweave";
import { generateJWK } from "../keys/jwk";
import { signMessage, signature, privateHash, verifyMessage, type MessageHashAlgorithm } from "./message-signing";
import { base64UrlToBytes } from "./base64";
import type { JWKInterface } from "../models/wallet";

type Hash = MessageHashAlgorithm;

/**
 * permawebOS's `signMessage`/`verifyMessage`/`signature`, transcribed from
 * its bundle (`browserWalletApi`), as the reference for Wander's
 * construction.
 */
const permawebOS = {
  async signMessage(jwk: JWKInterface, data: ArrayBuffer, hash: Hash = "SHA-256"): Promise<ArrayBuffer> {
    const stripped: JsonWebKey = { ...jwk, ext: true };
    delete stripped.alg;
    delete stripped.key_ops;
    delete stripped.use;
    const digest = await crypto.subtle.digest(hash, data);
    const key = await crypto.subtle.importKey("jwk", stripped, { name: "RSA-PSS", hash }, false, ["sign"]);
    return crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, key, digest);
  },
  async verifyMessage(n: string, data: ArrayBuffer, sig: ArrayBuffer, hash: Hash = "SHA-256"): Promise<boolean> {
    const digest = await crypto.subtle.digest(hash, data);
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", e: "AQAB", n, ext: true }, { name: "RSA-PSS", hash }, false, ["verify"]);
    return crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, key, sig, digest);
  },
  async verifySignature(n: string, data: ArrayBuffer, sig: ArrayBuffer, saltLength = 32): Promise<boolean> {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", e: "AQAB", n, ext: true },
      { name: "RSA-PSS", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify({ name: "RSA-PSS", saltLength }, key, sig, data);
  },
};

/** A signature made by permawebOS's `signMessage` code with a throwaway key. */
const PERMAWEBOS_FIXTURE = {
  n: "nXcU85PGdERbxbnHKyeBJSEeCMa9EcRwI1ZKQhba9D0VqbzwOY2PV5p7yoibRViKuR_OzRtFPmb-IsBEgHnTi14WErmjpug5mj9ZUzoXJAHvrmA2UZCBHiFCD8GOYVg1bdLHVkg3IaDsNcT9uJKZXBz3NqeqyflpuCbWR1Kj7GR19AlYDIbqyRS5VVwZEhLsXapPvf52BmtM5PYVG46VljhGk9a7QAkUcKX7-mWg23LeM9ox328l06zPuvT7g6W8ZoXWsb79R_jEkqieumCNe0AxcqT8m314a9EzWbv2TfmmteNmHSNI8UFPAjkoDR_2GW44rHNkPXrzADYshJQSUrr9MYhiBW1v6gliiwWc1PXRSuBvSM7SnwW5ABfD0-cUK1znjIoYX0g-2IkuITBv09Sy_gy1cTHbkeVLNUU3EaJTIk8N-osKvK2meR9iLIyj4i913oHU8Oj6LwecTMPXkLhaagi49Pnu9nu1hLHWVYZVlahYoNBLUNq7tZxz8SHHGM0UEaUJymHqpSSFkfwj2AJWYB7_ZJyxxhOVMBdFb4OIKLXiOt5T5ZME3HF7rMIX_SlIWhH-ieewj3uv9vscG9vvZnC6v2R3D9mfWPi3a0N2c8jxEZzRU2pMQATw0nvAkKZB2PgQMUJdwEjgCjf4obgD3-6XMH2TktqbOk3rrdk",
  message: "gleam wander parity",
  sha256: "fH3WbR3fjlIPw3gGCnGeTNWHtHDiceXQQkI6lH3Dh48ttQVbn2_pCciy9kkabdCOIqfHI0cmtTHQpQ62nb3a44WDBkEnc-W1ZuxvTl_uBLTKsCrmE_GczrOUiQm5Er2n7jc6AGmmCdKycvEMVYPSEYVSFy_OzlN-nX8voJpgoNLrRmykOH8xsZ_vB7hJFJjILbDAh5rLndhhFbhq6wZOW42wmaA6MOr9ELv9JxV9caG1GkiMGH4ticY6hRTPanGZwxDDEmD1GF6mOiYj8LViy_D7-hnxGQFtKohi6O2sNGkVpoh9ZyUyMSiCDoR-V25gC5YFFTalIHH8ZlcWcvp87MbkbP9-sxKAmO93RDP9RqP0xFoir5KIfMTov3W-1Z6_D-GcGhK0ewvtjX9tE66d_pBiuCUzkpx-D0VVbm9kKYZP5uKI3eXg5FnNZLwMj_sG72AOF9kIX_78v9eqqUXGN4xWj58I44H9BNMwK0ImMG3f_8DirkuR4ddbUALyUQzay7WUJjWlNhoXRcYQSaozawXE_2Z9N8XdlvF4AUCuLgXterkP0eWxnI80yP2yrkk52K6nfdyWehtVR6SOZf4N-toTGGs20MIdx1wDf_x1qmirWMALmt3KmS7pXi4e3qE2z5Lri5DF-LH5Y7H2IAk58ceGAA9y2EQkol2GvtWAr0E",
  sha512: "Fmi3gAOubr1llbrw6J-6cYu929AFxdnKRCBZKrL65Im5k5K1lhSrBRfvnK1Kkwb2fSld7S80HQZ8PvZIcjq7JO9nkNpWmxSBJs6WYQSZaLacazwVlSEwif7rPKBQwkth3M193EB1_uT_JXS0Fe4-cvDtQ8GhOnC7sC8hhj3WRhmm-NXHM-8gg2VkjNV9jQry_UtX27s8rdjpNWtG0jl9Y3BMJ0KOtmPZH2A8IdakkyFFw28kjbDC636PU_vGNK3ocO9uD4TnSx7J4a-wJe4JjFdQoJmRdnnIoJpul6FiRQ1GESQjj4nPEtdFPUUuQJqokYKZQ5wdd6WA980NIcaoHL30E9dDOQywitIiy11mKNvmIrDcBZEHWrxvSpuKsCO392qpjbeGs8dHQDBwTk0aCARn9y60oAUdm60-g4B1pCk2kUs0cywoKlietO47twUflTPgSJMvsy9aDNqP-kzMPxNL1MvqbLZeQh-rEp3vphhJtT7JXVXfbDZnjA0vI6h032DIII3c8bp2-8SnErrvnt4C9Hc1bVOwCcu7Nx-fLoM2Qf6ljbPvYOAI9YoYHDwd1_nHupn0nazo4bwqt8kt8aQElR9rUCsKngYy-9ZSFCLsln37gaoaySz0X1cL6XS1qXiZP10c1ozGKUUdojTAc9RLsxKPT8Qfsfrsc-BmAF0",
};

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const fromB64Url = (value: string): ArrayBuffer => base64UrlToBytes(value).buffer as ArrayBuffer;

describe("vault/message-signing", () => {
  let jwk: JWKInterface;

  beforeAll(async () => {
    jwk = await generateJWK();
  });

  describe("signMessage / verifyMessage", () => {
    it("produces a signature verifiable against the wallet's public key", async () => {
      const data = bytes("arbitrary message");

      const sig = await signMessage(jwk, data);

      await expect(verifyMessage(jwk.n, data, sig)).resolves.toBe(true);
    });

    it("rejects a signature verified against different data", async () => {
      const sig = await signMessage(jwk, bytes("original"));

      await expect(verifyMessage(jwk.n, bytes("tampered"), sig)).resolves.toBe(false);
    });

    it("rejects a signature verified against a different wallet's public key", async () => {
      const otherJwk = await generateJWK();
      const data = bytes("message");

      const sig = await signMessage(jwk, data);

      await expect(verifyMessage(otherJwk.n, data, sig)).resolves.toBe(false);
    });

    it("binds the signature to the hash algorithm", async () => {
      const data = bytes("sha-512 message");

      const sig = await signMessage(jwk, data, "SHA-512");

      await expect(verifyMessage(jwk.n, data, sig, "SHA-512")).resolves.toBe(true);
      await expect(verifyMessage(jwk.n, data, sig, "SHA-256")).resolves.toBe(false);
    });

    it("verifies the permawebOS fixture for each hash algorithm", async () => {
      const data = bytes(PERMAWEBOS_FIXTURE.message);

      await expect(verifyMessage(PERMAWEBOS_FIXTURE.n, data, fromB64Url(PERMAWEBOS_FIXTURE.sha256))).resolves.toBe(true);
      await expect(
        verifyMessage(PERMAWEBOS_FIXTURE.n, data, fromB64Url(PERMAWEBOS_FIXTURE.sha512), "SHA-512"),
      ).resolves.toBe(true);
    });

    it.each<Hash>(["SHA-256", "SHA-384", "SHA-512"])("interoperates with permawebOS's construction (%s)", async (hash) => {
      const data = bytes("cross-wallet message");

      const ours = await signMessage(jwk, data, hash);
      const theirs = await permawebOS.signMessage(jwk, data, hash);

      await expect(permawebOS.verifyMessage(jwk.n, data, ours, hash)).resolves.toBe(true);
      await expect(verifyMessage(jwk.n, data, theirs, hash)).resolves.toBe(true);
    });

    it("verifies with arweave-js's crypto.verify over the SHA-256 digest, as server code does", async () => {
      const data = new TextEncoder().encode("server-side check");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));

      const sig = new Uint8Array(await signMessage(jwk, data.buffer));
      await expect(Arweave.crypto.verify(jwk.n, digest, sig)).resolves.toBe(true);

      // Salt 32 is the web driver's default; Node's driver defaults to the maximum.
      const arweaveSig = new Uint8Array(await Arweave.crypto.sign(jwk, digest, { saltLength: 32 }));
      await expect(verifyMessage(jwk.n, data.buffer, arweaveSig.buffer)).resolves.toBe(true);
    });

    it("does not verify a signature over the raw data", async () => {
      const data = bytes("raw, not hashed");

      const raw = await signature(jwk, data);

      await expect(verifyMessage(jwk.n, data, raw)).resolves.toBe(false);
    });
  });

  describe("signature (deprecated)", () => {
    it("signs the raw data with salt length 32 by default, as permawebOS does", async () => {
      const data = bytes("legacy signature payload");

      const sig = await signature(jwk, data);

      await expect(permawebOS.verifySignature(jwk.n, data, sig, 32)).resolves.toBe(true);
      await expect(permawebOS.verifySignature(jwk.n, data, sig, 0)).resolves.toBe(false);
    });

    it("honours saltLength", async () => {
      const data = bytes("salted");

      const sig = await signature(jwk, data, { saltLength: 0 });

      await expect(permawebOS.verifySignature(jwk.n, data, sig, 0)).resolves.toBe(true);
      await expect(permawebOS.verifySignature(jwk.n, data, sig, 32)).resolves.toBe(false);
    });

    it("rejects a negative or fractional saltLength", async () => {
      await expect(signature(jwk, bytes("x"), { saltLength: -1 })).rejects.toThrow(/saltLength/);
      await expect(signature(jwk, bytes("x"), { saltLength: 1.5 })).rejects.toThrow(/saltLength/);
    });

    it("signs with a stored JWK whose alg/key_ops name another algorithm", async () => {
      const data = bytes("hinted key");
      const hinted = { ...jwk, alg: "RSA-OAEP-256", key_ops: ["decrypt"] } as JWKInterface;

      await expect(permawebOS.verifySignature(jwk.n, data, await signature(hinted, data))).resolves.toBe(true);
      await expect(verifyMessage(jwk.n, data, await signMessage(hinted, data))).resolves.toBe(true);
    });
  });

  describe("privateHash", () => {
    // Known answers from `printf '%s%s' "$message" "$d" | shasum -a <bits>`,
    // which is Wander's `digest(data || UTF-8(d))`.
    const PRIVATE_HASH_VECTOR = {
      d: "dGVzdC1vbmx5LXByaXZhdGUtZXhwb25lbnQtbm90LWEtcmVhbC1rZXk",
      message: "gleam wander parity",
      "SHA-256": "1d8a212955b38e006a54efc0c26d2de59f0f90c459c81bc54bc071ed4d9ee16c",
      "SHA-384":
        "d67519c5b09bef37a7b387eb40403fb7bf8798d0a2bb840366cc9eaab3aa561ea49c1e754cd017584115d08194ed486d",
      "SHA-512":
        "058f4b854906a69504f44fc4d9bfcd2cb8c7c599c8dbe846900901674967008496a73ac73025f317c7b97a7cfebf77cc3cfe43257fc8f75e2b7b287dc5fdbb6f",
      /** The same input hashed over the decoded exponent bytes, which Wander does not do. */
      decodedBytesSha256: "ba8158b24c4578f7ba8846cc7159fa5da0bd398a9ef4fe5a8b46e04a0b381bc8",
    };
    const vectorKey = { kty: "RSA", e: "AQAB", n: "unused", d: PRIVATE_HASH_VECTOR.d } as JWKInterface;
    const toHex = (buffer: ArrayBuffer) =>
      Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

    it.each(["SHA-256", "SHA-384", "SHA-512"] as const)("matches the Wander known answer for %s", async (hash) => {
      const result = await privateHash(vectorKey, bytes(PRIVATE_HASH_VECTOR.message), hash);
      expect(toHex(result)).toBe(PRIVATE_HASH_VECTOR[hash]);
    });

    it("hashes d as base64url text, not as the decoded exponent", async () => {
      const result = toHex(await privateHash(vectorKey, bytes(PRIVATE_HASH_VECTOR.message)));
      expect(result).not.toBe(PRIVATE_HASH_VECTOR.decodedBytesSha256);
    });

    it("matches Wander's construction for a generated wallet", async () => {
      const data = bytes("any input");
      const wander = await crypto.subtle.digest(
        "SHA-512",
        new Uint8Array([...new Uint8Array(data), ...new TextEncoder().encode(jwk.d)]),
      );
      expect(toHex(await privateHash(jwk, data, "SHA-512"))).toBe(toHex(wander));
    });

    it("rejects a key without d", async () => {
      const publicOnly = { kty: "RSA", e: "AQAB", n: "unused" } as JWKInterface;
      await expect(privateHash(publicOnly, bytes("x"))).rejects.toThrow(/no 'd' field/);
    });

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
