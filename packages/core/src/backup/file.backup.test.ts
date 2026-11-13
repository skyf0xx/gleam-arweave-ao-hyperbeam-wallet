import { describe, expect, it } from "vitest";
import { backupPasskeysOf, decodeBackupFile, encodeBackupFile, type BackupHeader } from "./file";

const WRAPPED = {
  version: 2,
  algorithm: "AES-GCM",
  kdf: "Argon2id",
  memoryKiB: 64,
  iterations: 1,
  parallelism: 1,
  salt: "c2FsdA==",
  iv: "aXY=",
  ciphertext: "Y3Q=",
} as BackupHeader["wrapped"];

const HEADER: BackupHeader = { v: 1, backupId: "b".repeat(20), updatedAt: 5, writer: "w".repeat(20), wrapped: WRAPPED };
const PASSKEY = { credentialId: "cred", prfSalt: "salt", iv: "iv", ciphertext: "ct" };
const enrollment = (credentialId: string) => ({ version: 1, credentialId, prfSalt: "salt", iv: "iv", ciphertext: "ct", createdAt: 1 });

describe("backup header passkeys", () => {
  it("round-trip through the file, and are left out when there are none", () => {
    const withPasskeys = decodeBackupFile(encodeBackupFile({ header: { ...HEADER, passkeys: [PASSKEY] }, sealed: new Uint8Array([1]) }))!;
    expect(withPasskeys.header.passkeys).toEqual([PASSKEY]);
    const bytes = encodeBackupFile({ header: { ...HEADER, passkeys: [] }, sealed: new Uint8Array([1]) });
    expect(new TextDecoder().decode(bytes)).not.toContain("passkeys");
    expect(decodeBackupFile(bytes)!.header).toEqual(HEADER);
  });

  it("drop malformed entries and keep the file readable", () => {
    const parsed = JSON.parse(new TextDecoder().decode(encodeBackupFile({ header: HEADER, sealed: new Uint8Array([1]) }))) as Record<string, unknown>;
    parsed.passkeys = [PASSKEY, { credentialId: "" }, "junk", { ...PASSKEY, credentialId: "two", extra: "dropped" }];
    const file = decodeBackupFile(new TextEncoder().encode(JSON.stringify(parsed)))!;
    expect(file.header.passkeys).toEqual([PASSKEY, { ...PASSKEY, credentialId: "two" }]);

    parsed.passkeys = "not a list";
    expect(decodeBackupFile(new TextEncoder().encode(JSON.stringify(parsed)))!.header.passkeys).toBeUndefined();
  });

  it("come from each install's enrollment, newest install first and each credential once", () => {
    const passkeys = backupPasskeysOf({
      old: { updatedAt: 1, data: { "local:passkey": enrollment("a") } },
      none: { updatedAt: 3, data: {} },
      newest: { updatedAt: 4, data: { "local:passkey": enrollment("b") } },
      same: { updatedAt: 2, data: { "local:passkey": enrollment("b") } },
    });
    expect(passkeys.map(({ credentialId }) => credentialId)).toEqual(["b", "a"]);
    expect(passkeys[0]).toEqual({ credentialId: "b", prfSalt: "salt", iv: "iv", ciphertext: "ct" });
  });
});
