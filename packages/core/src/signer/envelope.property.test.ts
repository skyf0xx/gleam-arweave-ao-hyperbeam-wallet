import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import fc from "fast-check";
import * as hashWasm from "hash-wasm";
import { VaultKdfError, VaultKeys, decryptFromEnvelope, encryptToEnvelope } from "./envelope";
import { base64ToBytes, bytesToBase64 } from "../vault/base64";
import type { VaultEnvelope, VaultEnvelopeV1, VaultEnvelopeV2 } from "../models/wallet";

/*
 * A stored envelope, or the wrapped backup key in a cloud file's clear
 * header, may be anything. It opens only exactly as written, under its own
 * password and record; anything else is refused as a wrong password or a
 * corrupted envelope, and never makes the KDF run past its caps.
 */

interface Argon2Options {
  password: Uint8Array;
  salt: Uint8Array;
  memorySize: number;
  iterations: number;
  parallelism: number;
}

/*
 * The real Argon2id at its smallest memory (8 KiB a lane), with the asked
 * memory hashed into the result. hash-wasm itself checks every input as
 * it always does, and so refuses what it would refuse at full size; the
 * memory checks it makes are repeated here first. What this can't show is
 * the time or memory a full-size run takes: the caps are asserted on the
 * calls instead (`expectKdfWithinCaps`).
 */
vi.mock("hash-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("hash-wasm")>();
  return {
    ...actual,
    argon2id: vi.fn(async (options: Argon2Options & { hashLength: number; outputType: "binary" }) => {
      if (!Number.isInteger(options.memorySize)) throw new Error("Memory size should be specified.");
      if (options.memorySize < 8 * options.parallelism) throw new Error("Memory size should be at least 8 * parallelism.");
      const small = (await actual.argon2id({ ...options, memorySize: 8 * options.parallelism })) as Uint8Array;
      return new Uint8Array(createHash("sha256").update(small).update(String(options.memorySize)).digest());
    }),
  };
});

const PASSWORD = "correct horse battery staple";
const WALLET_ID = "wallet-1";
const ADDRESS = "a".repeat(43);
const WRONG_PASSWORD = "That password didn't unlock this wallet. Try again, or use your recovery method.";
const CAPS = { memoryKiB: 262_144, iterations: 10, parallelism: 16 };

let genuine: VaultEnvelopeV2;
const plaintext = new TextEncoder().encode('{"kty":"RSA"}');

beforeAll(async () => {
  genuine = await encryptToEnvelope(plaintext.slice(), PASSWORD, WALLET_ID, ADDRESS, {
    params: { memoryKiB: 64, iterations: 1, parallelism: 1 },
  });
});

beforeEach(() => {
  vi.mocked(hashWasm.argon2id).mockClear();
});

/** Each Argon2id run a decryption asked for stayed inside the stored-param caps, on a full-length salt. */
function expectKdfWithinCaps(): void {
  for (const [options] of vi.mocked(hashWasm.argon2id).mock.calls) {
    const { memorySize, iterations, parallelism, salt } = options as { memorySize: number; iterations: number; parallelism: number; salt: Uint8Array };
    expect(parallelism).toBeGreaterThanOrEqual(1);
    expect(parallelism).toBeLessThanOrEqual(CAPS.parallelism);
    expect(iterations).toBeGreaterThanOrEqual(1);
    expect(iterations).toBeLessThanOrEqual(CAPS.iterations);
    expect(memorySize).toBeGreaterThanOrEqual(8 * parallelism);
    expect(memorySize).toBeLessThanOrEqual(CAPS.memoryKiB);
    expect(salt.length).toBeGreaterThanOrEqual(16);
  }
}

async function outcome(envelope: VaultEnvelope, password = PASSWORD, walletId = WALLET_ID, address = ADDRESS) {
  try {
    return { opened: await decryptFromEnvelope(envelope, password, walletId, address) };
  } catch (error) {
    return { error: error as Error };
  }
}

const number = fc.oneof(fc.constantFrom(0, -1, 1, 7, 8, 64, 65, CAPS.memoryKiB, CAPS.memoryKiB + 1, 11, 17, 1.5, 1e9), fc.integer());
const base64 = fc.oneof(fc.base64String({ maxLength: 40 }), fc.string({ maxLength: 20 }));
const anyJson = fc.jsonValue({ maxDepth: 1 });

/** The genuine envelope with each field kept, mostly, or replaced by a near or hostile value. */
const hostileEnvelope = fc
  .record({
    version: fc.oneof(fc.constantFrom(1, 2, 3, "2"), anyJson),
    algorithm: fc.oneof(fc.constantFrom("AES-GCM", "AES-CBC"), anyJson),
    kdf: fc.oneof(fc.constantFrom("Argon2id", "PBKDF2-HMAC-SHA256"), anyJson),
    memoryKiB: fc.oneof(number, anyJson),
    iterations: fc.oneof(number, anyJson),
    parallelism: fc.oneof(number, anyJson),
    salt: fc.oneof(base64, anyJson),
    iv: fc.oneof(base64, anyJson),
    ciphertext: fc.oneof(base64, anyJson),
  })
  .chain((replacements) =>
    fc
      .subarray(Object.keys(replacements) as Array<keyof typeof replacements>, { minLength: 1 })
      .map((fields) => ({ ...genuine, ...Object.fromEntries(fields.map((field) => [field, replacements[field]])) }) as unknown as VaultEnvelope),
  );

const sameFields = (envelope: VaultEnvelope) =>
  (Object.keys(genuine) as Array<keyof VaultEnvelopeV2>).every((field) => (envelope as unknown as VaultEnvelopeV2)[field] === genuine[field]);

describe("decryptFromEnvelope on a hostile envelope", () => {
  // A hostile v1 envelope runs PBKDF2's 600,000 rounds per try; these stand
  // in for it here, and the real one is covered below.
  let deriveKey: MockInstance<SubtleCrypto["deriveKey"]>;
  beforeAll(async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    deriveKey = vi.spyOn(crypto.subtle, "deriveKey").mockResolvedValue(key);
  });
  afterAll(() => {
    deriveKey.mockRestore();
  });

  it("refuses it as a wrong password or a corrupted envelope, within the KDF caps", async () => {
    await fc.assert(
      fc.asyncProperty(hostileEnvelope, async (envelope) => {
        vi.mocked(hashWasm.argon2id).mockClear();
        const result = await outcome(envelope);
        expectKdfWithinCaps();
        if ("opened" in result) {
          // Only an edit that put a field back as it was can still open.
          expect(sameFields(envelope)).toBe(true);
          expect(result.opened).toEqual(plaintext);
          return;
        }
        expect(result.error instanceof VaultKdfError || result.error.message === WRONG_PASSWORD).toBe(true);
        expect(result.error.constructor === VaultKdfError || result.error.constructor === Error).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it("opens the genuine envelope only under its own password, wallet id and address", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ password: fc.oneof(fc.constant(PASSWORD), fc.string()), walletId: fc.oneof(fc.constant(WALLET_ID), fc.string()), address: fc.oneof(fc.constant(ADDRESS), fc.string()) }),
        async ({ password, walletId, address }) => {
          const result = await outcome(genuine, password, walletId, address);
          if (password === PASSWORD && walletId === WALLET_ID && address === ADDRESS) {
            expect(result).toEqual({ opened: plaintext });
          } else if (password === "") {
            // Argon2id takes no empty password, so the check can't run at all.
            expect(result.error).toBeInstanceOf(VaultKdfError);
          } else {
            expect(result.error?.message).toBe(WRONG_PASSWORD);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("refuses any one changed bit of the IV or ciphertext", async () => {
    const iv = base64ToBytes(genuine.iv);
    const ciphertext = base64ToBytes(genuine.ciphertext);
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.nat(), fc.integer({ min: 0, max: 7 }), async (inIv, position, bit) => {
        const bytes = (inIv ? iv : ciphertext).slice();
        bytes[position % bytes.length]! ^= 1 << bit;
        const field = inIv ? "iv" : "ciphertext";
        const result = await outcome({ ...genuine, [field]: Buffer.from(bytes).toString("base64") });
        expect(result.error?.message).toBe(WRONG_PASSWORD);
      }),
      { numRuns: 200 },
    );
  });
});

describe("a version 1 envelope, with the real PBKDF2", () => {
  let v1: VaultEnvelopeV1;
  beforeAll(async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(PASSWORD), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const additionalData = new TextEncoder().encode(`gleam:v1:${WALLET_ID}:${ADDRESS}`);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, plaintext));
    v1 = {
      version: 1,
      algorithm: "AES-GCM",
      kdf: "PBKDF2-HMAC-SHA256",
      iterations: 600_000,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
    };
  });

  it("opens under its own password and record, and only there", async () => {
    // One instance, so the key derives once for every attempt below.
    const keys = new VaultKeys(PASSWORD);
    expect(await decryptFromEnvelope(v1, keys, WALLET_ID, ADDRESS)).toEqual(plaintext);
    await expect(decryptFromEnvelope(v1, keys, WALLET_ID, `${ADDRESS}b`)).rejects.toThrow(WRONG_PASSWORD);
    await expect(decryptFromEnvelope({ ...v1, version: 2 } as unknown as VaultEnvelope, keys, WALLET_ID, ADDRESS)).rejects.toBeInstanceOf(VaultKdfError);
    await expect(decryptFromEnvelope({ ...v1, kdf: "Argon2id" } as unknown as VaultEnvelope, keys, WALLET_ID, ADDRESS)).rejects.toBeInstanceOf(VaultKdfError);
    await expect(decryptFromEnvelope({ ...v1, iv: bytesToBase64(new Uint8Array(16)) }, keys, WALLET_ID, ADDRESS)).rejects.toBeInstanceOf(VaultKdfError);
  });
});
