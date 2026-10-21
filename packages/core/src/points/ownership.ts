import { sha256 } from "../arweave/rsa-pss";
import { verifyTransactionSignature, type ArweaveTransactionJson } from "../arweave/transaction";
import { addressFromOwner } from "../keys/address";
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

/**
 * True when any tag is named `POINTS_PROOF_TAG`, given decoded tag names.
 * A proof only verifies with the exact name, but the match ignores case,
 * surrounding whitespace and byte-order marks, so a near-miss spelling is
 * refused too rather than signed.
 */
export function hasPointsProofTag(tags: ReadonlyArray<{ name: string }>): boolean {
  const proofTag = POINTS_PROOF_TAG.toLowerCase();
  return tags.some((tag) => tag.name.trim().toLowerCase() === proofTag);
}

const encoder = new TextEncoder();

/**
 * The transaction a hardware wallet signs to prove ownership. Both sides
 * build it from the message and owner alone, so only the signature
 * travels. It can never be mined: it moves 0 AR, pays a 0 fee, and its
 * anchor is a hash of the message rather than a recent block or
 * transaction.
 *
 * It targets the wallet's own address because the Ledger Arweave app
 * refuses any transaction with an empty target: it can't render the
 * Target screen and fails with "Unexpected buffer end".
 */
export async function buildOwnershipTransaction(ownerB64Url: string, message: string): Promise<ArweaveTransactionJson> {
  return { ...(await legacyOwnershipTransaction(ownerB64Url, message)), target: await addressFromOwner(ownerB64Url) };
}

/** The target-less form v1.27.0 builds. Keystone wallets on that release still sign it. */
async function legacyOwnershipTransaction(ownerB64Url: string, message: string): Promise<ArweaveTransactionJson> {
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
      for (const build of [buildOwnershipTransaction, legacyOwnershipTransaction]) {
        if (await verifyTransactionSignature(await build(ownerB64Url, message), signature, ownerB64Url)) return true;
      }
      return false;
    }
    return await verifyMessage(ownerB64Url, encoder.encode(message).buffer as ArrayBuffer, signature.buffer as ArrayBuffer);
  } catch {
    // An owner that isn't a usable RSA modulus, or a signature that isn't base64url, fails verification.
    return false;
  }
}
