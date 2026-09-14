import { describe, expect, it } from "vitest";
import { decryptFromEnvelope, encryptToEnvelope } from "./envelope";
import { base64ToBytes } from "./base64";

const WALLET_ID = "wallet-1";
const ADDRESS = "abc123address";
const PASSWORD = "correct horse battery staple 42";

describe("envelope encrypt/decrypt round trip", () => {
  it("decrypts back to the original plaintext", async () => {
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ kty: "RSA", n: "example" }),
    );
    const original = plaintext.slice();

    const envelope = await encryptToEnvelope(
      plaintext,
      PASSWORD,
      WALLET_ID,
      ADDRESS,
    );
    const decrypted = await decryptFromEnvelope(
      envelope,
      PASSWORD,
      WALLET_ID,
      ADDRESS,
    );

    expect(new TextDecoder().decode(decrypted)).toBe(
      new TextDecoder().decode(original),
    );
  });

  it("produces the envelope shape declared by core/models/wallet.ts", async () => {
    const plaintext = new TextEncoder().encode("secret bytes");
    const envelope = await encryptToEnvelope(
      plaintext,
      PASSWORD,
      WALLET_ID,
      ADDRESS,
    );

    expect(envelope.version).toBe(1);
    expect(envelope.algorithm).toBe("AES-GCM");
    expect(envelope.kdf).toBe("PBKDF2-HMAC-SHA256");
    expect(envelope.iterations).toBe(600_000);
    expect(base64ToBytes(envelope.salt)).toHaveLength(16);
    expect(base64ToBytes(envelope.iv)).toHaveLength(12);
    expect(typeof envelope.ciphertext).toBe("string");
  });

  it("uses a fresh random salt and IV on every encrypt call", async () => {
    const plaintext = () => new TextEncoder().encode("same secret");
    const first = await encryptToEnvelope(plaintext(), PASSWORD, WALLET_ID, ADDRESS);
    const second = await encryptToEnvelope(plaintext(), PASSWORD, WALLET_ID, ADDRESS);

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("zeroizes the plaintext buffer passed to encryptToEnvelope", async () => {
    const plaintext = new TextEncoder().encode("zero me out");
    await encryptToEnvelope(plaintext, PASSWORD, WALLET_ID, ADDRESS);
    expect(Array.from(plaintext).every((byte) => byte === 0)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const plaintext = new TextEncoder().encode("secret bytes");
    const envelope = await encryptToEnvelope(
      plaintext,
      PASSWORD,
      WALLET_ID,
      ADDRESS,
    );

    await expect(
      decryptFromEnvelope(envelope, "totally wrong password", WALLET_ID, ADDRESS),
    ).rejects.toThrow();
  });

  it("rejects decryption when the walletId in the AAD doesn't match (moved to a different wallet record)", async () => {
    const plaintext = new TextEncoder().encode("secret bytes");
    const envelope = await encryptToEnvelope(
      plaintext,
      PASSWORD,
      WALLET_ID,
      ADDRESS,
    );

    await expect(
      decryptFromEnvelope(envelope, PASSWORD, "wallet-2", ADDRESS),
    ).rejects.toThrow();
  });

  it("rejects decryption when the address in the AAD doesn't match", async () => {
    const plaintext = new TextEncoder().encode("secret bytes");
    const envelope = await encryptToEnvelope(
      plaintext,
      PASSWORD,
      WALLET_ID,
      ADDRESS,
    );

    await expect(
      decryptFromEnvelope(envelope, PASSWORD, WALLET_ID, "different-address"),
    ).rejects.toThrow();
  });

  it("rejects a malformed envelope (invalid base64 ciphertext)", async () => {
    const envelope = await encryptToEnvelope(
      new TextEncoder().encode("secret"),
      PASSWORD,
      WALLET_ID,
      ADDRESS,
    );

    await expect(
      decryptFromEnvelope(
        { ...envelope, ciphertext: "not-valid-base64!!!" },
        PASSWORD,
        WALLET_ID,
        ADDRESS,
      ),
    ).rejects.toThrow(/corrupted/i);
  });

  it("rejects an envelope with an unsupported algorithm/KDF", async () => {
    const envelope = await encryptToEnvelope(
      new TextEncoder().encode("secret"),
      PASSWORD,
      WALLET_ID,
      ADDRESS,
    );

    await expect(
      decryptFromEnvelope(
        { ...envelope, kdf: "PBKDF2-SHA1" as never },
        PASSWORD,
        WALLET_ID,
        ADDRESS,
      ),
    ).rejects.toThrow(/can't read/i);
  });
});
