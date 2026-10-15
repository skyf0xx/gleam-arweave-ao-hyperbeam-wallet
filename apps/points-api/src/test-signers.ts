import {
  buildDeviceMessage,
  buildLeaveMessage,
  buildRedeemMessage,
  buildOwnershipTransaction,
  buildRegisterMessage,
  deviceKeyThumbprint,
  signDeviceMessage,
  type DevicePublicJwk,
  type PointsProofKind,
} from "@gleam/core/src/points/index.ts";
import { signTransactionWithSigner } from "@gleam/core/src/arweave/transaction.ts";
import { deriveAddress, generateJWK } from "@gleam/core/src/keys/jwk.ts";
import { bytesToBase64Url } from "@gleam/core/src/vault/base64.ts";
import { signMessage } from "@gleam/core/src/vault/message-signing.ts";
import { signerFromJwk, type Signer } from "@gleam/core/src/vault/signer.ts";

export interface TestWallet {
  signer: Signer;
  address: string;
}

export async function createTestWallet(): Promise<TestWallet> {
  const jwk = await generateJWK();
  const address = await deriveAddress(jwk);
  return { signer: signerFromJwk(jwk, address), address };
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

/** A `message` proof as a keyfile signs it, or a `transaction` proof as a hardware wallet does. */
async function signProof(wallet: TestWallet, message: string, proof: PointsProofKind): Promise<string> {
  const signature =
    proof === "transaction"
      ? await signTransactionWithSigner(await buildOwnershipTransaction(wallet.signer.owner, message), wallet.signer)
      : new Uint8Array(await signMessage(wallet.signer, new TextEncoder().encode(message).buffer as ArrayBuffer));
  return bytesToBase64Url(signature);
}

export async function registerBody(
  wallet: TestWallet,
  device: TestDevice,
  options: { inviteCode?: string | null; issuedAt: number; proof?: PointsProofKind },
) {
  const message = buildRegisterMessage({
    deviceKeyThumbprint: device.id,
    inviteCode: options.inviteCode ?? null,
    issuedAt: options.issuedAt,
  });
  return {
    owner: wallet.signer.owner,
    message,
    signature: await signProof(wallet, message, options.proof ?? "message"),
    ...(options.proof === "transaction" ? { proof: "transaction" } : {}),
    devicePublicKey: device.publicKey,
  };
}

export async function deviceBody(device: TestDevice, kind: "heartbeat" | "me", issuedAt: number) {
  const message = buildDeviceMessage(kind, issuedAt);
  return { deviceId: device.id, message, signature: await signDeviceMessage(device.privateKey, message) };
}

export async function leaveBody(
  wallet: TestWallet,
  issuedAt: number,
  address = wallet.address,
  proof: PointsProofKind = "message",
) {
  const message = buildLeaveMessage(address, issuedAt);
  return {
    owner: wallet.signer.owner,
    message,
    signature: await signProof(wallet, message, proof),
    ...(proof === "transaction" ? { proof: "transaction" } : {}),
  };
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
