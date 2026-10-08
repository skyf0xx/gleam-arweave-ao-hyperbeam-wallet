import { describe, expect, it } from "vitest";
import { deriveAddress, generateJWK } from "../keys/jwk";
import {
  addressFromOwner,
  deviceKeyThumbprint,
  isDevicePublicJwk,
  signDeviceMessage,
  verifyDeviceSignature,
  type DevicePublicJwk,
} from "./identity";

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

describe("device signatures", () => {
  async function devicePair() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
    const jwk: DevicePublicJwk = { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y! };
    return { privateKey: pair.privateKey, jwk };
  }

  it("verifies a signature over the same message only", async () => {
    const { privateKey, jwk } = await devicePair();
    const signature = await signDeviceMessage(privateKey, "gleam-points:heartbeat:v1:1");

    expect(await verifyDeviceSignature(jwk, "gleam-points:heartbeat:v1:1", signature)).toBe(true);
    expect(await verifyDeviceSignature(jwk, "gleam-points:heartbeat:v1:2", signature)).toBe(false);
  });

  it("rejects another device's signature and garbage without throwing", async () => {
    const first = await devicePair();
    const second = await devicePair();
    const signature = await signDeviceMessage(first.privateKey, "m");

    expect(await verifyDeviceSignature(second.jwk, "m", signature)).toBe(false);
    expect(await verifyDeviceSignature(first.jwk, "m", "not-a-signature")).toBe(false);
  });

  it("shape-checks a wire key", async () => {
    const { jwk } = await devicePair();

    expect(isDevicePublicJwk(jwk)).toBe(true);
    expect(isDevicePublicJwk({ ...jwk, crv: "P-384" })).toBe(false);
    expect(isDevicePublicJwk({ ...jwk, x: "short" })).toBe(false);
    expect(isDevicePublicJwk(null)).toBe(false);
  });
});
