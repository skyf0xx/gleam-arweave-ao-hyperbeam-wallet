import { beforeAll, describe, expect, it } from "vitest";
import { signerFromJwk, generateJWK } from "../signer/keys";
import { signTransactionWithSigner } from "../arweave/transaction";
import { encodeTransactionForLedger } from "../hardware/ledger/serialize";
import type { JWKInterface } from "../models/wallet";
import { base64UrlToBytes, bytesToBase64Url } from "../vault/base64";
import { signMessage } from "../vault/message-signing";
import { buildOwnershipTransaction, hasPointsProofTag, verifyPointsProof } from "./ownership";

const MESSAGE = "gleam-points:leave:v1:someAddress:1700000000";

let jwk: JWKInterface;
let other: JWKInterface;
beforeAll(async () => {
  [jwk, other] = await Promise.all([generateJWK(), generateJWK()]);
}, 60_000);

describe("buildOwnershipTransaction", () => {
  it("builds the same 0-AR, 0-fee transaction from the message and owner alone", async () => {
    const tx = await buildOwnershipTransaction(jwk.n, MESSAGE);

    expect(await buildOwnershipTransaction(jwk.n, MESSAGE)).toEqual(tx);
    expect(tx).toMatchObject({ format: 2, owner: jwk.n, target: "", quantity: "0", reward: "0", data: "", data_size: "0" });
    expect(new TextDecoder().decode(base64UrlToBytes(tx.tags[0]!.value))).toBe(MESSAGE);
    expect(base64UrlToBytes(tx.last_tx).byteLength).toBe(32);
    expect((await buildOwnershipTransaction(jwk.n, `${MESSAGE}1`)).last_tx).not.toBe(tx.last_tx);
  });

  it("is a header a Ledger can take", async () => {
    const tx = await buildOwnershipTransaction(jwk.n, MESSAGE);
    expect(encodeTransactionForLedger(tx).byteLength).toBeGreaterThan(512);
  });
});

describe("verifyPointsProof", () => {
  it("accepts the owner's signature over the ownership transaction, for that message only", async () => {
    const signature = bytesToBase64Url(await signTransactionWithSigner(await buildOwnershipTransaction(jwk.n, MESSAGE), signerFromJwk(jwk, "")));

    expect(await verifyPointsProof("transaction", jwk.n, MESSAGE, signature)).toBe(true);
    expect(await verifyPointsProof("transaction", jwk.n, `${MESSAGE}1`, signature)).toBe(false);
    expect(await verifyPointsProof("transaction", other.n, MESSAGE, signature)).toBe(false);
    expect(await verifyPointsProof("message", jwk.n, MESSAGE, signature)).toBe(false);
  });

  it("accepts a signMessage signature as a message proof", async () => {
    const signature = bytesToBase64Url(
      new Uint8Array(await signMessage(signerFromJwk(jwk, ""), new TextEncoder().encode(MESSAGE).buffer as ArrayBuffer)),
    );

    expect(await verifyPointsProof("message", jwk.n, MESSAGE, signature)).toBe(true);
    expect(await verifyPointsProof("transaction", jwk.n, MESSAGE, signature)).toBe(false);
  });

  it("rejects garbage without throwing", async () => {
    expect(await verifyPointsProof("transaction", "not-a-key", MESSAGE, "AAAA")).toBe(false);
    expect(await verifyPointsProof("message", jwk.n, MESSAGE, "%%%")).toBe(false);
  });
});

describe("hasPointsProofTag", () => {
  it("finds the ownership transaction's own tag once decoded", async () => {
    const tx = await buildOwnershipTransaction(jwk.n, MESSAGE);
    const decoded = tx.tags.map((tag) => ({ name: new TextDecoder().decode(base64UrlToBytes(tag.name)) }));

    expect(hasPointsProofTag(decoded)).toBe(true);
  });

  it("ignores case and position among other tags", () => {
    expect(hasPointsProofTag([{ name: "App-Name" }, { name: "gleam-points" }])).toBe(true);
    expect(hasPointsProofTag([{ name: "GLEAM-POINTS" }])).toBe(true);
    expect(hasPointsProofTag([{ name: "\uFEFFGleam-Points" }, { name: " Gleam-Points\n" }])).toBe(true);
  });

  it("passes tags with other names", () => {
    expect(hasPointsProofTag([])).toBe(false);
    expect(hasPointsProofTag([{ name: "Gleam-Points-Extra" }, { name: "Gleam" }, { name: "Content-Type" }])).toBe(false);
  });
});
