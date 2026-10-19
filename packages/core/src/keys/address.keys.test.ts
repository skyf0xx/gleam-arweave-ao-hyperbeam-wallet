import { describe, expect, it } from "vitest";
import { addressFromOwner } from "./address";
import { deriveAddress } from "./jwk";
import { generateJWK } from "../signer/keys";

describe("addressFromOwner", () => {
  it("matches arweave-js's address for the same key", async () => {
    const jwk = await generateJWK();

    expect(await addressFromOwner(jwk.n)).toBe(await deriveAddress(jwk));
  }, 30_000);
});
