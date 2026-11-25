import forge from "node-forge";
import type { JWKInterface } from "../models/wallet";
import { bytesToBase64Url } from "../vault/base64";

/**
 * Derives the Arweave RSA-4096 key that Wander and arweave.app derive from
 * a BIP-39 seed, byte for byte. Their stack is `human-crypto-keys` 0.1.4
 * `getKeyPairFromSeed(seed, { id: "rsa", modulusLength: 4096 })`, which
 * seeds an HMAC-DRBG (SHA-256, `hmac-drbg` 1.0.1) with the seed and hands
 * it to forge's PRIMEINC key generation as its only randomness. This file
 * reproduces that without the wrapper, so the only dependency is forge,
 * pinned exactly in `pnpm-workspace.yaml`.
 *
 * Forge's callback path looks for web workers and, when `Worker` exists,
 * splits the prime search across them. That search races, so its primes
 * (and the wallet) depend on timing. `human-crypto-keys` blanks the global
 * `Worker` for the call; here the caller must run it where `Worker` is
 * already undefined (a dedicated worker that deletes it first, or Node),
 * and this function refuses to run otherwise.
 *
 * Miller-Rabin witnesses inside forge come from `Math.random`, as they do
 * in Wander, so the result is deterministic except with a probability far
 * below any real concern.
 *
 * Slow: pure-JS prime search takes from a few seconds to over a minute.
 */
export async function jwkFromSeed(seed: Uint8Array): Promise<JWKInterface> {
  if (typeof (globalThis as { Worker?: unknown }).Worker !== "undefined") {
    throw new Error("Recovery-phrase keys must be derived where Worker is undefined, or the key would vary.");
  }
  const drbg = new HmacDrbg(seed);
  const keyPair = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
    forge.pki.rsa.generateKeyPair(
      { bits: 4096, e: 0x10001, algorithm: "PRIMEINC", prng: { getBytesSync: (count: number) => drbg.generate(count) } },
      (error, pair) => (error ? reject(error) : resolve(pair)),
    );
  });
  drbg.clear();
  const key = keyPair.privateKey;
  return {
    kty: "RSA",
    e: bigIntegerToBase64Url(key.e),
    n: bigIntegerToBase64Url(key.n),
    d: bigIntegerToBase64Url(key.d),
    p: bigIntegerToBase64Url(key.p),
    q: bigIntegerToBase64Url(key.q),
    dp: bigIntegerToBase64Url(key.dP),
    dq: bigIntegerToBase64Url(key.dQ),
    qi: bigIntegerToBase64Url(key.qInv),
  };
}

/** Unsigned, minimal big-endian bytes as base64url, as WebCrypto exports a JWK. */
function bigIntegerToBase64Url(value: forge.jsbn.BigInteger): string {
  const signed = value.toByteArray();
  let start = 0;
  while (start < signed.length - 1 && signed[start] === 0) start++;
  const bytes = Uint8Array.from(signed.slice(start), (byte) => byte & 0xff);
  return bytesToBase64Url(bytes);
}

/**
 * HMAC_DRBG (NIST SP 800-90A) over SHA-256, matching `hmac-drbg` 1.0.1 as
 * `human-crypto-keys` constructs it: entropy is the seed, no nonce, no
 * personalization string, no additional input. Bytes are forge "binary
 * strings" (one char per byte), which is what forge's prng contract takes.
 */
class HmacDrbg {
  private key: string;
  private value: string;

  constructor(seed: Uint8Array) {
    this.key = "\x00".repeat(32);
    this.value = "\x01".repeat(32);
    this.update(forge.util.binary.raw.encode(seed));
  }

  generate(count: number): string {
    let output = "";
    while (output.length < count) {
      this.value = this.hmac(this.value);
      output += this.value;
    }
    this.update();
    return output.slice(0, count);
  }

  clear(): void {
    this.key = "";
    this.value = "";
  }

  private hmac(...parts: string[]): string {
    const mac = forge.hmac.create();
    mac.start("sha256", this.key);
    for (const part of parts) mac.update(part);
    return mac.digest().getBytes();
  }

  // With no data this is one round, as `hmac-drbg` does after each generate.
  private update(data?: string): void {
    this.key = this.hmac(this.value, "\x00", data ?? "");
    this.value = this.hmac(this.value);
    if (data === undefined) return;
    this.key = this.hmac(this.value, "\x01", data);
    this.value = this.hmac(this.value);
  }
}
