import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { DataItem } from "@dha-team/arbundles";
import { generateJWK } from "../keys/jwk";
import type { JWKInterface } from "../models/wallet";
import { AO_LEGACY_MU_URL, AO_TRANSFER_HAS_NO_FEE, createSignedDataItem, submitTransfer } from "./transfer";

const PROCESS_ID = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";
const RECIPIENT = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";

let jwk: JWKInterface;

beforeAll(async () => {
  jwk = await generateJWK();
}, 20_000);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubMu(response: Response = new Response("{}", { status: 200 })) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function postedItem(fetchMock: ReturnType<typeof stubMu>): DataItem {
  const [, init] = fetchMock.mock.calls[0]!;
  return new DataItem(Buffer.from(init!.body as Uint8Array));
}

describe("createSignedDataItem", () => {
  it("produces an ANS-104 item that arbundles independently verifies, with the id derived from its signature", async () => {
    const { id, raw } = await createSignedDataItem(jwk, {
      data: new TextEncoder().encode("hello"),
      target: PROCESS_ID,
      tags: [{ name: "Action", value: "Transfer" }],
    });

    const item = new DataItem(Buffer.from(raw));
    expect(await DataItem.verify(Buffer.from(raw))).toBe(true);
    expect(item.id).toBe(id);
    expect(item.owner).toBe(jwk.n);
    expect(item.target).toBe(PROCESS_ID);
    expect(item.tags).toEqual([{ name: "Action", value: "Transfer" }]);
    expect(Buffer.from(item.rawData).toString()).toBe("hello");
  });

  it("rejects a target that isn't a 32-byte Arweave id", async () => {
    await expect(
      createSignedDataItem(jwk, { data: new Uint8Array([1]), target: "not-an-id", tags: [] }),
    ).rejects.toThrow(/32-byte Arweave id/);
  });
});

describe("AO submitTransfer", () => {
  it("posts the signed item as octet-stream to the legacynet MU", async () => {
    const fetchMock = stubMu();
    await submitTransfer(jwk, PROCESS_ID, RECIPIENT, "1000000000000");

    expect(fetchMock).toHaveBeenCalledWith(
      AO_LEGACY_MU_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/octet-stream" }),
      }),
    );
    expect(await DataItem.verify(postedItem(fetchMock).getRaw())).toBe(true);
  }, 20_000);

  it("sends an ao.TN.1 Transfer message targeting the process, with capitalized tags", async () => {
    const fetchMock = stubMu();
    await submitTransfer(jwk, PROCESS_ID, RECIPIENT, "42");

    const item = postedItem(fetchMock);
    expect(item.target).toBe(PROCESS_ID);
    expect(item.tags).toEqual([
      { name: "Data-Protocol", value: "ao" },
      { name: "Variant", value: "ao.TN.1" },
      { name: "Type", value: "Message" },
      { name: "Action", value: "Transfer" },
      { name: "Recipient", value: RECIPIENT },
      { name: "Quantity", value: "42" },
      { name: "Content-Type", value: "text/plain" },
    ]);
  });

  it("returns the posted data item's id as the messageId", async () => {
    const fetchMock = stubMu();
    const result = await submitTransfer(jwk, PROCESS_ID, RECIPIENT, "42");
    expect(result).toEqual({ messageId: postedItem(fetchMock).id });
  });

  it("preserves large atomic-integer amounts exactly as strings, never floats", async () => {
    const fetchMock = stubMu();
    const huge = "90071992547409930000";
    await submitTransfer(jwk, PROCESS_ID, RECIPIENT, huge);

    const quantityTag = postedItem(fetchMock).tags.find((tag) => tag.name === "Quantity");
    expect(quantityTag?.value).toBe(huge);
  });

  it("throws with the MU's status and body when it rejects the message", async () => {
    stubMu(new Response("bad item", { status: 400 }));
    await expect(submitTransfer(jwk, PROCESS_ID, RECIPIENT, "1")).rejects.toThrow(/failed \(400\): bad item/);
  });

  it("propagates a network failure reaching the MU", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network error"));
    await expect(submitTransfer(jwk, PROCESS_ID, RECIPIENT, "1")).rejects.toThrow(/network error/);
  });
});

describe("AO_TRANSFER_HAS_NO_FEE", () => {
  it("is explicit that AO transfers have no sender-side fee quote, unlike AR", () => {
    expect(AO_TRANSFER_HAS_NO_FEE).toBe(true);
  });
});
