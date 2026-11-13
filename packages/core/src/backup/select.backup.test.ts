import { describe, expect, it } from "vitest";
import { isBackedUpKey, isValidBackupBody, isValidBackupData, newBackupId, watchedTokensBackupKey, type BackupData } from "./file";
import { readBackupData, writeBackupData } from "./select";
import { address, contact, keyfileWallet, memoryStorage } from "./fixtures.testing";

const KEYSTONE = keyfileWallet("k", { method: "keystone", encryptedKeyfile: null, device: { kind: "keystone", xfp: "1a2b3c4d" } });
const WATCH = keyfileWallet("w", { method: "watch", encryptedKeyfile: null });

const INCLUDED: BackupData = {
  "local:wallets": [keyfileWallet("1"), KEYSTONE, WATCH],
  "local:activeWalletId": "1",
  "local:contacts": [contact("x"), contact("y")],
  [watchedTokensBackupKey(address("1"))]: [address("t"), address("u")],
  "local:networkSettings": { gatewayUrl: "https://arweave.net", peers: [{ url: "https://peer.example", enabled: true }], activePeerUrl: null },
  "local:displaySettings": { currency: "USD", header: "full", tokenLogos: true, tokenRows: "detailed", headline: "total", balancesHidden: false },
  "local:themeSettings": { theme: "dark" },
  "local:lockSettings": { autoLockTimeout: "5min" },
  "local:securityPhrase": { word: "willow" },
  "local:passkey": { version: 1, credentialId: "id", prfSalt: "salt", iv: "iv", ciphertext: "ct", createdAt: 1 },
  "local:browserSavedSites": ["https://app.example"],
};

const EXCLUDED = {
  "local:grants": [{ origin: "https://app.example" }],
  [`local:activityLog:${address("1")}`]: [{ txId: "tx", timestamp: 1 }],
  "local:points:device": { id: "device" },
};

describe("readBackupData", () => {
  it("takes every included key and none of the others", async () => {
    expect(await readBackupData(memoryStorage({ ...INCLUDED, ...EXCLUDED }))).toEqual(INCLUDED);
  });

  it("builds a body that passes the restore check", async () => {
    expect(isValidBackupData(await readBackupData(memoryStorage({ ...INCLUDED, ...EXCLUDED })))).toBe(true);
  });

  it("drops a malformed stored value and keeps the rest", async () => {
    const data = await readBackupData(
      memoryStorage({
        ...INCLUDED,
        "local:wallets": [keyfileWallet("1"), { id: "broken" }],
        "local:displaySettings": { showChart: false },
        "local:browserSavedSites": ["https://app.example", "javascript:alert(1)", "https://app.example/path"],
      }),
    );
    expect(data["local:wallets"]).toEqual([keyfileWallet("1")]);
    expect(data).not.toHaveProperty(["local:displaySettings"]);
    expect(data["local:browserSavedSites"]).toEqual(["https://app.example"]);
    expect(isValidBackupData(data)).toBe(true);
  });

  it("leaves out tokens added for a wallet that is gone, and an active wallet that is", async () => {
    const data = await readBackupData(
      memoryStorage({ ...INCLUDED, "local:activeWalletId": "gone", [watchedTokensBackupKey(address("z"))]: [address("t")] }),
    );
    expect(data).not.toHaveProperty(["local:activeWalletId"]);
    expect(data).not.toHaveProperty([watchedTokensBackupKey(address("z"))]);
  });
});

describe("writeBackupData", () => {
  it("restores every included key as it was", async () => {
    const restored = memoryStorage();
    await writeBackupData(restored, await readBackupData(memoryStorage({ ...INCLUDED, ...EXCLUDED })));
    expect(restored.entries()).toEqual(INCLUDED);
  });

  it.each<[string, BackupData]>([
    ["a malformed wallet", { ...INCLUDED, "local:wallets": [keyfileWallet("1"), { id: "broken" }] }],
    ["a watch wallet carrying a keyfile", { ...INCLUDED, "local:wallets": [keyfileWallet("1"), { ...WATCH, encryptedKeyfile: keyfileWallet("1").encryptedKeyfile }] }],
    ["a contact with a bad address", { ...INCLUDED, "local:contacts": [contact("x", { address: "short" })] }],
    ["an active wallet the backup lacks", { ...INCLUDED, "local:activeWalletId": "gone" }],
    ["a list stored as an object", { ...INCLUDED, "local:contacts": { 0: contact("x") } }],
    ["a saved site that is not a web origin", { ...INCLUDED, "local:browserSavedSites": ["javascript:alert(1)"] }],
    ["a bad token id", { ...INCLUDED, [watchedTokensBackupKey(address("1"))]: ["nope"] }],
  ])("refuses the whole backup over %s, writing nothing", async (_, data) => {
    const restored = memoryStorage();
    await expect(writeBackupData(restored, data)).rejects.toThrow();
    expect(restored.entries()).toEqual({});
  });

  it("never writes a key that is not backed up", async () => {
    const restored = memoryStorage();
    await writeBackupData(restored, { ...INCLUDED, ...EXCLUDED, "session:unlockedSession": { unlockedAt: 1 } });
    expect(restored.entries()).toEqual(INCLUDED);
  });
});

describe("isBackedUpKey", () => {
  it("covers the vault and nothing bound to a device or a site", () => {
    expect(Object.keys(INCLUDED).every(isBackedUpKey)).toBe(true);
    expect(Object.keys(EXCLUDED).some(isBackedUpKey)).toBe(false);
    expect(isBackedUpKey("local:backupKey")).toBe(false);
    expect(isBackedUpKey("local:watchedProcessIds:not-an-address")).toBe(false);
  });
});

describe("isValidBackupBody", () => {
  const writer = newBackupId();
  const body = { v: 1, backupId: newBackupId(), updatedAt: 2, writer, devices: { [writer]: { updatedAt: 2, data: INCLUDED } } };

  it("accepts a body holding its writer's vault and another device's", () => {
    expect(isValidBackupBody(body)).toBe(true);
    expect(isValidBackupBody({ ...body, devices: { ...body.devices, [newBackupId()]: { updatedAt: 1, data: {} } } })).toBe(true);
  });

  it.each<[string, unknown]>([
    ["no vault for its writer", { ...body, devices: {} }],
    ["a device with a malformed wallet", { ...body, devices: { ...body.devices, [newBackupId()]: { updatedAt: 1, data: { "local:wallets": [{ id: "broken" }] } } } }],
    ["a device id that is not one", { ...body, devices: { ...body.devices, "../x": { updatedAt: 1, data: {} } } }],
    ["more devices than Gleam writes", { ...body, devices: { ...body.devices, ...Object.fromEntries(Array.from({ length: 16 }, () => [newBackupId(), { updatedAt: 1, data: {} }])) } }],
    ["another version", { ...body, v: 2 }],
  ])("refuses a body with %s", (_, value) => {
    expect(isValidBackupBody(value)).toBe(false);
  });
});
