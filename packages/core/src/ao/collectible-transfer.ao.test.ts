import { afterEach, describe, expect, it, vi } from "vitest";
import { signerFromJwk } from "../vault/signer";
import Arweave from "arweave";
import { finishTransfer } from "../arweave/transfer";
import { signTransactionWithSigner } from "../arweave/transaction";
import { base64UrlToBytes } from "../vault/base64";
import {
  assertCoversNetworkFee,
  collectibleTransferTags,
  prepareCollectibleTransfer,
  readCollectibleTransfer,
} from "./collectible-transfer";

const jwk = await Arweave.init({}).wallets.generate();
const ASSET = "aSsEt_PrOcEsS-0123456789abcdefghijklmnopqrs";
const RECIPIENT = "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno";
const GATEWAY = "https://arweave.net";
const decoder = new TextDecoder();

afterEach(() => vi.restoreAllMocks());

function stubGateway() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("tx_anchor")) return new Response("b".repeat(64), { status: 200 });
    if (url.includes("price")) return new Response("654321", { status: 200 });
    return new Response("OK", { status: 200 });
  });
}

describe("prepareCollectibleTransfer", () => {
  it("builds a zero-AR, data-less L1 transaction to the asset with the lowercase transfer tags", async () => {
    const fetchSpy = stubGateway();

    const tx = await prepareCollectibleTransfer(GATEWAY, jwk.n, ASSET, RECIPIENT);

    expect(tx.format).toBe(2);
    expect(tx.target).toBe(ASSET);
    expect(tx.quantity).toBe("0");
    expect(tx.data).toBe("");
    expect(tx.data_size).toBe("0");
    expect(tx.reward).toBe("654321");
    expect(tx.tags.map((tag) => ({ name: decoder.decode(base64UrlToBytes(tag.name)), value: decoder.decode(base64UrlToBytes(tag.value)) }))).toEqual([
      { name: "action", value: "transfer" },
      { name: "recipient", value: RECIPIENT },
      { name: "quantity", value: "1" },
    ]);
    // Priced against the asset process, the transaction's real target.
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes(`/price/0/${ASSET}`))).toBe(true);
  });

  it("signs and posts the exact transaction it built", async () => {
    const fetchSpy = stubGateway();
    const unsigned = await prepareCollectibleTransfer(GATEWAY, jwk.n, ASSET, RECIPIENT);

    const { txId } = await finishTransfer(GATEWAY, unsigned, await signTransactionWithSigner(unsigned, signerFromJwk(jwk, "")), jwk.n);

    const post = fetchSpy.mock.calls.find(([input, init]) => String(input).endsWith("/tx") && init?.method === "POST");
    const posted = JSON.parse(String(post?.[1]?.body)) as Record<string, unknown>;
    expect(posted).toMatchObject({ id: txId, target: ASSET, quantity: "0", data: "", tags: unsigned.tags });
  });

  it("rejects a recipient that isn't an Arweave address before touching the network", async () => {
    const fetchSpy = stubGateway();
    await expect(prepareCollectibleTransfer(GATEWAY, jwk.n, ASSET, "not-an-address")).rejects.toThrow(/Arweave address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("readCollectibleTransfer", () => {
  const shape = { target: ASSET, quantity: "0", data_size: "0", tags: collectibleTransferTags(RECIPIENT) };

  it("reads the asset and recipient back from a collectible send", () => {
    expect(readCollectibleTransfer(shape)).toEqual({ assetId: ASSET, recipient: RECIPIENT });
  });

  it("ignores anything that moves AR, carries data or has other tags", () => {
    expect(readCollectibleTransfer({ ...shape, quantity: "5" })).toBeNull();
    expect(readCollectibleTransfer({ ...shape, data_size: "3" })).toBeNull();
    expect(readCollectibleTransfer({ ...shape, tags: [...shape.tags, { name: "x", value: "y" }] })).toBeNull();
    expect(readCollectibleTransfer({ ...shape, tags: [] })).toBeNull();
  });
});

describe("assertCoversNetworkFee", () => {
  it("passes when the balance covers the fee", () => {
    expect(() => assertCoversNetworkFee("654321", "654321")).not.toThrow();
  });

  it("names the fee in AR when the balance falls short", () => {
    expect(() => assertCoversNetworkFee("1", "654321")).toThrow("Sending needs about 0.000000654321 AR for the network fee.");
  });
});
