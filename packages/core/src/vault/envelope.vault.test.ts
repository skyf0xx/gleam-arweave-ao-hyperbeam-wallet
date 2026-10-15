import { describe, expect, it, vi } from "vitest";
import * as hashWasm from "hash-wasm";
import {
  DEFAULT_ARGON2ID_PARAMS,
  VaultKdfError,
  VaultKeys,
  decryptFromEnvelope,
  encryptToEnvelope,
  envelopeNeedsUpgrade,
} from "./envelope";
import { base64ToBytes, bytesToBase64 } from "./base64";
import type { Argon2idParams, VaultEnvelope, VaultEnvelopeV1 } from "../models/wallet";

vi.mock("hash-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("hash-wasm")>();
  return { ...actual, argon2id: vi.fn(actual.argon2id) };
});

const WALLET_ID = "wallet-1";
const ADDRESS = "abc123address";
const PASSWORD = "correct horse battery staple 42";
const PARAMS: Argon2idParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };

function encode(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function encrypt(text: string, password: string | VaultKeys = PASSWORD, salt?: string) {
  return encryptToEnvelope(encode(text), password, WALLET_ID, ADDRESS, { params: PARAMS, salt });
}

async function decryptText(envelope: VaultEnvelope, password: string | VaultKeys = PASSWORD) {
  return new TextDecoder().decode(await decryptFromEnvelope(envelope, password, WALLET_ID, ADDRESS));
}

/** A version 1 envelope as every Gleam release before Argon2id wrote it. */
async function encryptV1(text: string, password = PASSWORD): Promise<VaultEnvelopeV1> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encode(`gleam:v1:${WALLET_ID}:${ADDRESS}`) },
    key,
    encode(text),
  );
  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-HMAC-SHA256",
    iterations: 600_000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

describe("envelope encrypt/decrypt round trip", () => {
  it("decrypts a version 2 envelope back to the original plaintext", async () => {
    const envelope = await encrypt(JSON.stringify({ kty: "RSA", n: "example" }));
    expect(await decryptText(envelope)).toBe(JSON.stringify({ kty: "RSA", n: "example" }));
  });

  it("writes an Argon2id version 2 envelope that records its params", async () => {
    const envelope = await encrypt("secret bytes");

    expect(envelope).toMatchObject({
      version: 2,
      algorithm: "AES-GCM",
      kdf: "Argon2id",
      memoryKiB: 64,
      iterations: 1,
      parallelism: 1,
    });
    expect(base64ToBytes(envelope.salt)).toHaveLength(16);
    expect(base64ToBytes(envelope.iv)).toHaveLength(12);
    expect(typeof envelope.ciphertext).toBe("string");
  });

  it("defaults to 64 MiB Argon2id", () => {
    expect(DEFAULT_ARGON2ID_PARAMS).toEqual({ memoryKiB: 65_536, iterations: 5, parallelism: 1 });
  });

  it("still decrypts a version 1 PBKDF2 envelope", async () => {
    const envelope = await encryptV1("legacy secret");
    expect(await decryptText(envelope)).toBe("legacy secret");
  });

  it("rejects a version 1 envelope under the wrong password", async () => {
    const envelope = await encryptV1("legacy secret");
    await expect(decryptText(envelope, "totally wrong password")).rejects.toThrow(/didn't unlock/);
  });

  it("uses a fresh random salt and IV on every encrypt call", async () => {
    const first = await encrypt("same secret");
    const second = await encrypt("same secret");

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("reuses a given salt but never an IV", async () => {
    const first = await encrypt("same secret");
    const second = await encrypt("same secret", PASSWORD, first.salt);

    expect(second.salt).toBe(first.salt);
    expect(second.iv).not.toBe(first.iv);
    expect(await decryptText(second)).toBe("same secret");
  });

  it("zeroizes the plaintext buffer passed to encryptToEnvelope", async () => {
    const plaintext = encode("zero me out");
    await encryptToEnvelope(plaintext, PASSWORD, WALLET_ID, ADDRESS, { params: PARAMS });
    expect(Array.from(plaintext).every((byte) => byte === 0)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const envelope = await encrypt("secret bytes");
    await expect(decryptText(envelope, "totally wrong password")).rejects.toThrow(/didn't unlock/);
  });

  it("rejects decryption when the walletId in the AAD doesn't match (moved to a different wallet record)", async () => {
    const envelope = await encrypt("secret bytes");
    await expect(decryptFromEnvelope(envelope, PASSWORD, "wallet-2", ADDRESS)).rejects.toThrow();
  });

  it("rejects decryption when the address in the AAD doesn't match", async () => {
    const envelope = await encrypt("secret bytes");
    await expect(decryptFromEnvelope(envelope, PASSWORD, WALLET_ID, "different-address")).rejects.toThrow();
  });

  it("rejects a version 2 envelope relabelled as version 1", async () => {
    const envelope = await encrypt("secret bytes");
    const relabelled = { ...envelope, version: 1 } as unknown as VaultEnvelope;
    await expect(decryptText(relabelled)).rejects.toThrow(/can't read/);
  });

  it.each([
    ["memoryKiB", { memoryKiB: 128 }],
    ["iterations", { iterations: 2 }],
    ["parallelism", { parallelism: 2 }],
  ])("rejects an envelope whose %s was altered", async (_field, change) => {
    const envelope = await encrypt("secret bytes");
    await expect(decryptText({ ...envelope, ...change })).rejects.toThrow(/didn't unlock/);
  });

  it("rejects an envelope whose salt was altered", async () => {
    const envelope = await encrypt("secret bytes");
    const salt = base64ToBytes(envelope.salt);
    salt[0] = salt[0]! ^ 1;
    await expect(decryptText({ ...envelope, salt: bytesToBase64(salt) })).rejects.toThrow(/didn't unlock/);
  });

  it("rejects an envelope whose ciphertext was altered", async () => {
    const envelope = await encrypt("secret bytes");
    const ciphertext = base64ToBytes(envelope.ciphertext);
    ciphertext[0] = ciphertext[0]! ^ 1;
    await expect(decryptText({ ...envelope, ciphertext: bytesToBase64(ciphertext) })).rejects.toThrow(
      /didn't unlock/,
    );
  });

  it.each([
    ["memory beyond 256 MiB", { memoryKiB: 262_145 }],
    ["more than 10 passes", { iterations: 11 }],
    ["memory below 8 KiB per lane", { memoryKiB: 8, parallelism: 2 }],
    ["zero iterations", { iterations: 0 }],
    ["fractional iterations", { iterations: 1.5 }],
    ["a string param", { memoryKiB: "64" as unknown as number }],
  ])("refuses to run Argon2id with %s", async (_label, change) => {
    const envelope = await encrypt("secret bytes");
    vi.mocked(hashWasm.argon2id).mockClear();
    await expect(decryptText({ ...envelope, ...change })).rejects.toThrow(/corrupted/);
    expect(hashWasm.argon2id).not.toHaveBeenCalled();
  });

  it("rejects a salt shorter than 16 bytes", async () => {
    const envelope = await encrypt("secret bytes");
    await expect(decryptText({ ...envelope, salt: bytesToBase64(new Uint8Array(8)) })).rejects.toThrow(
      /corrupted/,
    );
  });

  it("rejects a malformed envelope (invalid base64 ciphertext)", async () => {
    const envelope = await encrypt("secret");
    await expect(decryptText({ ...envelope, ciphertext: "not-valid-base64!!!" })).rejects.toThrow(/corrupted/i);
  });

  it("rejects an envelope with an unsupported algorithm/KDF", async () => {
    const envelope = await encrypt("secret");
    await expect(decryptText({ ...envelope, kdf: "PBKDF2-SHA1" as never })).rejects.toThrow(/can't read/i);
  });

  it("rejects an IV of the wrong length as corrupted, not as a wrong password", async () => {
    const envelope = await encrypt("secret");
    await expect(decryptText({ ...envelope, iv: bytesToBase64(new Uint8Array(8)) })).rejects.toBeInstanceOf(
      VaultKdfError,
    );
  });
});

describe("decryptFromEnvelope failure kinds", () => {
  it("throws a plain Error, not VaultKdfError, for a wrong password", async () => {
    const envelope = await encrypt("secret");
    const failure = await decryptText(envelope, "totally wrong password").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(VaultKdfError);
  });

  it("throws VaultKdfError for an unreadable or corrupted envelope", async () => {
    const envelope = await encrypt("secret");
    await expect(decryptText({ ...envelope, kdf: "scrypt" as never })).rejects.toBeInstanceOf(VaultKdfError);
    await expect(decryptText({ ...envelope, iterations: 0 })).rejects.toBeInstanceOf(VaultKdfError);
    await expect(decryptText({ ...envelope, ciphertext: "!!!" })).rejects.toBeInstanceOf(VaultKdfError);
  });

  it("wraps an Argon2id runtime failure without exposing the WASM message", async () => {
    const envelope = await encrypt("secret");
    const cause = new RangeError("WebAssembly.Memory(): could not allocate memory");
    vi.mocked(hashWasm.argon2id).mockRejectedValueOnce(cause);

    const failure = await decryptText(envelope).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(VaultKdfError);
    expect((failure as Error).message).toMatch(/couldn't run its password check/);
    expect((failure as Error).message).not.toMatch(/WebAssembly/);
    expect((failure as Error).cause).toBe(cause);
  });

  it("throws VaultKdfError when encrypting fails to derive a key", async () => {
    vi.mocked(hashWasm.argon2id).mockRejectedValueOnce(new Error("CompileError"));
    await expect(encrypt("secret")).rejects.toBeInstanceOf(VaultKdfError);
  });
});

describe("VaultKeys", () => {
  it("runs Argon2id once for every envelope that shares a salt and params", async () => {
    const keys = new VaultKeys(PASSWORD);
    const first = await encrypt("one", keys);
    const second = await encrypt("two", keys, first.salt);
    vi.mocked(hashWasm.argon2id).mockClear();

    const fresh = new VaultKeys(PASSWORD);
    expect(await decryptText(first, fresh)).toBe("one");
    expect(await decryptText(second, fresh)).toBe("two");
    expect(hashWasm.argon2id).toHaveBeenCalledTimes(1);
  });

  it("derives again after a failed derivation", async () => {
    const keys = new VaultKeys(PASSWORD);
    const envelope = await encrypt("one");
    vi.mocked(hashWasm.argon2id).mockRejectedValueOnce(new Error("out of memory"));

    await expect(decryptText(envelope, keys)).rejects.toBeInstanceOf(VaultKdfError);
    expect(await decryptText(envelope, keys)).toBe("one");
  });
});

describe("envelopeNeedsUpgrade", () => {
  it("upgrades every version 1 envelope", async () => {
    expect(envelopeNeedsUpgrade(await encryptV1("legacy"), PARAMS)).toBe(true);
  });

  it("keeps a version 2 envelope at or above the target params", async () => {
    const envelope = await encrypt("current");
    expect(envelopeNeedsUpgrade(envelope, PARAMS)).toBe(false);
    expect(envelopeNeedsUpgrade(envelope, { ...PARAMS, memoryKiB: 32 })).toBe(false);
  });

  it("upgrades a version 2 envelope once the target params are raised", async () => {
    const envelope = await encrypt("current");
    expect(envelopeNeedsUpgrade(envelope, { ...PARAMS, memoryKiB: 128 })).toBe(true);
    expect(envelopeNeedsUpgrade(envelope, { ...PARAMS, iterations: 2 })).toBe(true);
  });
});
