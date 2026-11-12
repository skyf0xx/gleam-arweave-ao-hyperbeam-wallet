import { describe, expect, it } from "vitest";
import {
  decodeBackupBody,
  decodeBackupFile,
  encodeBackupBody,
  encodeBackupFile,
  isValidBackupHeader,
  newBackupId,
  type BackupBody,
  type BackupHeader,
} from "../backup/file";
import type { Argon2idParams } from "../models/wallet";
import { importBackupKey, mintBackupKey, openBackup, sealBackup, unwrapBackupKey, wrapBackupKey } from "./backup-key";
import { VaultKdfError, encryptToEnvelope } from "./envelope";

const PASSWORD = "correct horse battery staple 42";
const PARAMS: Argon2idParams = { memoryKiB: 64, iterations: 1, parallelism: 1 };

async function setUp() {
  const backupId = newBackupId();
  const raw = mintBackupKey();
  const key = await importBackupKey(raw);
  const expected = raw.slice();
  const wrapped = await wrapBackupKey(raw, PASSWORD, backupId, { params: PARAMS });
  return { backupId, raw, key, expected, wrapped };
}

function bodyFor(backupId: string): BackupBody {
  return {
    v: 1,
    backupId,
    updatedAt: 1_700_000_000_000,
    writer: newBackupId(),
    data: { "local:themeSettings": { theme: "dark" } },
  };
}

describe("backup key", () => {
  it("wraps under the password and unwraps to the same key", async () => {
    const { backupId, expected, wrapped } = await setUp();
    expect(await unwrapBackupKey(wrapped, PASSWORD, backupId)).toEqual(expected);
  });

  it("zeroizes the raw key once it is wrapped", async () => {
    const { raw } = await setUp();
    expect(raw.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a wrong password with a plain error, before any body is decrypted", async () => {
    const { backupId, wrapped } = await setUp();
    const failure = await unwrapBackupKey(wrapped, "not the password 99", backupId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(VaultKdfError);
  });

  it("refuses a key wrapped for another backup", async () => {
    const { wrapped } = await setUp();
    await expect(unwrapBackupKey(wrapped, PASSWORD, newBackupId())).rejects.toThrow();
  });

  it("refuses a wallet's envelope offered as a backup key", async () => {
    const backupId = newBackupId();
    const notAKey = await encryptToEnvelope(new Uint8Array(48), PASSWORD, "backup", backupId, { params: PARAMS });
    await expect(unwrapBackupKey(notAKey, PASSWORD, backupId)).rejects.toBeInstanceOf(VaultKdfError);
  });

  it("imports the key as non-extractable", async () => {
    const { key } = await setUp();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});

describe("backup body", () => {
  it("round-trips through the file under the unwrapped key", async () => {
    const { backupId, key, wrapped } = await setUp();
    const body = bodyFor(backupId);
    const header: BackupHeader = { v: 1, backupId, updatedAt: body.updatedAt, writer: body.writer, wrapped };
    const bytes = encodeBackupFile({ header, sealed: await sealBackup(key, encodeBackupBody(body), backupId) });

    const file = decodeBackupFile(bytes);
    expect(file?.header).toEqual(header);
    const restoredKey = await importBackupKey(await unwrapBackupKey(file!.header.wrapped, PASSWORD, backupId));
    expect(decodeBackupBody(await openBackup(restoredKey, file!.sealed, backupId))).toEqual(body);
  });

  it("uses a fresh IV for every seal", async () => {
    const { backupId, key } = await setUp();
    const plaintext = encodeBackupBody(bodyFor(backupId));
    expect(await sealBackup(key, plaintext, backupId)).not.toEqual(await sealBackup(key, plaintext, backupId));
  });

  it("throws on any flipped byte", async () => {
    const { backupId, key } = await setUp();
    const sealed = await sealBackup(key, encodeBackupBody(bodyFor(backupId)), backupId);
    for (const index of [0, 12, sealed.length - 1]) {
      const altered = sealed.slice();
      altered[index]! ^= 1;
      await expect(openBackup(key, altered, backupId)).rejects.toThrow();
    }
  });

  it("throws under another key or another backup's id", async () => {
    const { backupId, key } = await setUp();
    const sealed = await sealBackup(key, encodeBackupBody(bodyFor(backupId)), backupId);
    await expect(openBackup(await importBackupKey(mintBackupKey()), sealed, backupId)).rejects.toThrow();
    await expect(openBackup(key, sealed, newBackupId())).rejects.toThrow();
  });

  it("throws on bytes too short to hold an IV and a tag", async () => {
    const { backupId, key } = await setUp();
    await expect(openBackup(key, new Uint8Array(27), backupId)).rejects.toThrow();
  });
});

describe("backup header", () => {
  it("validates a written header and refuses another version", async () => {
    const { backupId, wrapped } = await setUp();
    const header: BackupHeader = { v: 1, backupId, updatedAt: 1, writer: newBackupId(), wrapped };
    expect(isValidBackupHeader(header)).toBe(true);
    expect(isValidBackupHeader({ ...header, v: 2 })).toBe(false);
    expect(isValidBackupHeader({ ...header, wrapped: { ...wrapped, kdf: "PBKDF2-HMAC-SHA256" } })).toBe(false);
    expect(isValidBackupHeader({ ...header, backupId: "../x" })).toBe(false);
  });

  it("reads no file out of bytes that are not one", () => {
    expect(decodeBackupFile(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodeBackupFile(new TextEncoder().encode('{"v":1}'))).toBeNull();
    expect(decodeBackupFile(new Uint8Array([0xff, 0xfe]))).toBeNull();
  });
});
