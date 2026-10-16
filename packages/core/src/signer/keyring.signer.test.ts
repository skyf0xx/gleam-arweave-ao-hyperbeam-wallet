import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import Arweave from "arweave";
import { generateJWK } from "../keys/jwk";
import type { JWKInterface } from "../models/wallet";
import { encrypt } from "../vault/encryption";
import { Keyring, KeyringLockedError } from "./keyring";

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

let jwkA: JWKInterface;
let jwkB: JWKInterface;

beforeAll(async () => {
  [jwkA, jwkB] = await Promise.all([generateJWK(), generateJWK()]);
}, 60_000);

describe("signer/keyring", () => {
  let keyring: Keyring;

  beforeEach(async () => {
    keyring = new Keyring();
    await keyring.importKey("wallet-a", jwkA);
  });

  it("signs with each wallet's own key", async () => {
    await keyring.importKey("wallet-b", jwkB);
    const data = bytes("deep hash stand-in");

    const signatureA = await keyring.sign("wallet-a", { hash: "SHA-256", saltLength: 32 }, data);
    const signatureB = await keyring.sign("wallet-b", { hash: "SHA-256", saltLength: 32 }, data);

    await expect(Arweave.crypto.verify(jwkA.n, data, signatureA)).resolves.toBe(true);
    await expect(Arweave.crypto.verify(jwkB.n, data, signatureB)).resolves.toBe(true);
    await expect(Arweave.crypto.verify(jwkB.n, data, signatureA)).resolves.toBe(false);
  });

  it("decrypts with the OAEP key", async () => {
    const ciphertext = (await encrypt(jwkA.n, bytes("secret"), { name: "RSA-OAEP" })) as Uint8Array<ArrayBuffer>;

    expect(new TextDecoder().decode(await keyring.decrypt("wallet-a", ciphertext))).toBe("secret");
  });

  it("rejects a keyfile with no private exponent", async () => {
    const publicOnly: JWKInterface = { ...jwkA };
    delete publicOnly.d;

    await expect(keyring.importKey("wallet-c", publicOnly)).rejects.toThrow("no private key");
    expect(await keyring.has(["wallet-c"])).toEqual([]);
  });

  it("reports which of the asked wallets have a key", async () => {
    expect(await keyring.has(["wallet-b", "wallet-a"])).toEqual(["wallet-a"]);
  });

  it("refuses to sign or decrypt for a wallet it holds no key for", async () => {
    await expect(keyring.sign("wallet-x", { hash: "SHA-256", saltLength: 32 }, bytes("x"))).rejects.toBeInstanceOf(
      KeyringLockedError,
    );
    await expect(keyring.decrypt("wallet-x", bytes("x"))).rejects.toBeInstanceOf(KeyringLockedError);
  });

  it("forgets one wallet on remove and every wallet on clear", async () => {
    await keyring.importKey("wallet-b", jwkB);

    await keyring.remove("wallet-a");
    expect(await keyring.has(["wallet-a", "wallet-b"])).toEqual(["wallet-b"]);
    await expect(keyring.sign("wallet-a", { hash: "SHA-256", saltLength: 32 }, bytes("x"))).rejects.toBeInstanceOf(
      KeyringLockedError,
    );

    await keyring.clear();
    expect(await keyring.has(["wallet-a", "wallet-b"])).toEqual([]);
  });

  it("keeps no reference to the JWK it imported", async () => {
    const jwk = { ...jwkB };
    await keyring.importKey("wallet-b", jwk);
    const before = await keyring.sign("wallet-b", { hash: "SHA-256", saltLength: 32 }, bytes("x"));

    for (const field of Object.keys(jwk)) delete (jwk as Record<string, unknown>)[field];

    const after = await keyring.sign("wallet-b", { hash: "SHA-256", saltLength: 32 }, bytes("x"));
    await expect(Arweave.crypto.verify(jwkB.n, bytes("x"), before)).resolves.toBe(true);
    await expect(Arweave.crypto.verify(jwkB.n, bytes("x"), after)).resolves.toBe(true);
  });
});
