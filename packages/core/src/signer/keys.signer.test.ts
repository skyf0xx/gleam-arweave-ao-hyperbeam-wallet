import { beforeAll, describe, expect, it } from "vitest";
import Arweave from "arweave";
import type { JWKInterface } from "../models/wallet";
import { validateJWKShape } from "../keys/jwk";
import { verifyRsaPss } from "../arweave/rsa-pss";
import { applyTransactionSignature, buildUnsignedTransaction, signTransactionWithSigner } from "../arweave/transaction";
import { buildUnsignedDataItem, createSignedDataItem, verifyDataItemSignature } from "../arweave/data-item";
import { clientForGateway } from "../arweave/client";
import { encrypt } from "../vault/encryption";
import { signMessage, verifyMessage } from "../vault/message-signing";
import { Keyring } from "./keyring";
import type { Signer } from "../vault/signer";
import { importSessionKeys, signerFromJwk, signerFromKeyStore, type SessionKeyHandles, generateJWK } from "./keys";

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

async function verifyPss(owner: string, hash: string, saltLength: number, data: Uint8Array, signature: Uint8Array) {
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", e: "AQAB", n: owner, ext: true }, { name: "RSA-PSS", hash }, false, [
    "verify",
  ]);
  return crypto.subtle.verify({ name: "RSA-PSS", saltLength }, key, new Uint8Array(signature), new Uint8Array(data));
}

describe("generateJWK", () => {
  it("returns exactly the nine Arweave keyfile fields for an RSA-4096, e=65537 key", async () => {
    const key = await generateJWK();
    expect(Object.keys(key).sort()).toEqual(["d", "dp", "dq", "e", "kty", "n", "p", "q", "qi"]);
    expect(key.kty).toBe("RSA");
    expect(key.e).toBe("AQAB");
    // 512 modulus bytes in unpadded base64url.
    expect(key.n).toHaveLength(683);
    expect(validateJWKShape(key).valid).toBe(true);
  }, 20_000);

  it("produces a key arweave-js signs and verifies with", async () => {
    const key = await generateJWK();
    const arweave = Arweave.init({});
    const data = bytes("keyfile round trip");
    const signature = await arweave.crypto.sign(key, data);
    expect(await arweave.crypto.verify(key.n, data, signature)).toBe(true);
  }, 20_000);

  it("produces a different key each call", async () => {
    const [a, b] = await Promise.all([generateJWK(), generateJWK()]);
    expect(a.n).not.toBe(b.n);
  }, 30_000);
});

let jwk: JWKInterface;

beforeAll(async () => {
  jwk = await generateJWK();
}, 60_000);

const SIGNERS: Array<[string, () => Promise<Signer>]> = [
  ["signerFromJwk", async () => signerFromJwk(jwk, "address-a")],
  [
    "signerFromKeyStore over a Keyring",
    async () => {
      const keyring = new Keyring();
      await keyring.importKey("wallet-a", jwk);
      return signerFromKeyStore(keyring, "wallet-a", { address: "address-a", owner: jwk.n });
    },
  ],
];

describe.each(SIGNERS)("signer/keys: %s", (_, makeSigner) => {
  let signer: Signer;

  beforeAll(async () => {
    signer = await makeSigner();
  });

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

    it("signs a transaction arweave-js verifies", async () => {
      const unsigned = await buildUnsignedTransaction("https://arweave.net", jwk.n, {
        target: "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI",
        quantity: "1000",
        reward: "5000",
        last_tx: "b".repeat(64),
      });
      const { transaction } = await applyTransactionSignature(unsigned, await signTransactionWithSigner(unsigned, signer), jwk.n);
      const arweave = clientForGateway("https://arweave.net");

      await expect(arweave.transactions.verify(arweave.transactions.fromRaw(transaction))).resolves.toBe(true);
    });

    it("signs an ANS-104 data item that verifies", async () => {
      const fields = { data: bytes("ao message"), target: "", anchor: "", tags: [{ name: "Action", value: "Transfer" }] };
      const { raw } = await createSignedDataItem(signer, fields);

      await expect(verifyDataItemSignature(buildUnsignedDataItem(jwk.n, fields), raw.subarray(2, 514), jwk.n)).resolves.toBe(true);
    });

    it("signs a message verifyMessage accepts", async () => {
      const data = bytes("hello").buffer;
      const signature = await signMessage(signer, data, "SHA-384");

      await expect(verifyMessage(jwk.n, data, signature, "SHA-384")).resolves.toBe(true);
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
});

describe("signer/keys: signerFromJwk", () => {
  it("signs with a stored JWK whose alg/key_ops name another algorithm", async () => {
    const hinted = signerFromJwk({ ...jwk, alg: "RSA-OAEP-256", key_ops: ["decrypt"] } as JWKInterface, "address-a");
    const data = bytes("hinted");

    await expect(verifyRsaPss(jwk.n, data, await hinted.signPss(data, { hash: "SHA-256", saltLength: 32 }))).resolves.toBe(true);
  });
});

describe("signer/keys: importSessionKeys", () => {
  let keys: SessionKeyHandles;

  beforeAll(async () => {
    keys = await importSessionKeys({ ...jwk, alg: "RSA-OAEP-256", key_ops: ["decrypt"] } as JWKInterface);
  });

  it("imports one non-extractable key per PSS hash and one for OAEP, none of which export", async () => {
    const all = [keys.pss["SHA-256"], keys.pss["SHA-384"], keys.pss["SHA-512"], keys.oaep];

    expect(keys.pss["SHA-384"].algorithm).toMatchObject({ name: "RSA-PSS", hash: { name: "SHA-384" } });
    expect(keys.oaep.algorithm).toMatchObject({ name: "RSA-OAEP", hash: { name: "SHA-256" } });
    for (const key of all) {
      expect(key.extractable).toBe(false);
      expect(key.type).toBe("private");
      await expect(crypto.subtle.exportKey("jwk", key)).rejects.toThrow();
      await expect(crypto.subtle.exportKey("pkcs8", key)).rejects.toThrow();
    }
  });
});
