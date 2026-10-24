import { beforeAll, describe, expect, it } from "vitest";
import { encrypt, type JWKInterface, type SessionKeyStorePort } from "@gleam/core";
import { generateJWK } from "@gleam/core/signer";

export interface SessionKeysHarness {
  port: SessionKeyStorePort;
  cleanup?: () => void | Promise<void>;
}

type Bytes = Uint8Array<ArrayBuffer>;

const bytes = (text: string): Bytes => new TextEncoder().encode(text) as Bytes;
const PSS = { hash: "SHA-256", saltLength: 32 } as const;

async function verifies(jwk: JWKInterface, data: Bytes, signature: Bytes): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", e: jwk.e, n: jwk.n, alg: "PS256", ext: true },
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify({ name: "RSA-PSS", saltLength: PSS.saltLength }, publicKey, signature, data);
}

export function describeSessionKeyStorePort(name: string, makeHarness: () => Promise<SessionKeysHarness>): void {
  describe(`SessionKeyStorePort conformance: ${name}`, () => {
    let jwkA: JWKInterface;
    let jwkB: JWKInterface;

    beforeAll(async () => {
      [jwkA, jwkB] = await Promise.all([generateJWK(), generateJWK()]);
    }, 60_000);

    async function withPort(test: (port: SessionKeyStorePort) => Promise<void>): Promise<void> {
      const { port, cleanup } = await makeHarness();
      try {
        await test(port);
      } finally {
        await cleanup?.();
      }
    }

    it("signs with the key imported for that wallet id", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);
        await port.importKey("b", jwkB);
        const data = bytes("deep hash stand-in");

        const signature = await port.sign("a", PSS, data);

        await expect(verifies(jwkA, data, signature)).resolves.toBe(true);
        await expect(verifies(jwkB, data, signature)).resolves.toBe(false);
      }));

    it("decrypts what was encrypted to the wallet's public key", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);
        const ciphertext = (await encrypt(jwkA.n, bytes("secret"), { name: "RSA-OAEP" })) as Bytes;

        expect(new TextDecoder().decode(await port.decrypt("a", ciphertext))).toBe("secret");
      }));

    it("decrypts with an OAEP label", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);
        const label = bytes("context");
        const ciphertext = (await encrypt(jwkA.n, bytes("secret"), { name: "RSA-OAEP", label: label.buffer })) as Bytes;

        expect(new TextDecoder().decode(await port.decrypt("a", ciphertext, label))).toBe("secret");
      }));

    it("reports which of the asked ids hold a key, in the order asked", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);
        await port.importKey("b", jwkB);

        await expect(port.has(["b", "unknown", "a"])).resolves.toEqual(["b", "a"]);
        await expect(port.has([])).resolves.toEqual([]);
      }));

    it("rejects a keyfile with no private exponent and stores nothing", () =>
      withPort(async (port) => {
        const publicOnly: JWKInterface = { ...jwkA };
        delete publicOnly.d;

        await expect(port.importKey("a", publicOnly)).rejects.toThrow();
        await expect(port.has(["a"])).resolves.toEqual([]);
      }));

    it("rejects signing and decrypting for an unknown wallet id", () =>
      withPort(async (port) => {
        await expect(port.sign("unknown", PSS, bytes("x"))).rejects.toThrow();
        await expect(port.decrypt("unknown", bytes("x"))).rejects.toThrow();
      }));

    it("forgets one wallet on remove and leaves the others", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);
        await port.importKey("b", jwkB);

        await port.remove("a");

        await expect(port.has(["a", "b"])).resolves.toEqual(["b"]);
        await expect(port.sign("a", PSS, bytes("x"))).rejects.toThrow();
        await expect(port.sign("b", PSS, bytes("x"))).resolves.toBeInstanceOf(Uint8Array);
      }));

    it("treats removing an unknown wallet as a no-op", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);

        await expect(port.remove("unknown")).resolves.toBeUndefined();
        await expect(port.has(["a"])).resolves.toEqual(["a"]);
      }));

    it("forgets every wallet on clear, and accepts keys again after", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);
        await port.importKey("b", jwkB);

        await port.clear();

        await expect(port.has(["a", "b"])).resolves.toEqual([]);
        await expect(port.sign("a", PSS, bytes("x"))).rejects.toThrow();
        await port.importKey("a", jwkA);
        await expect(port.has(["a"])).resolves.toEqual(["a"]);
      }));

    it("replaces the key when a wallet id is imported again", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);
        await port.importKey("a", jwkB);
        const data = bytes("data");

        const signature = await port.sign("a", PSS, data);

        await expect(verifies(jwkB, data, signature)).resolves.toBe(true);
      }));

    it("exposes only the port's operations, never a way to read a key", () =>
      withPort(async (port) => {
        await port.importKey("a", jwkA);
        const members = new Set<string>();
        for (let proto: object | null = port; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
          for (const member of Object.getOwnPropertyNames(proto)) {
            if (typeof (port as unknown as Record<string, unknown>)[member] === "function") members.add(member);
          }
        }

        for (const member of members) expect(member).not.toMatch(/export|getKey|jwk|private/i);
      }));
  });
}
