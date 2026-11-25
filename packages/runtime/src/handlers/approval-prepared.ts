import {
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  type DeviceSigningPayload,
  type SignTransactionInput,
  type UnsignedPayload,
} from "@gleam/core";
import { POINTS_PROOF_TAG } from "@gleam/core/src/points/index.ts";
import { dappError } from "../dapp-error";
import {
  assertNameTargetMatches,
  assertTransferMatches,
  checkDataItem,
  checkTransaction,
  mismatch,
} from "./prepared-check";
import type { SigningRequestInput } from "./approval-types";

// A leading byte order mark is signed like any other character, so it is
// kept, and shown where the text is shown.
export const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

function plainTags(tags: SigningRequestInput["tags"]): Array<{ name: string; value: string }> {
  return (tags ?? []).map(({ name, value }) => ({ name, value }));
}

/**
 * Re-reads what was prepared against the request the user approved. The
 * transaction builder fetches the anchor after approval; everything else,
 * the reward included, must come out exactly as requested.
 */
export function assertPreparedMatches(input: SigningRequestInput, payloads: UnsignedPayload[], address: string): void {
  switch (input.kind) {
    case "sign":
    case "dispatch": {
      const [payload] = payloads;
      if (payload?.kind === "dataItem") {
        checkDataItem(payload, { target: input.target ?? "", tags: plainTags(input.tags), data: input.payload });
      } else {
        checkTransaction(payload, {
          target: input.target ?? "",
          quantity: input.quantity ?? "0",
          tags: plainTags(input.tags),
          data: input.payload,
          reward: input.reward,
        });
      }
      return;
    }
    case "signDataItem":
    case "batchSignDataItem": {
      const items = input.kind === "signDataItem" ? (input.dataItems ?? []).slice(0, 1) : (input.dataItems ?? []);
      if (payloads.length !== items.length) mismatch("item count");
      items.forEach((item, index) =>
        checkDataItem(payloads[index], {
          target: item.target ?? "",
          tags: plainTags(item.tags),
          data: base64ToBytes(item.data),
          anchor: item.anchor ?? "",
        }),
      );
      return;
    }
    case "transferAoTokens":
    case "transfer":
      assertTransferMatches(
        {
          recipient: input.recipient ?? "",
          amount: input.amount ?? "",
          token: input.token ?? null,
          fee: input.fee ?? "",
          // Only a wallet `transfer` of a collectible is an L1 transaction
          // carrying the collectible tags. A `transferAoTokens` of one is
          // an AO data item, so its `collectible` is display-only: passing
          // it here would check the data item as an L1 transaction and
          // refuse every approved collectible AO transfer.
          collectible: input.kind === "transfer" ? input.collectible : undefined,
        },
        payloads[0],
      );
      return;
    case "setNameTarget": {
      const name = input.nameTarget;
      if (!name || payloads.length !== 1) mismatch("target");
      assertNameTargetMatches({ carrier: name.carrier, target: name.target, fee: input.fee ?? "" }, payloads[0]);
      return;
    }
    case "signMessage": {
      const [payload] = payloads;
      if (payloads.length !== 1 || payload?.kind !== "message") mismatch("message");
      if (bytesToBase64Url(payload.data) !== bytesToBase64Url(input.payload)) mismatch("message");
      return;
    }
    case "pointsProof":
    case "scanAttestation":
      checkTransaction(payloads[0], {
        target: address,
        quantity: "0",
        tags: [{ name: POINTS_PROOF_TAG, value: textDecoder.decode(input.payload) }],
        data: new Uint8Array(),
        reward: "0",
      });
      return;
    case "encrypt":
    case "decrypt":
      // Nothing is signed, so there are no prepared bytes to read back.
      return;
    default: {
      const unchecked: never = input.kind;
      throw new Error(dappError(`No prepared-bytes check for ${String(unchecked)}.`));
    }
  }
}

export function toWirePayload(payload: UnsignedPayload): DeviceSigningPayload {
  switch (payload.kind) {
    case "transaction":
      return { kind: "transaction", transaction: payload.transaction };
    case "dataItem":
      return { kind: "dataItem", raw: bytesToBase64Url(payload.raw) };
    case "message":
      return { kind: "message", data: bytesToBase64Url(payload.data) };
  }
}

export function transactionInputOf(input: SigningRequestInput): SignTransactionInput {
  return {
    data: bytesToBase64(input.payload),
    target: input.target,
    quantity: input.quantity,
    tags: input.tags,
    reward: input.reward,
    last_tx: input.last_tx,
  };
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
