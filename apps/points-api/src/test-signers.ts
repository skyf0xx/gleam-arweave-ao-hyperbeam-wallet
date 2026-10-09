import {
  buildDeviceMessage,
  buildLeaveMessage,
  buildRedeemMessage,
  buildRegisterMessage,
  deviceKeyThumbprint,
  signDeviceMessage,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import { deriveAddress, generateJWK } from "@gleam/core/src/keys/jwk.ts";
import { bytesToBase64Url } from "@gleam/core/src/vault/base64.ts";
import { signMessage } from "@gleam/core/src/vault/message-signing.ts";
import type { JWKInterface } from "@gleam/core/src/models/wallet.ts";

export interface TestWallet {
  jwk: JWKInterface;
  address: string;
}

export async function createTestWallet(): Promise<TestWallet> {
  const jwk = await generateJWK();
  return { jwk, address: await deriveAddress(jwk) };
}

export interface TestDevice {
  id: string;
  publicKey: DevicePublicJwk;
  privateKey: CryptoKey;
}

export async function createTestDevice(): Promise<TestDevice> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const publicKey: DevicePublicJwk = { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y! };
  return { id: await deviceKeyThumbprint(publicKey), publicKey, privateKey: pair.privateKey };
}

export async function registerBody(
  wallet: TestWallet,
  device: TestDevice,
  options: { inviteCode?: string | null; issuedAt: number },
) {
  const message = buildRegisterMessage({
    deviceKeyThumbprint: device.id,
    inviteCode: options.inviteCode ?? null,
    issuedAt: options.issuedAt,
  });
  const signature = await signMessage(wallet.jwk, new TextEncoder().encode(message).buffer as ArrayBuffer);
  return {
    owner: wallet.jwk.n,
    message,
    signature: bytesToBase64Url(new Uint8Array(signature)),
    devicePublicKey: device.publicKey,
  };
}

export async function deviceBody(device: TestDevice, kind: "heartbeat" | "me", issuedAt: number) {
  const message = buildDeviceMessage(kind, issuedAt);
  return { deviceId: device.id, message, signature: await signDeviceMessage(device.privateKey, message) };
}

export async function leaveBody(wallet: TestWallet, issuedAt: number, address = wallet.address) {
  const message = buildLeaveMessage(address, issuedAt);
  const signature = await signMessage(wallet.jwk, new TextEncoder().encode(message).buffer as ArrayBuffer);
  return { owner: wallet.jwk.n, message, signature: bytesToBase64Url(new Uint8Array(signature)) };
}

export async function redeemBody(device: TestDevice, code: string, issuedAt: number) {
  const message = buildRedeemMessage(code, issuedAt);
  return {
    code,
    message,
    signature: await signDeviceMessage(device.privateKey, message),
    devicePublicKey: device.publicKey,
  };
}
