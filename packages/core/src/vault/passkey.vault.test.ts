import { describe, expect, it } from "vitest";
import { unwrapWithPasskey, wrapWithPasskey } from "./passkey";

const CREDENTIAL_ID = "cred-1";

function prf(fill: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(32).fill(fill);
}

describe("passkey wrapping", () => {
  it("round-trips the secret with the same PRF output and credential", async () => {
    const wrapped = await wrapWithPasskey("correct horse battery staple", prf(7), CREDENTIAL_ID);
    await expect(unwrapWithPasskey(wrapped, prf(7), CREDENTIAL_ID)).resolves.toBe("correct horse battery staple");
  });

  it("never stores the secret in the clear", async () => {
    const wrapped = await wrapWithPasskey("correct horse battery staple", prf(7), CREDENTIAL_ID);
    expect(atob(wrapped.ciphertext)).not.toContain("correct horse");
  });

  it("refuses a different PRF output", async () => {
    const wrapped = await wrapWithPasskey("secret", prf(7), CREDENTIAL_ID);
    await expect(unwrapWithPasskey(wrapped, prf(8), CREDENTIAL_ID)).rejects.toThrow(/didn't unlock/);
  });

  it("refuses the ciphertext under another credential id", async () => {
    const wrapped = await wrapWithPasskey("secret", prf(7), CREDENTIAL_ID);
    await expect(unwrapWithPasskey(wrapped, prf(7), "cred-2")).rejects.toThrow(/didn't unlock/);
  });

  it("rejects a PRF output that isn't 32 bytes", async () => {
    await expect(wrapWithPasskey("secret", new Uint8Array(16), CREDENTIAL_ID)).rejects.toThrow(/unexpected/);
  });
});
