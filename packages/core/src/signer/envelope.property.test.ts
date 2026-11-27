import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import * as hashWasm from "hash-wasm";
import { VaultKdfError, decryptFromEnvelope, encryptToEnvelope } from "./envelope";
import { base64ToBytes } from "../vault/base64";
import type { VaultEnvelope, VaultEnvelopeV2 } from "../models/wallet";

/*
 * A stored envelope, or the wrapped backup key in a cloud file's clear
 * header, may be anything. It opens only exactly as written, under its own
 * password and record; anything else is refused as a wrong password or a
 * corrupted envelope, and never makes the KDF run past its caps.
 */

// A stand-in for Argon2id that still depends on every input, so a changed
// salt or cost gives another key, without spending real seconds per run.
vi.mock("hash-wasm", () => ({
  argon2id: vi.fn(async (options: { password: Uint8Array; salt: Uint8Array; memorySize: number; iterations: number; parallelism: number }) =>
    new Uint8Array(
      createHash("sha256")
        .update(options.password)
        .update(options.salt)
        .update(`${options.memorySize}:${options.iterations}:${options.parallelism}`)
        .digest(),
    ),
  ),
}));

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
  // PBKDF2's 600,000 rounds would dominate the run; no genuine envelope here uses it.
  const key = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  vi.spyOn(crypto.subtle, "deriveKey").mockResolvedValue(key);
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
