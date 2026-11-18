import { describe, expect, it } from "vitest";
import { bytesToBase64Url } from "@gleam/core/src/vault/base64.ts";
import { buildUnsignedDataItem } from "@gleam/core/src/arweave/data-item.ts";
import { collectibleTransferTags } from "@gleam/core/src/ao/collectible-transfer.ts";
import { l1TransferTags } from "@gleam/core/src/ao/l1-transfer.ts";
import type { UnsignedPayload } from "@gleam/core/src/vault/signing.ts";
import { assertTransferMatches, checkDataItem, checkTransaction } from "./prepared-check";

/**
 * The check between what the user approved and what gets signed
 * (`assertTransferMatches`, `checkTransaction`, `checkDataItem`) is the
 * last place a prepared payload can diverge from the approval. These
 * tests pin its exact-match properties, including the L1 fee split: an
 * L1 token or collectible send carries 0 winston, or the 1-winston
 * activation a process with no AR needs, taken out of the approved fee.
 */

const PROCESS_ID = bytesToBase64Url(new Uint8Array(32).fill(1));
const RECIPIENT = bytesToBase64Url(new Uint8Array(32).fill(2));
const ATTACKER = bytesToBase64Url(new Uint8Array(32).fill(3));
const FEE = "1000";

const encoder = new TextEncoder();
const b64 = (text: string) => bytesToBase64Url(encoder.encode(text));
const b64bytes = (data: Uint8Array) => bytesToBase64Url(data);

function transactionPayload(overrides: {
  target: string;
  quantity: string;
  reward: string;
  tags: Array<{ name: string; value: string }>;
  data?: Uint8Array;
}): UnsignedPayload {
  const data = overrides.data ?? new Uint8Array();
  return {
    kind: "transaction",
    transaction: {
      format: 2,
      id: "",
      last_tx: "",
      owner: "",
      tags: overrides.tags.map((tag) => ({ name: b64(tag.name), value: b64(tag.value) })),
      target: overrides.target,
      quantity: overrides.quantity,
      data: b64bytes(data),
      data_size: String(data.byteLength),
      data_root: "",
      reward: overrides.reward,
      signature: "",
    },
  };
}

const owner = bytesToBase64Url(new Uint8Array(512));

function aoTransferItem(recipient: string, quantity: string): UnsignedPayload {
  return {
    kind: "dataItem",
    raw: buildUnsignedDataItem(owner, {
      data: encoder.encode(" "),
      target: PROCESS_ID,
      tags: [
        { name: "Data-Protocol", value: "ao" },
        { name: "Variant", value: "ao.TN.1" },
        { name: "Type", value: "Message" },
        { name: "Action", value: "Transfer" },
        { name: "Recipient", value: recipient },
        { name: "Quantity", value: quantity },
        { name: "Content-Type", value: "text/plain" },
      ],
    }),
  };
}

describe("assertTransferMatches: AR send", () => {
  const approved = { recipient: RECIPIENT, amount: "100", token: null, fee: "50" };
  const payload = () =>
    transactionPayload({ target: RECIPIENT, quantity: "100", reward: "50", tags: [] });

  it("accepts the exact send", () => {
    expect(() => assertTransferMatches(approved, payload())).not.toThrow();
  });

  it("refuses a higher fee", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: RECIPIENT, quantity: "100", reward: "51", tags: [] }),
      ),
    ).toThrow("doesn't match the request");
  });

  it("refuses a different amount", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: RECIPIENT, quantity: "101", reward: "50", tags: [] }),
      ),
    ).toThrow("doesn't match the request");
  });

  it("refuses a different recipient", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: ATTACKER, quantity: "100", reward: "50", tags: [] }),
      ),
    ).toThrow("doesn't match the request");
  });
});

describe("assertTransferMatches: L1 token send fee split", () => {
  const approved = { recipient: RECIPIENT, amount: "500", token: PROCESS_ID, fee: FEE };
  const tags = l1TransferTags(RECIPIENT, "500");

  it("accepts the activation winston taken out of the approved fee", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: PROCESS_ID, quantity: "1", reward: "999", tags }),
      ),
    ).not.toThrow();
  });

  it("accepts a zero-AR transfer with the whole fee as the reward", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: PROCESS_ID, quantity: "0", reward: FEE, tags }),
      ),
    ).not.toThrow();
  });

  it("refuses a second winston of AR to the process", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: PROCESS_ID, quantity: "2", reward: "998", tags }),
      ),
    ).toThrow("doesn't match the request");
  });

  it("refuses the activation winston on top of the full fee", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: PROCESS_ID, quantity: "1", reward: FEE, tags }),
      ),
    ).toThrow("doesn't match the request");
  });

  it("refuses the transfer tags pointing at someone else", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({
          target: PROCESS_ID,
          quantity: "1",
          reward: "999",
          tags: l1TransferTags(ATTACKER, "500"),
        }),
      ),
    ).toThrow("doesn't match the request");
  });
});

describe("assertTransferMatches: collectible send fee split", () => {
  const approved = {
    recipient: RECIPIENT,
    amount: "0",
    token: null,
    fee: FEE,
    collectible: { id: PROCESS_ID },
  };
  const tags = collectibleTransferTags(RECIPIENT);

  it("accepts the activation winston taken out of the approved fee", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: PROCESS_ID, quantity: "1", reward: "999", tags }),
      ),
    ).not.toThrow();
  });

  it("refuses a second winston of AR to the asset process", () => {
    expect(() =>
      assertTransferMatches(
        approved,
        transactionPayload({ target: PROCESS_ID, quantity: "2", reward: "998", tags }),
      ),
    ).toThrow("doesn't match the request");
  });
});

describe("assertTransferMatches: AO data-item transfer", () => {
  const approved = { recipient: RECIPIENT, amount: "500", token: PROCESS_ID, fee: "" };

  it("accepts the exact AO transfer", () => {
    expect(() => assertTransferMatches(approved, aoTransferItem(RECIPIENT, "500"))).not.toThrow();
  });

  it("refuses a different recipient or amount", () => {
    expect(() => assertTransferMatches(approved, aoTransferItem(ATTACKER, "500"))).toThrow(
      "doesn't match the request",
    );
    expect(() => assertTransferMatches(approved, aoTransferItem(RECIPIENT, "501"))).toThrow(
      "doesn't match the request",
    );
  });
});

describe("checkTransaction", () => {
  const expected = {
    target: RECIPIENT,
    quantity: "100",
    tags: [
      { name: "action", value: "transfer" },
      { name: "recipient", value: RECIPIENT },
    ],
    data: new Uint8Array(),
    reward: "50",
  };

  it("accepts the exact transaction", () => {
    expect(() =>
      checkTransaction(
        transactionPayload({ target: RECIPIENT, quantity: "100", reward: "50", tags: expected.tags }),
        expected,
      ),
    ).not.toThrow();
  });

  it("refuses the same tags in a different order", () => {
    expect(() =>
      checkTransaction(
        transactionPayload({
          target: RECIPIENT,
          quantity: "100",
          reward: "50",
          tags: [...expected.tags].reverse(),
        }),
        expected,
      ),
    ).toThrow("doesn't match the request");
  });

  it("refuses an extra tag", () => {
    expect(() =>
      checkTransaction(
        transactionPayload({
          target: RECIPIENT,
          quantity: "100",
          reward: "50",
          tags: [...expected.tags, { name: "X-Extra", value: "1" }],
        }),
        expected,
      ),
    ).toThrow("doesn't match the request");
  });
});

describe("checkDataItem", () => {
  const anchor = "a".repeat(32);
  const expected = {
    target: PROCESS_ID,
    tags: [{ name: "Action", value: "Transfer" }],
    data: encoder.encode("hello"),
    anchor,
  };
  const raw = () =>
    buildUnsignedDataItem(owner, {
      data: expected.data,
      target: expected.target,
      tags: expected.tags,
      anchor: expected.anchor,
    });

  it("accepts the exact item", () => {
    expect(() => checkDataItem({ kind: "dataItem", raw: raw() }, expected)).not.toThrow();
  });

  it("refuses a different anchor", () => {
    expect(() =>
      checkDataItem(
        {
          kind: "dataItem",
          raw: buildUnsignedDataItem(owner, {
            data: expected.data,
            target: expected.target,
            tags: expected.tags,
            anchor: "b".repeat(32),
          }),
        },
        expected,
      ),
    ).toThrow("doesn't match the request");
  });

  it("refuses different data", () => {
    expect(() =>
      checkDataItem(
        {
          kind: "dataItem",
          raw: buildUnsignedDataItem(owner, {
            data: encoder.encode("goodbye"),
            target: expected.target,
            tags: expected.tags,
            anchor: expected.anchor,
          }),
        },
        expected,
      ),
    ).toThrow("doesn't match the request");
  });
});
