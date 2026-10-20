import { describe, expect, it, beforeEach, vi } from "vitest";
import { signerFromJwk, generateJWK } from "../signer/keys";
import Arweave from "arweave";
import { DataItem } from "@dha-team/arbundles/web";
import {
  signTransaction,
  dispatchTransaction,
  signDataItem,
  batchSignDataItem,
  prepareSignTransaction,
  finishSignTransaction,
  prepareDispatch,
  finishDispatch,
  prepareDataItem,
  finishDataItem,
  prepareDataItems,
  finishDataItems,
  applySignature,
  verifyDeviceSignature,
  type UnsignedPayload,
} from "./signing";
import { signRsaPss } from "../arweave/rsa-pss";
import { transactionSignatureData } from "../arweave/transaction";
import { dataItemSignatureData } from "../arweave/data-item";
import { bytesToBase64 } from "./base64";
import type { JWKInterface } from "../models/wallet";

/**
 * Checks the signature over arbundles' own parse and deep hash. Not
 * `DataItem.verify`: the web build passes the owner's raw bytes to
 * WebCrypto as the JWK `n` (see `core/ao/transfer.ts`).
 */
async function verifies(item: DataItem): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", e: "AQAB", n: item.owner },
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "RSA-PSS", saltLength: 32 },
    key,
    new Uint8Array(item.rawSignature),
    new Uint8Array(await item.getSignatureData()),
  );
}

describe("vault/signing", () => {
  let jwk: JWKInterface;

  beforeEach(async () => {
    jwk = await generateJWK();
    vi.restoreAllMocks();
  });

  describe("signTransaction", () => {
    const arweave = Arweave.init({ host: "arweave.net", port: 443, protocol: "https" });
    const target = "a".repeat(43);
    const lastTx = "b".repeat(64);

    it("signs the dApp's own fields without asking the gateway for defaults", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const result = await signTransaction("https://arweave.net", signerFromJwk(jwk, ""), {
        data: bytesToBase64(new TextEncoder().encode("hello")),
        target,
        quantity: "1000",
        reward: "5000",
        last_tx: lastTx,
        tags: [{ name: "App-Name", value: "Gleam" }],
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        format: 2,
        owner: jwk.n,
        target,
        quantity: "1000",
        reward: "5000",
        last_tx: lastTx,
        data_size: "5",
        // base64url, the way arweave-js stores tags
        tags: [{ name: "QXBwLU5hbWU", value: "R2xlYW0" }],
      });
      expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.data_root).toBeTruthy();
      expect(result.data).toBe("aGVsbG8");
    });

    it("returns an empty data field for a data-less transfer, so the result posts to /tx as-is", async () => {
      const result = await signTransaction("https://arweave.net", signerFromJwk(jwk, ""), {
        target,
        quantity: "1000",
        reward: "5000",
        last_tx: lastTx,
      });

      expect(result).toMatchObject({ data: "", data_size: "0", data_root: "" });
    });

    it("fetches last_tx and reward from the gateway when the dApp leaves them out", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
        return new Response(url.includes("tx_anchor") ? lastTx : "777", { status: 200 });
      });

      const result = await signTransaction("https://arweave.net", signerFromJwk(jwk, ""), {
        data: bytesToBase64(new TextEncoder().encode("hello")),
      });

      expect(result.last_tx).toBe(lastTx);
      expect(result.reward).toBe("777");
    });

    it("returns what arweave-js's use_wallet sign needs to produce a verifiable transaction", async () => {
      // What a dApp builds before calling arweave.transactions.sign(tx).
      const dappTx = await arweave.createTransaction({
        // Uint8Array.from: jsdom's TextEncoder returns another realm's array.
        data: Uint8Array.from(new TextEncoder().encode("hello from a dApp")),
        target,
        quantity: "42",
        reward: "5000",
        last_tx: lastTx,
      });
      dappTx.addTag("Content-Type", "text/plain");
      dappTx.addTag("App-Name", "Gleam ✓");

      const signed = await signTransaction("https://arweave.net", signerFromJwk(jwk, ""), {
        data: bytesToBase64(dappTx.data),
        target: dappTx.target,
        quantity: dappTx.quantity,
        reward: dappTx.reward,
        last_tx: dappTx.last_tx,
        tags: [
          { name: "Content-Type", value: "text/plain" },
          { name: "App-Name", value: "Gleam ✓" },
        ],
      });

      // arweave-js's external-wallet branch of transactions.sign.
      dappTx.setSignature({
        id: signed.id,
        owner: signed.owner,
        reward: signed.reward,
        signature: signed.signature,
      });
      expect(signed.tags).toEqual(dappTx.tags.map((tag) => ({ name: tag.name, value: tag.value })));
      expect(signed.data_root).toBe(dappTx.data_root);
      await expect(arweave.transactions.verify(dappTx)).resolves.toBe(true);
    });
  });

  describe("dispatchTransaction", () => {
    const BUNDLER = "https://up.arweave.net";
    const VIA_BUNDLER = { viaBundler: true };

    /**
     * arweave-js's `createTransaction`/`transactions.post` call the
     * gateway's `tx_anchor`/`price`/`tx` endpoints directly via ambient
     * `fetch` (no injection point — see `transfer.ts`'s own doc comment
     * for why this codebase mocks `globalThis.fetch` rather than passing
     * a parameter). This stub answers each endpoint generically by path.
     */
    function mockGatewayFetch(postStatus: number, postStatusText = "OK") {
      return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
        if (url.includes("tx_anchor")) {
          return new Response("0".repeat(64), { status: 200 });
        }
        if (url.includes("price")) {
          return new Response("100", { status: 200 });
        }
        return new Response(null, { status: postStatus, statusText: postStatusText });
      });
    }

    it("posts small payloads as a BASE transaction", async () => {
      const fetchSpy = mockGatewayFetch(200);

      const result = await dispatchTransaction("https://arweave.net", BUNDLER, signerFromJwk(jwk, ""), {
        data: bytesToBase64(new TextEncoder().encode("small payload")),
      }, VIA_BUNDLER);

      expect(result.type).toBe("BASE");
      expect(result.id).toBeTruthy();
      expect(fetchSpy).toHaveBeenCalled();
    });

    it("posts large payloads to the bundler as a signed BUNDLED data item", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
      const largeData = new Uint8Array(150 * 1024).fill(1);
      const target = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";

      const result = await dispatchTransaction("https://arweave.net", BUNDLER, signerFromJwk(jwk, ""), {
        data: bytesToBase64(largeData),
        target,
        tags: [{ name: "Content-Type", value: "application/octet-stream" }],
      }, VIA_BUNDLER);

      expect(result.type).toBe("BUNDLED");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe("https://up.arweave.net/tx");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/octet-stream");

      const item = new DataItem(Buffer.from(init?.body as Uint8Array));
      expect(item.id).toBe(result.id);
      expect(await verifies(item)).toBe(true);
      expect(item.owner).toBe(jwk.n);
      expect(item.target).toBe(target);
      expect(item.tags).toEqual([{ name: "Content-Type", value: "application/octet-stream" }]);
      expect(Buffer.from(item.rawData).equals(Buffer.from(largeData))).toBe(true);
    });

    it("posts a large payload that sends AR to the gateway as a BASE transaction", async () => {
      const fetchSpy = mockGatewayFetch(200);
      const target = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";

      const result = await dispatchTransaction("https://arweave.net", BUNDLER, signerFromJwk(jwk, ""), {
        data: bytesToBase64(new Uint8Array(150 * 1024).fill(1)),
        target,
        quantity: "1000",
      }, VIA_BUNDLER);

      expect(result.type).toBe("BASE");
      const urls = fetchSpy.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.startsWith(BUNDLER))).toBe(false);
      const posted = fetchSpy.mock.calls.find(
        ([url, init]) => new URL(String(url)).pathname === "/tx" && init?.method === "POST",
      );
      expect(posted).toBeDefined();
      const body = JSON.parse(String(posted![1]!.body)) as { id: string; quantity: string; target: string };
      expect(body).toMatchObject({ id: result.id, quantity: "1000", target });
    });

    it.each(["0", "", "000"])("still bundles a large payload whose quantity is %j", async (quantity) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

      const result = await dispatchTransaction("https://arweave.net", BUNDLER, signerFromJwk(jwk, ""), {
        data: bytesToBase64(new Uint8Array(150 * 1024).fill(1)),
        quantity,
      }, VIA_BUNDLER);

      expect(result.type).toBe("BUNDLED");
      expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://up.arweave.net/tx");
    });

    it("posts a large payload to the gateway when the wallet can't dispatch via a bundler", async () => {
      const fetchSpy = mockGatewayFetch(200);

      const result = await dispatchTransaction(
        "https://arweave.net",
        BUNDLER,
        signerFromJwk(jwk, ""),
        { data: bytesToBase64(new Uint8Array(150 * 1024).fill(1)) },
        { viaBundler: false },
      );

      expect(result.type).toBe("BASE");
      expect(fetchSpy.mock.calls.some(([url]) => String(url).startsWith(BUNDLER))).toBe(false);
    });

    it("throws when the bundler rejects a large payload", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 402, statusText: "Payment Required" }),
      );

      await expect(
        dispatchTransaction("https://arweave.net", BUNDLER, signerFromJwk(jwk, ""), {
          data: bytesToBase64(new Uint8Array(150 * 1024).fill(1)),
        }, VIA_BUNDLER),
      ).rejects.toThrow(/bundler https:\/\/up\.arweave\.net.*HTTP 402/);
    });

    it("throws when the bundler can't be reached", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        dispatchTransaction("https://arweave.net", BUNDLER, signerFromJwk(jwk, ""), {
          data: bytesToBase64(new Uint8Array(150 * 1024).fill(1)),
        }, VIA_BUNDLER),
      ).rejects.toThrow(/Failed to fetch/);
    });

    it("throws when the gateway rejects the posted transaction", async () => {
      mockGatewayFetch(500, "Internal Server Error");

      await expect(
        dispatchTransaction("https://arweave.net", BUNDLER, signerFromJwk(jwk, ""), {
          data: bytesToBase64(new TextEncoder().encode("x")),
        }, VIA_BUNDLER),
      ).rejects.toThrow(/Failed to dispatch transaction/);
    });
  });

  describe("signDataItem", () => {
    const target = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";
    const anchor = "a".repeat(32);

    it("returns raw item bytes that arbundles parses and whose signature verifies", async () => {
      const raw = await signDataItem(signerFromJwk(jwk, ""), {
        data: bytesToBase64(new TextEncoder().encode("data item payload")),
        tags: [{ name: "Content-Type", value: "text/plain" }],
        target,
        anchor,
      });

      expect(raw).toBeInstanceOf(Uint8Array);
      const item = new DataItem(Buffer.from(raw));
      expect(await verifies(item)).toBe(true);
      expect(item.owner).toBe(jwk.n);
      expect(item.target).toBe(target);
      expect(Buffer.from(item.rawAnchor).toString()).toBe(anchor);
      expect(item.tags).toEqual([{ name: "Content-Type", value: "text/plain" }]);
      expect(Buffer.from(item.rawData).toString()).toBe("data item payload");
    });

    it("fails verification once the data is tampered with", async () => {
      const raw = await signDataItem(signerFromJwk(jwk, ""), { data: bytesToBase64(new TextEncoder().encode("hello")) });
      raw[raw.byteLength - 1]! ^= 1;
      expect(await verifies(new DataItem(Buffer.from(raw)))).toBe(false);
    });
  });

  describe("batchSignDataItem", () => {
    it("signs each item in order, each one verifying on its own", async () => {
      const payloads = ["item 1", "item 2", "item 3"];
      const results = await batchSignDataItem(
        signerFromJwk(jwk, ""),
        payloads.map((text) => ({ data: bytesToBase64(new TextEncoder().encode(text)) })),
      );

      expect(results).toHaveLength(3);
      for (const [index, raw] of results.entries()) {
        const item = new DataItem(Buffer.from(raw));
        expect(Buffer.from(item.rawData).toString()).toBe(payloads[index]);
        expect(await verifies(item)).toBe(true);
      }
    });

    it("returns an empty array for an empty input list", async () => {
      const results = await batchSignDataItem(signerFromJwk(jwk, ""), []);
      expect(results).toEqual([]);
    });
  });

  /**
   * What the approval window will do for a hardware wallet: build from
   * the stored owner, have the device sign the deep hash, then finish.
   * The device is played by a key the pipeline never sees.
   */
  describe("device signing pipeline", () => {
    async function deviceSign(unsigned: UnsignedPayload, key: JWKInterface) {
      if (unsigned.kind === "message") throw new Error("Not a deep-hash payload.");
      const message =
        unsigned.kind === "transaction"
          ? await transactionSignatureData(unsigned.transaction)
          : await dataItemSignatureData(unsigned.raw);
      return signRsaPss(signerFromJwk(key, ""), message);
    }

    it("sign: finishes a transaction arweave-js verifies", async () => {
      const arweave = Arweave.init({ host: "arweave.net", port: 443, protocol: "https" });
      const unsigned = await prepareSignTransaction("https://arweave.net", jwk.n, {
        data: bytesToBase64(new TextEncoder().encode("hello")),
        reward: "1",
        last_tx: "b".repeat(64),
      });
      const signed = await finishSignTransaction(unsigned, await deviceSign({ kind: "transaction", transaction: unsigned }, jwk), jwk.n);

      const transaction = arweave.transactions.fromRaw({ ...signed, data: unsigned.data });
      await expect(arweave.transactions.verify(transaction)).resolves.toBe(true);
    });

    it("dispatch: bundles a large payload and posts the device-signed item", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
      const plan = await prepareDispatch(
        "https://arweave.net",
        jwk.n,
        { data: bytesToBase64(new Uint8Array(150 * 1024).fill(2)) },
        { viaBundler: true },
      );
      expect(plan.kind).toBe("dataItem");

      const result = await finishDispatch("https://arweave.net", "https://up.arweave.net", plan, await deviceSign(plan, jwk), jwk.n);

      const item = new DataItem(Buffer.from(fetchSpy.mock.calls[0]![1]!.body as Uint8Array));
      expect(result).toEqual({ id: item.id, type: "BUNDLED" });
      expect(await verifies(item)).toBe(true);
    });

    it("dispatch: plans an L1 transaction when the wallet can't use a bundler", async () => {
      const plan = await prepareDispatch(
        "https://arweave.net",
        jwk.n,
        { data: bytesToBase64(new Uint8Array(150 * 1024).fill(2)), reward: "1", last_tx: "b".repeat(64) },
        { viaBundler: false },
      );
      expect(plan.kind).toBe("transaction");
    });

    it("signDataItem and batchSignDataItem: finish items arbundles parses and verifies", async () => {
      const one = prepareDataItem(jwk.n, { data: bytesToBase64(new TextEncoder().encode("one")), target: "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI" });
      const raw = await finishDataItem(one, await deviceSign({ kind: "dataItem", raw: one }, jwk), jwk.n);
      expect(await verifies(new DataItem(Buffer.from(raw)))).toBe(true);

      const batch = prepareDataItems(jwk.n, [{ data: bytesToBase64(new Uint8Array([1])) }, { data: bytesToBase64(new Uint8Array([2])) }]);
      const signatures = await Promise.all(batch.map((item) => deviceSign({ kind: "dataItem", raw: item }, jwk)));
      const signed = await finishDataItems(batch, signatures, jwk.n);
      for (const item of signed) expect(await verifies(new DataItem(Buffer.from(item)))).toBe(true);

      await expect(finishDataItems(batch, [...signatures].reverse(), jwk.n)).rejects.toThrow(/doesn't match/);
      await expect(finishDataItems(batch, signatures.slice(1), jwk.n)).rejects.toThrow(/Expected 2 signatures/);
    });

    it("verifyDeviceSignature checks the stored owner, and applySignature refuses a mismatched signature", async () => {
      const other = await generateJWK();
      const unsigned: UnsignedPayload = { kind: "dataItem", raw: prepareDataItem(jwk.n, { data: bytesToBase64(new Uint8Array([1])) }) };
      const signature = await deviceSign(unsigned, jwk);

      expect(await verifyDeviceSignature(unsigned, signature, jwk.n)).toBe(true);
      expect(await verifyDeviceSignature(unsigned, signature, other.n)).toBe(false);
      await expect(applySignature(unsigned, await deviceSign(unsigned, other), jwk.n)).rejects.toThrow(/doesn't match/);

      // Built for B and signed by B: valid on its own, refused when finishing for A.
      const forB = prepareDataItem(other.n, { data: bytesToBase64(new Uint8Array([1])) });
      const signedByB = await deviceSign({ kind: "dataItem", raw: forB }, other);
      await expect(finishDataItem(forB, signedByB, jwk.n)).rejects.toThrow(/doesn't match/);
      await expect(finishDataItems([forB], [signedByB], jwk.n)).rejects.toThrow(/doesn't match/);
      const txForB = await prepareSignTransaction("https://arweave.net", other.n, { data: "AQ==", reward: "1", last_tx: "b".repeat(64) });
      const txSignedByB = await deviceSign({ kind: "transaction", transaction: txForB }, other);
      await expect(finishSignTransaction(txForB, txSignedByB, jwk.n)).rejects.toThrow(/doesn't match/);
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await expect(
        finishDispatch("https://arweave.net", "https://up.arweave.net", { kind: "transaction", transaction: txForB }, txSignedByB, jwk.n),
      ).rejects.toThrow(/doesn't match/);
      expect(fetchSpy).not.toHaveBeenCalled();
    }, 20_000);
  });
});
