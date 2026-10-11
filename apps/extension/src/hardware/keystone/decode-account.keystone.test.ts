import { describe, expect, it } from "vitest";
import { ArweaveCryptoAccount } from "@keystonehq/bc-ur-registry-arweave";
import { UR, UREncoder } from "@ngraveio/bc-ur";
import { decodeKeystoneAccount, WrongKeystoneQrError } from "./decode-account";
import { UrAssembler } from "./ur-assembler";

const modulus = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7 + 3) % 256));
const xfp = "f23f9fd2";

function accountUr(): UR {
  return new ArweaveCryptoAccount(Buffer.from(xfp, "hex"), modulus, "Keystone 3 Pro").toUR();
}

describe("decodeKeystoneAccount", () => {
  it("returns the modulus as base64url and the fingerprint as hex", () => {
    const account = decodeKeystoneAccount(accountUr());
    expect(account.xfp).toBe(xfp);
    expect(account.publicKey).toBe(modulus.toString("base64url"));
    expect(account.publicKey).not.toMatch(/[+/=]/);
  });

  it("rejects other UR types", () => {
    const other = new UR(Buffer.from([0x01]), "arweave-signature");
    expect(() => decodeKeystoneAccount(other)).toThrow(WrongKeystoneQrError);
  });
});

describe("UrAssembler", () => {
  it("assembles an animated UR, reports progress and tolerates repeats and noise", () => {
    const encoder = new UREncoder(accountUr(), 100);
    expect(encoder.fragmentsLength).toBeGreaterThan(1);
    const assembler = new UrAssembler("arweave-crypto-account");

    expect(assembler.feed("https://example.com")).toEqual({ kind: "ignored" });

    let last = assembler.feed(encoder.nextPart().toUpperCase());
    expect(last.kind).toBe("progress");
    expect(assembler.feed(encoder.nextPart())).toMatchObject({ kind: "progress" });

    for (let i = 0; i < 100 && last.kind !== "complete"; i++) {
      last = assembler.feed(encoder.nextPart().toUpperCase());
    }
    expect(last.kind).toBe("complete");
    if (last.kind !== "complete") return;
    expect(decodeKeystoneAccount(last.ur).xfp).toBe(xfp);
  });

  it("completes from a single-frame UR", () => {
    const part = UREncoder.encodeSinglePart(accountUr());
    expect(new UrAssembler().feed(part).kind).toBe("complete");
  });

  it("throws on the first frame of an unexpected type", () => {
    const part = UREncoder.encodeSinglePart(new UR(Buffer.from([0x01]), "arweave-signature"));
    expect(() => new UrAssembler("arweave-crypto-account").feed(part)).toThrow(WrongKeystoneQrError);
  });
});
