import { describe, expect, it } from "vitest";
import { deriveAddress, generateJWK } from "../keys/jwk";
import { addressFromOwner, deviceKeyThumbprint, type DevicePublicJwk } from "./identity";

describe("addressFromOwner", () => {
  it("matches arweave-js's address for the same key", async () => {
    const jwk = await generateJWK();

    expect(await addressFromOwner(jwk.n)).toBe(await deriveAddress(jwk));
  }, 30_000);
});

describe("deviceKeyThumbprint", () => {
  it("is a stable 43-character digest that ignores member order and extra members", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
    const jwk: DevicePublicJwk = { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y! };
    const reordered = { y: jwk.y, x: jwk.x, crv: jwk.crv, kty: jwk.kty, key_ops: ["verify"] } as DevicePublicJwk;

    const thumbprint = await deviceKeyThumbprint(jwk);

    expect(thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await deviceKeyThumbprint(reordered)).toBe(thumbprint);
  });
});
