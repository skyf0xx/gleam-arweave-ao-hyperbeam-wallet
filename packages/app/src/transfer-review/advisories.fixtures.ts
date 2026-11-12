import type { SigningApprovalPreview } from "@gleam/core";
import { COLLECTIBLE_TRANSFER_QUANTITY } from "@gleam/core/src/ao/collectible-transfer.ts";
import { readL1TokenTransfer } from "@gleam/core/src/ao/l1-transfer.ts";
import { readAoTransferMessage } from "@gleam/core/src/ao/transfer-message.ts";

/**
 * One signing preview per past advisory where a transaction shape the
 * transfer readers didn't model previewed as a clean transfer. Every
 * future advisory in this class adds its fixture here, and
 * `model.advisories.transfer-review.test.ts` runs it.
 *
 * Each preview is built the way the runtime builds it from what the page
 * sent (`requestTransactionApproval` in `runtime/src/handlers/provider.ts`,
 * `buildDataItemPreviews` in `runtime/src/handlers/approval.ts`), with the
 * reading taken from the real core readers, so a regression in a reader
 * changes the fixture's outcome.
 */

export const TOKEN = "t".repeat(43);
export const OTHER_TOKEN = "o".repeat(43);
export const RECIPIENT = "r".repeat(43);
export const DECOY = "d".repeat(43);
export const COLLECTIBLE = "c".repeat(43);

type Tag = { name: string; value: string };

interface TokenMetadata {
  tokenDenomination: number | null;
  tokenTicker: string | null;
  collectible?: boolean;
}

const UNRESOLVED: TokenMetadata = { tokenDenomination: null, tokenTicker: null };

/** A page's `sign`/`dispatch` of an L1 transaction, previewed as `requestTransactionApproval` does. */
function transactionPreview(
  kind: "sign" | "dispatch",
  transaction: { target?: string; quantity?: string; tags: Tag[] },
  metadata: TokenMetadata = UNRESOLVED,
): SigningApprovalPreview {
  const { target, tags } = transaction;
  const reading = target ? readL1TokenTransfer({ target, quantity: transaction.quantity ?? "0", data_size: "0", tags }) : null;
  const transfer = reading?.kind === "transfer" ? reading : null;
  const collectible =
    transfer && metadata.collectible && transfer.quantity === COLLECTIBLE_TRANSFER_QUANTITY ? { id: transfer.processId } : null;
  const headline =
    collectible && transfer
      ? { recipient: transfer.recipient, amount: transfer.quantity, token: collectible.id, tokenDenomination: null, tokenTicker: null, collectible }
      : transfer
        ? {
            recipient: transfer.recipient,
            amount: transfer.quantity,
            token: transfer.processId,
            tokenDenomination: metadata.tokenDenomination,
            tokenTicker: metadata.tokenTicker,
          }
        : {
            recipient: target ?? null,
            amount: target ? (transaction.quantity ?? "0") : null,
            token: null,
            tokenDenomination: null,
            tokenTicker: null,
            ...(reading ? { unreadableTokenTransfer: true } : {}),
          };
  return { kind, ...headline, fee: "1000", decodedData: null, tags, payloadHash: "h", items: null };
}

/** A page's `signDataItem`/`batchSignDataItem`, previewed as `buildDataItemPreviews` does. */
function dataItemPreview(
  kind: "signDataItem" | "batchSignDataItem",
  items: Array<{ target?: string; tags: Tag[]; metadata?: TokenMetadata }>,
): SigningApprovalPreview {
  const signed = kind === "signDataItem" ? items.slice(0, 1) : items;
  return {
    kind,
    recipient: null,
    amount: null,
    fee: null,
    token: null,
    tokenDenomination: null,
    tokenTicker: null,
    decodedData: null,
    tags: items[0]!.tags,
    payloadHash: "h",
    items: signed.map((item, index) => {
      const reading = readAoTransferMessage({ target: item.target, tags: item.tags });
      const metadata = item.metadata ?? UNRESOLVED;
      return {
        decodedData: null,
        tags: item.tags,
        target: item.target ?? null,
        payloadHash: `h${index}`,
        transfer:
          reading?.kind === "transfer"
            ? {
                token: reading.processId,
                recipient: reading.recipient,
                amount: reading.quantity,
                tokenDenomination: metadata.tokenDenomination,
                tokenTicker: metadata.tokenTicker,
                ...(metadata.collectible && reading.quantity === COLLECTIBLE_TRANSFER_QUANTITY
                  ? { collectible: { id: reading.processId } }
                  : {}),
              }
            : null,
        ...(reading?.kind === "unreadable" ? { unreadableTokenTransfer: true } : {}),
      };
    }),
  };
}

const AO_TRANSFER: Tag[] = [
  { name: "Data-Protocol", value: "ao" },
  { name: "Variant", value: "ao.TN.1" },
  { name: "Type", value: "Message" },
  { name: "Action", value: "Transfer" },
  { name: "Recipient", value: RECIPIENT },
  { name: "Quantity", value: "5000" },
];

/** The same AO `Transfer`, moving one whole collectible. */
const AO_COLLECTIBLE_TRANSFER: Tag[] = [
  { name: "Data-Protocol", value: "ao" },
  { name: "Variant", value: "ao.TN.1" },
  { name: "Type", value: "Message" },
  { name: "Action", value: "Transfer" },
  { name: "Recipient", value: RECIPIENT },
  { name: "Quantity", value: COLLECTIBLE_TRANSFER_QUANTITY },
];

/**
 * How a fixture must read. `unreadable`: null, or the request or an item
 * is flagged `unreadableTokenTransfer`. `otherTags`: a clean transfer
 * whose count includes `tag`. `exact`: the advisory was a headline that
 * misstated a clean transfer, so the fixed headline must name exactly
 * what the signed fields move.
 */
export type AdvisoryOutcome =
  | { kind: "unreadable" }
  | { kind: "otherTags"; tag: string }
  | { kind: "exact"; token: string | null; collectible?: boolean };

export interface AdvisoryFixture {
  advisory: string;
  shape: string;
  preview: SigningApprovalPreview;
  outcome: AdvisoryOutcome;
  /** The headline transfer's recipient and amount; `null` when the request keeps the generic screen. */
  headline: { recipient: string; amount: string } | null;
}

export const ADVISORY_FIXTURES: AdvisoryFixture[] = [
  {
    // v1.41.0 F-1 (GHSA-9h5g): the item's target was hidden, so a Transfer to any process read as a plain message.
    advisory: "v1.41.0 F-1",
    shape: "signDataItem whose hidden target is the token process",
    preview: dataItemPreview("signDataItem", [{ target: TOKEN, tags: AO_TRANSFER }]),
    outcome: { kind: "exact", token: TOKEN },
    headline: { recipient: RECIPIENT, amount: "5000" },
  },
  {
    // v1.41.0 F-2 (GHSA-29gg): the token's self-reported ticker and scale stood in for what was signed.
    advisory: "v1.41.0 F-2",
    shape: "AO transfer from a token that calls itself AR",
    preview: dataItemPreview("signDataItem", [
      { target: OTHER_TOKEN, tags: AO_TRANSFER, metadata: { tokenDenomination: 12, tokenTicker: "AR" } },
    ]),
    outcome: { kind: "exact", token: OTHER_TOKEN },
    headline: { recipient: RECIPIENT, amount: "5000" },
  },
  {
    // v1.41.0 F-6 (GHSA-74qh): a transaction with no recipient showed no fee.
    advisory: "v1.41.0 F-6",
    shape: "sign of a transaction with no target and transfer tags",
    preview: transactionPreview("sign", {
      tags: [
        { name: "action", value: "transfer" },
        { name: "recipient", value: RECIPIENT },
        { name: "quantity", value: "5000" },
      ],
    }),
    outcome: { kind: "unreadable" },
    headline: null,
  },
  {
    // v1.42.0 F-1 (GHSA-6584): an extra, reordered or recased tag hid an L1 transfer behind "0 AR to the token".
    advisory: "v1.42.0 F-1",
    shape: "L1 transfer with recased, reordered tags and an extra one",
    preview: transactionPreview("dispatch", {
      target: TOKEN,
      tags: [
        { name: "Quantity", value: "5000" },
        { name: "X-Forward-To", value: DECOY },
        { name: "RECIPIENT", value: RECIPIENT },
        { name: "Action", value: "Transfer" },
      ],
    }),
    outcome: { kind: "otherTags", tag: "X-Forward-To" },
    headline: { recipient: RECIPIENT, amount: "5000" },
  },
  {
    // v1.42.0 F-1 (GHSA-6584): the same advisory's duplicate-tag shape, where the token could act on either copy.
    advisory: "v1.42.0 F-1",
    shape: "L1 transfer with the recipient given twice in different cases",
    preview: transactionPreview("sign", {
      target: TOKEN,
      tags: [
        { name: "action", value: "transfer" },
        { name: "recipient", value: RECIPIENT },
        { name: "Recipient", value: DECOY },
        { name: "quantity", value: "5000" },
      ],
    }),
    outcome: { kind: "unreadable" },
    headline: { recipient: TOKEN, amount: "0" },
  },
  {
    // v1.42.0 F-5: a recased action=transfer that a HyperBEAM-hosted token reads previewed as a plain item.
    advisory: "v1.42.0 F-5",
    shape: "AO data item with a lowercase action=transfer",
    preview: dataItemPreview("signDataItem", [
      {
        target: TOKEN,
        tags: [
          { name: "action", value: "transfer" },
          { name: "recipient", value: RECIPIENT },
          { name: "quantity", value: "5000" },
        ],
      },
    ]),
    outcome: { kind: "unreadable" },
    headline: null,
  },
  {
    // v1.42.0 F-5: the same advisory's repeated-Action shape.
    advisory: "v1.42.0 F-5",
    shape: "AO data item with Action given twice",
    preview: dataItemPreview("signDataItem", [
      { target: TOKEN, tags: [...AO_TRANSFER, { name: "action", value: "Transfer" }] },
    ]),
    outcome: { kind: "unreadable" },
    headline: null,
  },
  {
    // v1.43.1 F-1 (GHSA-5vc6): Assign-To also ran the transfer on each named process, moving that token too.
    advisory: "v1.43.1 F-1",
    shape: "L1 transfer with an Assign-To tag",
    preview: transactionPreview("dispatch", {
      target: TOKEN,
      tags: [
        { name: "action", value: "transfer" },
        { name: "recipient", value: RECIPIENT },
        { name: "quantity", value: "5000" },
        { name: "Assign-To", value: OTHER_TOKEN },
      ],
    }),
    outcome: { kind: "unreadable" },
    headline: { recipient: TOKEN, amount: "0" },
  },
  {
    // v1.44.0 F-2 (GHSA-8w6v): a collectible's L1 transfer of 1 previewed as 1 raw unit of an unknown token.
    advisory: "v1.44.0 F-2",
    shape: "L1 transfer of 1 to a collectible",
    preview: transactionPreview(
      "sign",
      {
        target: COLLECTIBLE,
        tags: [
          { name: "action", value: "transfer" },
          { name: "recipient", value: RECIPIENT },
          { name: "quantity", value: COLLECTIBLE_TRANSFER_QUANTITY },
        ],
      },
      { tokenDenomination: null, tokenTicker: null, collectible: true },
    ),
    outcome: { kind: "exact", token: COLLECTIBLE, collectible: true },
    headline: { recipient: RECIPIENT, amount: "1" },
  },
  {
    // R2-W3-1 (GHSA-8w6v follow-up): a collectible's AO transfer of 1 via a data item previewed as 1 raw unit of an unknown token.
    advisory: "R2-W3-1",
    shape: "AO data item transferring 1 of a collectible",
    preview: dataItemPreview("signDataItem", [
      {
        target: COLLECTIBLE,
        tags: AO_COLLECTIBLE_TRANSFER,
        metadata: { tokenDenomination: null, tokenTicker: null, collectible: true },
      },
    ]),
    outcome: { kind: "exact", token: COLLECTIBLE, collectible: true },
    headline: { recipient: RECIPIENT, amount: "1" },
  },
  {
    // R2-W3-1 (GHSA-8w6v follow-up): the same framing on the `transferAoTokens` top-level branch.
    advisory: "R2-W3-1",
    shape: "transferAoTokens of 1 of a collectible",
    preview: {
      kind: "transferAoTokens",
      recipient: RECIPIENT,
      amount: COLLECTIBLE_TRANSFER_QUANTITY,
      fee: "1000",
      token: COLLECTIBLE,
      tokenDenomination: null,
      tokenTicker: null,
      collectible: { id: COLLECTIBLE },
      decodedData: null,
      tags: [],
      payloadHash: "h",
      items: null,
    },
    outcome: { kind: "exact", token: COLLECTIBLE, collectible: true },
    headline: { recipient: RECIPIENT, amount: "1" },
  },
  {
    // v1.44.0 F-3 (GHSA-hw6m): a batch's unreadable item carried no marker of its own.
    advisory: "v1.44.0 F-3",
    shape: "batch of a clean transfer and a recased one",
    preview: dataItemPreview("batchSignDataItem", [
      { target: TOKEN, tags: AO_TRANSFER },
      {
        target: OTHER_TOKEN,
        tags: [
          { name: "Action", value: "Transfer" },
          { name: "recipient", value: DECOY },
          { name: "Quantity", value: "9000" },
        ],
      },
    ]),
    outcome: { kind: "unreadable" },
    headline: { recipient: RECIPIENT, amount: "5000" },
  },
];
