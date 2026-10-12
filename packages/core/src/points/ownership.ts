import { sha256 } from "../arweave/rsa-pss";
import { verifyTransactionSignature, type ArweaveTransactionJson } from "../arweave/transaction";
import { base64UrlToBytes, bytesToBase64Url } from "../vault/base64";
import { verifyMessage } from "../vault/message-signing";

/**
 * How a wallet proves it owns its address to the points API. A keyfile
 * signs the Points message with `signMessage`. A hardware wallet can't
 * sign messages, so it signs an Arweave transaction that carries the
 * message in a tag instead.
 */
export type PointsProofKind = "message" | "transaction";

export const POINTS_PROOF_TAG = "Gleam-Points";

const encoder = new TextEncoder();

/**
 * The transaction a hardware wallet signs to prove ownership. Both sides
 * build it from the message and owner alone, so only the signature
 * travels. It can never be mined: it moves 0 AR, pays a 0 fee, and its
 * anchor is a hash of the message rather than a recent block or
 * transaction.
 */
export async function buildOwnershipTransaction(ownerB64Url: string, message: string): Promise<ArweaveTransactionJson> {
  const anchor = await sha256(encoder.encode(`gleam-points:anchor:${message}`));
  return {
    format: 2,
    id: "",
    last_tx: bytesToBase64Url(anchor),
    owner: ownerB64Url,
    tags: [{ name: bytesToBase64Url(encoder.encode(POINTS_PROOF_TAG)), value: bytesToBase64Url(encoder.encode(message)) }],
    target: "",
    quantity: "0",
    data: "",
    data_size: "0",
    data_root: "",
    reward: "0",
    signature: "",
  };
}

/** True when `signatureB64Url` proves `ownerB64Url` signed `message` in the given form. */
export async function verifyPointsProof(
  kind: PointsProofKind,
  ownerB64Url: string,
  message: string,
  signatureB64Url: string,
): Promise<boolean> {
  try {
    const signature = base64UrlToBytes(signatureB64Url);
    if (kind === "transaction") {
      return await verifyTransactionSignature(await buildOwnershipTransaction(ownerB64Url, message), signature, ownerB64Url);
    }
    return await verifyMessage(ownerB64Url, encoder.encode(message).buffer as ArrayBuffer, signature.buffer as ArrayBuffer);
  } catch {
    // An owner that isn't a usable RSA modulus, or a signature that isn't base64url, fails verification.
    return false;
  }
}
