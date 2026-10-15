import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyRsaPss } from "@gleam/core/src/arweave/rsa-pss.ts";
import { bytesToBase64, base64ToBytes, encrypt, generateJWK, Keyring, type JWKInterface } from "@gleam/core";
import { KEYRING_PORT_NAME, type KeyringResponse } from "@gleam/messaging/src/keyring-protocol.ts";
import {
  keepKeyringConnected,
  serveKeyringEnvelope,
  serveKeyringRequest,
  type KeyringDocumentPort,
} from "./server";

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

let jwk: JWKInterface;

beforeAll(async () => {
  jwk = await generateJWK();
}, 60_000);

describe("keyring/server: serveKeyringRequest", () => {
  let keyring: Keyring;

  beforeEach(async () => {
    keyring = new Keyring();
    await serveKeyringRequest(keyring, { op: "import", walletId: "wallet-a", jwk: { ...jwk } });
  });

  it("signs base64 data and returns a signature that verifies against the owner", async () => {
    const data = bytes("deep hash stand-in");

    const reply = await serveKeyringRequest(keyring, {
      op: "sign",
      walletId: "wallet-a",
      hash: "SHA-256",
      saltLength: 32,
      data: bytesToBase64(data),
    });

    expect(reply.ok).toBe(true);
    const signature = base64ToBytes((reply as { result: string }).result);
    await expect(verifyRsaPss(jwk.n, data, signature)).resolves.toBe(true);
  });

  it("decrypts with an OAEP label", async () => {
    const label = bytes("ctx");
    const ciphertext = await encrypt(jwk.n, bytes("secret"), { name: "RSA-OAEP", label: label.buffer });

    const reply = await serveKeyringRequest(keyring, {
      op: "decrypt",
      walletId: "wallet-a",
      data: bytesToBase64(new Uint8Array(ciphertext)),
      label: bytesToBase64(label),
    });

    expect(new TextDecoder().decode(base64ToBytes((reply as { result: string }).result))).toBe("secret");
  });

  it("strips the JWK it received once imported", async () => {
    const received = { ...jwk };

    expect(await serveKeyringRequest(keyring, { op: "import", walletId: "wallet-b", jwk: received })).toEqual({
      ok: true,
      result: null,
    });
    expect(Object.keys(received)).toEqual([]);
    expect(await serveKeyringRequest(keyring, { op: "has", walletIds: ["wallet-b"] })).toEqual({
      ok: true,
      result: ["wallet-b"],
    });
  });

  it("answers a request for a wallet it holds no key for as locked", async () => {
    expect(
      await serveKeyringRequest(keyring, { op: "sign", walletId: "wallet-x", hash: "SHA-256", saltLength: 32, data: "" }),
    ).toMatchObject({ ok: false, locked: true });
  });

  it("removes one wallet and clears all", async () => {
    await serveKeyringRequest(keyring, { op: "remove", walletId: "wallet-a" });
    expect(await keyring.has(["wallet-a"])).toEqual([]);

    await keyring.importKey("wallet-a", jwk);
    await serveKeyringRequest(keyring, { op: "clear" });
    expect(await keyring.has(["wallet-a"])).toEqual([]);
  });

  it.each([
    ["not an object", "sign"],
    ["an unknown op", { op: "export", walletId: "wallet-a" }],
    ["a hash WebCrypto keys aren't bound to", { op: "sign", walletId: "wallet-a", hash: "SHA-1", saltLength: 32, data: "" }],
    ["a negative salt length", { op: "sign", walletId: "wallet-a", hash: "SHA-256", saltLength: -1, data: "" }],
    ["an import with no private exponent", { op: "import", walletId: "wallet-a", jwk: { n: "n", e: "AQAB" } }],
    ["a non-string wallet id", { op: "remove", walletId: 7 }],
  ])("refuses %s", async (_, message) => {
    expect(await serveKeyringRequest(keyring, message)).toEqual({ ok: false, error: "Malformed keyring request." });
  });
});

describe("keyring/server: serveKeyringEnvelope", () => {
  it("answers with the request's id", async () => {
    const keyring = new Keyring();
    await keyring.importKey("wallet-a", jwk);

    expect(await serveKeyringEnvelope(keyring, { id: 7, request: { op: "has", walletIds: ["wallet-a"] } })).toEqual({
      id: 7,
      reply: { ok: true, result: ["wallet-a"] },
    });
  });

  it("reports a malformed request under its id", async () => {
    expect(await serveKeyringEnvelope(new Keyring(), { id: 3, request: { op: "export" } })).toEqual({
      id: 3,
      reply: { ok: false, error: "Malformed keyring request." },
    });
  });

  it.each([["no id", { request: { op: "clear" } }], ["a fractional id", { id: 1.5, request: { op: "clear" } }], ["not an object", 4]])(
    "ignores a message with %s",
    async (_, message) => {
      expect(await serveKeyringEnvelope(new Keyring(), message)).toBeNull();
    },
  );
});

describe("keyring/server: keepKeyringConnected", () => {
  function fakeRuntime() {
    const ports: Array<{
      name: string;
      deliver(message: unknown): void;
      drop(): void;
      posted: KeyringResponse[];
    }> = [];
    return {
      ports,
      connect({ name }: { name: string }): KeyringDocumentPort {
        let onMessage: (message: unknown) => void = () => {};
        let onDisconnect: () => void = () => {};
        const posted: KeyringResponse[] = [];
        ports.push({ name, deliver: (message) => onMessage(message), drop: () => onDisconnect(), posted });
        return {
          postMessage: (message) => void posted.push(message),
          onMessage: { addListener: (listener) => (onMessage = listener) },
          onDisconnect: { addListener: (listener) => (onDisconnect = listener) },
        };
      },
    };
  }

  it("connects to the background under the keyring port name and answers on that port", async () => {
    const runtime = fakeRuntime();
    const keyring = new Keyring();
    await keyring.importKey("wallet-a", jwk);

    keepKeyringConnected(runtime, keyring);
    runtime.ports[0]!.deliver({ id: 1, request: { op: "has", walletIds: ["wallet-a"] } });

    expect(runtime.ports.map((port) => port.name)).toEqual([KEYRING_PORT_NAME]);
    await vi.waitFor(() => expect(runtime.ports[0]!.posted).toEqual([{ id: 1, reply: { ok: true, result: ["wallet-a"] } }]));
  });

  it("reconnects after each disconnect, backing off until a request gets through", () => {
    const runtime = fakeRuntime();
    const delays: number[] = [];
    const schedule = (run: () => void, delayMs: number) => {
      delays.push(delayMs);
      run();
    };

    keepKeyringConnected(runtime, new Keyring(), { minDelayMs: 100, maxDelayMs: 400, schedule });
    runtime.ports[0]!.drop();
    runtime.ports[1]!.drop();
    runtime.ports[2]!.drop();
    runtime.ports[3]!.drop();
    runtime.ports[4]!.deliver({ id: 1, request: { op: "clear" } });
    runtime.ports[4]!.drop();

    expect(delays).toEqual([100, 200, 400, 400, 100]);
    expect(runtime.ports).toHaveLength(6);
  });
});
