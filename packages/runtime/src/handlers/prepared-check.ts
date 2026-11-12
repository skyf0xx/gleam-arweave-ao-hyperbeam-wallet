import {
  base64UrlToBytes,
  bytesToBase64Url,
  readDataItemFields,
  type CollectibleRef,
  type DeviceSigningSummary,
  type UnsignedPayload,
} from "@gleam/core";
import { collectibleTransferTags, readCollectibleTransfer, COLLECTIBLE_TRANSFER_QUANTITY } from "@gleam/core/src/ao/collectible-transfer.ts";
import { l1TransferTags, readL1TokenTransfer } from "@gleam/core/src/ao/l1-transfer.ts";
import { readAoTransferMessage } from "@gleam/core/src/ao/transfer-message.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { dappError } from "../dapp-error";

/*
 * Reads prepared bytes back against what the user approved, before any
 * signer runs. The approval window and the wallet's own keyfile sends
 * share these checks, so both sign only what the review showed.
 */

const textDecoder = new TextDecoder();

const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });

/** How much of a message the device step shows; the dApp's preview already showed it in full. */
const MESSAGE_TEXT_LIMIT = 500;

// Control characters other than tab/newline, and bidi overrides, can make
// shown text differ from the signed bytes, so such a message shows its size.
export const UNSAFE_TEXT = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

function messageText(data: Uint8Array): string | null {
  let text: string;
  try {
    text = strictTextDecoder.decode(data);
  } catch {
    return null;
  }
  if (text.length === 0 || UNSAFE_TEXT.test(text.replace(/[\t\n]/g, ""))) return null;
  return text.length > MESSAGE_TEXT_LIMIT ? `${text.slice(0, MESSAGE_TEXT_LIMIT)}…` : text;
}

export function decodeTransactionTag(tag: { name: string; value: string }): { name: string; value: string } {
  return { name: textDecoder.decode(base64UrlToBytes(tag.name)), value: textDecoder.decode(base64UrlToBytes(tag.value)) };
}

/**
 * `collectibleId` is the collectible the approved preview named, if any. A
 * transfer of 1 is shown as a collectible only for that asset: for a
 * fungible token it is 1 atomic unit, and the device step must read it the
 * way the first review did. That holds for a data item too: an AO Transfer
 * of 1 to the named asset summarizes as the collectible, with no AR fee.
 */
export function summarize(payload: UnsignedPayload, collectibleId?: string | null): DeviceSigningSummary {
  if (payload.kind === "message") {
    return { kind: "message", text: messageText(payload.data), size: payload.data.byteLength };
  }
  if (payload.kind === "transaction") {
    const { target, quantity, reward, data_size } = payload.transaction;
    const tags = payload.transaction.tags.map(decodeTransactionTag);
    const collectible = readCollectibleTransfer({ target, quantity, data_size, tags });
    if (collectible && collectible.assetId === collectibleId) {
      return { kind: "collectibleTransfer", asset: collectible.assetId, recipient: collectible.recipient, fee: reward };
    }
    const tokenTransfer = readL1TokenTransfer({ target, quantity, data_size, tags });
    if (tokenTransfer?.kind === "transfer") {
      return {
        kind: "l1TokenTransfer",
        process: tokenTransfer.processId,
        recipient: tokenTransfer.recipient,
        quantity: tokenTransfer.quantity,
        fee: reward,
      };
    }
    return {
      kind: "transaction",
      recipient: target || null,
      quantity,
      fee: reward,
      dataSize: data_size,
      ...(tokenTransfer ? { unreadableTokenTransfer: true } : {}),
    };
  }
  const { target, tags, data } = readDataItemFields(payload.raw);
  const transfer = readAoTransferMessage({ target, tags });
  if (transfer?.kind === "transfer") {
    if (transfer.quantity === COLLECTIBLE_TRANSFER_QUANTITY && transfer.processId === collectibleId) {
      return { kind: "collectibleTransfer", asset: transfer.processId, recipient: transfer.recipient, fee: "0" };
    }
    return { kind: "aoTransfer", process: transfer.processId, recipient: transfer.recipient, quantity: transfer.quantity };
  }
  return {
    kind: "dataItem",
    target: target || null,
    dataSize: data.byteLength,
    ...(transfer ? { unreadableTokenTransfer: true } : {}),
  };
}

function sameTags(actual: Array<{ name: string; value: string }>, expected: Array<{ name: string; value: string }>): boolean {
  return (
    actual.length === expected.length &&
    actual.every((tag, index) => tag.name === expected[index]!.name && tag.value === expected[index]!.value)
  );
}

function normalizedQuantity(quantity: string | undefined): string {
  const trimmed = quantity?.trim() ?? "";
  return trimmed === "" ? "0" : trimmed;
}

export function mismatch(field: string): never {
  throw new Error(userErrorMessage("approvalMismatch", { field }));
}

export interface ExpectedTransaction {
  target: string;
  quantity: string;
  tags: Array<{ name: string; value: string }>;
  data: Uint8Array;
  reward?: string;
}

export function checkTransaction(payload: UnsignedPayload | undefined, expected: ExpectedTransaction): void {
  const transaction = transactionOf(payload).transaction;
  if (transaction.target !== expected.target) mismatch("recipient");
  if (normalizedQuantity(transaction.quantity) !== normalizedQuantity(expected.quantity)) mismatch("amount");
  if (!sameTags(transaction.tags.map(decodeTransactionTag), expected.tags)) mismatch("tags");
  if (transaction.data !== bytesToBase64Url(expected.data)) mismatch("data");
  if (expected.reward !== undefined && transaction.reward !== expected.reward) mismatch("fee");
}

export interface ExpectedDataItem {
  target: string;
  tags: Array<{ name: string; value: string }>;
  data: Uint8Array;
  anchor?: string;
}

export function checkDataItem(payload: UnsignedPayload | undefined, expected: ExpectedDataItem): void {
  const fields = readDataItemFields(dataItemOf(payload));
  if (fields.target !== expected.target) mismatch("target");
  if (!sameTags(fields.tags, expected.tags)) mismatch("tags");
  if (bytesToBase64Url(fields.data) !== bytesToBase64Url(expected.data)) mismatch("data");
  if (expected.anchor !== undefined && fields.anchor !== expected.anchor) mismatch("anchor");
}

export function transactionOf(payload: UnsignedPayload | undefined): UnsignedPayload & { kind: "transaction" } {
  if (payload?.kind !== "transaction") throw new Error(dappError("Expected an unsigned transaction to finish."));
  return payload;
}

export function dataItemOf(payload: UnsignedPayload | undefined): Uint8Array {
  if (payload?.kind !== "dataItem") throw new Error(dappError("Expected an unsigned data item to finish."));
  return payload.raw;
}

/** The fields of a send the review showed: a dApp's `transfer` request or the wallet's own send. */
export interface ApprovedTransfer {
  recipient: string;
  amount: string;
  /** `null` for AR. */
  token: string | null;
  fee: string;
  collectible?: Pick<CollectibleRef, "id"> | null;
}

/** Throws `approvalMismatch` unless `payload` is exactly the send in `approved`. */
export function assertTransferMatches(approved: ApprovedTransfer, payload: UnsignedPayload | undefined): void {
  if (approved.collectible) {
    checkTransaction(payload, {
      target: approved.collectible.id,
      quantity: "0",
      tags: collectibleTransferTags(approved.recipient),
      data: new Uint8Array(),
      reward: approved.fee,
    });
    return;
  }
  if (approved.token === null) {
    checkTransaction(payload, {
      target: approved.recipient,
      quantity: approved.amount,
      tags: [],
      data: new Uint8Array(),
      reward: approved.fee,
    });
    return;
  }
  if (payload?.kind === "transaction") {
    // An arweave-scheduler token takes its transfer as an L1 transaction.
    checkTransaction(payload, {
      target: approved.token,
      quantity: "0",
      tags: l1TransferTags(approved.recipient, approved.amount),
      data: new Uint8Array(),
      reward: approved.fee,
    });
    return;
  }
  if (payload?.kind !== "dataItem") mismatch("AO transfer");
  const summary = summarize(payload);
  if (summary.kind !== "aoTransfer") mismatch("AO transfer");
  if (summary.process !== approved.token) mismatch("token");
  if (summary.recipient !== approved.recipient) mismatch("recipient");
  if (summary.quantity !== approved.amount) mismatch("amount");
}
