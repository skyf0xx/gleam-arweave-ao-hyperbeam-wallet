import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ACTIVE_WALLET_BACKUP_KEY,
  BACKUP_FORMAT_VERSION,
  CONTACTS_BACKUP_KEY,
  MAX_BACKUP_DEVICES,
  SAVED_SITES_BACKUP_KEY,
  WALLETS_BACKUP_KEY,
  backupValueOf,
  decodeBackupBody,
  decodeBackupFile,
  encodeBackupBody,
  encodeBackupFile,
  isBackedUpKey,
  isValidBackupBody,
  isValidBackupData,
  isValidBackupHeader,
  mergeBackupDevices,
  planPull,
  watchedTokensBackupKey,
  type BackupBody,
  type BackupData,
  type BackupHeader,
} from "./index";
import { address, contact, keyfileWallet } from "./fixtures.testing";

/*
 * A backup file is what a taken-over cloud account controls: the clear
 * header always, and the body bytes if it ever holds the key. Whatever it
 * holds, decoding refuses it outright or yields only values Gleam could
 * have stored itself, so nothing hostile reaches a merge or a pull.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Path = Array<string | number>;

const ID_CHARS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"];
const stampId = fc.string({ unit: fc.constantFrom(...ID_CHARS), minLength: 16, maxLength: 24 });
const seed = fc.constantFrom("a", "b", "c", "d");

/** One install's vault: wallets that may share an address with another install's, and what hangs off them. */
const deviceData: fc.Arbitrary<BackupData> = fc
  .record({
    wallets: fc.uniqueArray(fc.record({ id: fc.constantFrom("w1", "w2", "w3", "w4"), at: seed, updatedAt: fc.nat(9), watch: fc.boolean() }), {
      selector: (wallet) => wallet.id,
      maxLength: 3,
    }),
    contacts: fc.uniqueArray(seed, { maxLength: 2 }),
    active: fc.boolean(),
    tokens: fc.uniqueArray(seed, { maxLength: 2 }),
    sites: fc.boolean(),
  })
  .map(({ wallets, contacts, active, tokens, sites }) => {
    // One address per install, as the wallet list holds it.
    const unique = wallets.filter((wallet, index) => wallets.findIndex((other) => other.at === wallet.at) === index);
    const records = unique.map(({ id, at, updatedAt, watch }) =>
      keyfileWallet(id, { address: address(at), updatedAt, ...(watch ? { method: "watch" as const, encryptedKeyfile: null } : {}) }),
    );
    const data: BackupData = {};
    if (records.length > 0) data[WALLETS_BACKUP_KEY] = records;
    if (active && records[0]) data[ACTIVE_WALLET_BACKUP_KEY] = records[0].id;
    if (contacts.length > 0) data[CONTACTS_BACKUP_KEY] = contacts.map((at) => contact(at));
    if (records[0] && tokens.length > 0) data[watchedTokensBackupKey(records[0].address)] = tokens.map((at) => address(at.toUpperCase()));
    if (sites) data[SAVED_SITES_BACKUP_KEY] = ["https://app.example"];
    return data;
  });

const body: fc.Arbitrary<BackupBody> = fc
  .record({
    backupId: stampId,
    updatedAt: fc.nat(),
    writer: stampId,
    others: fc.uniqueArray(fc.tuple(stampId, fc.nat(), deviceData), { selector: ([writer]) => writer, maxLength: 2 }),
    own: deviceData,
  })
  .map(({ backupId, updatedAt, writer, others, own }) => ({
    v: BACKUP_FORMAT_VERSION,
    backupId,
    updatedAt,
    writer,
    devices: {
      ...Object.fromEntries(others.map(([other, at, data]) => [other, { updatedAt: at, data }])),
      [writer]: { updatedAt, data: own },
    },
  }));

function pathsOf(value: unknown, at: Path = []): Path[] {
  if (Array.isArray(value)) return [at, ...value.flatMap((item, index) => pathsOf(item, [...at, index]))];
  if (value !== null && typeof value === "object") {
    return [at, ...Object.entries(value).flatMap(([key, item]) => pathsOf(item, [...at, key]))];
  }
  return [at];
}

const REMOVE = Symbol("remove");

/** A copy of `value` with the node at `path` replaced, removed, or (for an object) given one more key. */
function edited(value: Json, path: Path, edit: { replacement: Json | typeof REMOVE; addKey: string | null }): Json {
  if (path.length === 0) {
    if (edit.addKey !== null && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const copy = { ...value };
      Object.defineProperty(copy, edit.addKey, { value: edit.replacement === REMOVE ? null : edit.replacement, enumerable: true });
      return copy;
    }
    return edit.replacement === REMOVE ? null : edit.replacement;
  }
  const [step, ...rest] = path;
  if (Array.isArray(value)) {
    const index = step as number;
    if (rest.length === 0 && edit.replacement === REMOVE && edit.addKey === null) return value.filter((_, at) => at !== index);
    return value.map((item, at) => (at === index ? edited(item, rest, edit) : item));
  }
  const record = value as { [key: string]: Json };
  if (rest.length === 0 && edit.replacement === REMOVE && edit.addKey === null) {
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== step));
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, key === step ? edited(item, rest, edit) : item]));
}

/** `valid` with one node anywhere in it replaced, removed, or given a key Gleam may or may not know. */
function hostile(valid: Json): fc.Arbitrary<Json> {
  const addKey = fc.option(
    fc.oneof(fc.constantFrom("__proto__", "constructor", WALLETS_BACKUP_KEY, CONTACTS_BACKUP_KEY, "local:lockSettings", "local:passkey"), fc.string()),
    { freq: 3 },
  );
  const replacement = fc.oneof(fc.jsonValue({ maxDepth: 2 }) as fc.Arbitrary<Json>, fc.constant(REMOVE));
  return fc
    .tuple(fc.constantFrom(...pathsOf(valid)), replacement, addKey)
    .map(([path, value, key]) => edited(valid, path, { replacement: value, addKey: key }));
}

const encodeJson = (value: Json) => new TextEncoder().encode(JSON.stringify(value));

/** Every value under a key a backup holds passes that key's guard, item by item for a list. */
function expectOnlyGuardedValues(data: BackupData): void {
  for (const [key, value] of Object.entries(data)) {
    if (!isBackedUpKey(key) || (Array.isArray(value) && value.length === 0)) continue;
    expect(backupValueOf(key, value)).toEqual(value);
  }
}

describe("decodeBackupBody refuses a hostile body before anything merges it", () => {
  it("accepts only bodies whose every backed-up value passes its guard", () => {
    let accepted = 0;
    fc.assert(
      fc.property(
        body.chain((valid) => hostile(valid as unknown as Json)),
        (candidate) => {
          const decoded = decodeBackupBody(encodeJson(candidate));
          if (decoded === null) return;
          accepted += 1;
          expect(isValidBackupBody(decoded)).toBe(true);
          expect(Object.keys(decoded.devices).length).toBeLessThanOrEqual(MAX_BACKUP_DEVICES);
          for (const device of Object.values(decoded.devices)) expectOnlyGuardedValues(device.data);

          // What a restore writes and what a sync pulls are values Gleam could have stored.
          const merged = mergeBackupDevices(decoded.devices);
          expect(isValidBackupData(merged)).toBe(true);
          expectOnlyGuardedValues(merged);
          const { add } = planPull({}, undefined, Object.values(decoded.devices));
          expect(isValidBackupData(add)).toBe(true);
          expectOnlyGuardedValues(add);
        },
      ),
      { numRuns: 400 },
    );
    // Many edits leave a valid body (an unknown key, a removed optional list).
    expect(accepted).toBeGreaterThan(40);
  });

  it("reads back every body Gleam writes", () => {
    fc.assert(
      fc.property(body, (valid) => {
        expect(decodeBackupBody(encodeBackupBody(valid))).toEqual(valid);
      }),
      { numRuns: 100 },
    );
  });

  it("returns null for any bytes that aren't a body", () => {
    fc.assert(
      fc.property(fc.oneof(fc.uint8Array({ maxLength: 256 }), fc.jsonValue().map((value) => encodeJson(value as Json))), (bytes) => {
        const decoded = decodeBackupBody(bytes);
        if (decoded !== null) expect(isValidBackupBody(decoded)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

const header: fc.Arbitrary<BackupHeader> = fc.record({
  v: fc.constant(BACKUP_FORMAT_VERSION),
  backupId: stampId,
  updatedAt: fc.nat(),
  writer: stampId,
  wrapped: fc.record({
    version: fc.constant(2 as const),
    algorithm: fc.constant("AES-GCM" as const),
    kdf: fc.constant("Argon2id" as const),
    memoryKiB: fc.constant(65_536),
    iterations: fc.constant(5),
    parallelism: fc.constant(1),
    salt: fc.base64String({ minLength: 24, maxLength: 24 }),
    iv: fc.base64String({ minLength: 16, maxLength: 16 }),
    ciphertext: fc.base64String({ minLength: 4, maxLength: 64 }),
  }),
  passkeys: fc.array(
    fc.record({ credentialId: fc.string({ minLength: 1 }), prfSalt: fc.string({ minLength: 1 }), iv: fc.string({ minLength: 1 }), ciphertext: fc.string({ minLength: 1 }) }),
    { minLength: 1, maxLength: 3 },
  ),
}, { requiredKeys: ["v", "backupId", "updatedAt", "writer", "wrapped"] });

const HEADER_KEYS = ["v", "backupId", "updatedAt", "writer", "wrapped", "passkeys"];

describe("decodeBackupFile refuses a hostile file or reads only its known header", () => {
  it("for any edit to a file Gleam wrote", () => {
    fc.assert(
      fc.property(
        fc.tuple(header, fc.uint8Array({ minLength: 28, maxLength: 64 })).chain(([valid, sealed]) =>
          hostile(JSON.parse(new TextDecoder().decode(encodeBackupFile({ header: valid, sealed }))) as Json),
        ),
        (candidate) => {
          const file = decodeBackupFile(encodeJson(candidate));
          if (file === null) return;
          expect(isValidBackupHeader(file.header)).toBe(true);
          expect(HEADER_KEYS).toEqual(expect.arrayContaining(Object.keys(file.header)));
          const passkeys = file.header.passkeys ?? [];
          expect(passkeys.length).toBeLessThanOrEqual(MAX_BACKUP_DEVICES);
          for (const passkey of passkeys) {
            expect(Object.keys(passkey).sort()).toEqual(["ciphertext", "credentialId", "iv", "prfSalt"]);
            expect(Object.values(passkey).every((field) => typeof field === "string" && field.length > 0)).toBe(true);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("reads back every file Gleam writes", () => {
    fc.assert(
      fc.property(header, fc.uint8Array({ minLength: 28, maxLength: 64 }), (valid, sealed) => {
        const file = decodeBackupFile(encodeBackupFile({ header: valid, sealed }));
        expect(file).toEqual({ header: valid, sealed });
      }),
      { numRuns: 100 },
    );
  });

  it("returns null or a valid header for any bytes", () => {
    fc.assert(
      fc.property(fc.oneof(fc.uint8Array({ maxLength: 256 }), fc.jsonValue().map((value) => encodeJson(value as Json))), (bytes) => {
        const file = decodeBackupFile(bytes);
        if (file !== null) expect(isValidBackupHeader(file.header)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
