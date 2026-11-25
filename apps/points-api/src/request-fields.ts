import { isDevicePublicJwk, type DevicePublicJwk } from "@gleam/core/src/points/index.ts";
import { z } from "zod";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const MAX_OWNER_LENGTH = 700;

const base64url = (maxLength: number) => z.string().max(maxLength).regex(BASE64URL);

/** An Arweave public key (the `owner` of a JWK), or the address derived from one. */
export const owner = base64url(MAX_OWNER_LENGTH);
export const walletMessage = z.string().max(200);
export const walletSignature = base64url(1000);
/** `transaction` for a hardware wallet; see `core/points/ownership.ts`. */
export const proof = z.enum(["message", "transaction"]).default("message");

/** A request the wallet's own key signed: register, leave and scan submissions. */
export const walletSigned = z.object({ owner, message: walletMessage, signature: walletSignature, proof });

export const deviceMessage = z.string().max(100);
export const deviceSignature = base64url(200);
export const devicePublicKey = z.custom<DevicePublicJwk>(isDevicePublicJwk);
