import { describe, expect, it } from "vitest";
import { watchedTokensBackupKey, type BackupData, type BackupDevice } from "./file";
import { address, contact, keyfileWallet } from "./fixtures.testing";
import { planPull, removedOf } from "./pull";

const SITE = "https://example.com";

function device(data: BackupData, updatedAt = 1, removed?: BackupDevice["removed"]): BackupDevice {
  return { updatedAt, data, ...(removed ? { removed } : {}) };
}

describe("planPull", () => {
  it("adds the wallets, contacts, tokens and sites other devices hold and this one lacks", () => {
    const local: BackupData = { "local:wallets": [keyfileWallet("1")], "local:contacts": [contact("x")] };
    const other = device({
      "local:wallets": [keyfileWallet("1", { name: "Elsewhere" }), keyfileWallet("2")],
      "local:contacts": [contact("x"), contact("y")],
      [watchedTokensBackupKey(address("2"))]: [address("t")],
      "local:browserSavedSites": [SITE],
    });
    const { add, removed } = planPull(local, undefined, [other]);
    expect(add).toEqual({
      "local:wallets": [keyfileWallet("2")],
      "local:contacts": [contact("y")],
      [watchedTokensBackupKey(address("2"))]: [address("t")],
      "local:browserSavedSites": [SITE],
    });
    expect(removed).toEqual({});
  });

  it("leaves settings, the active wallet and the passkey alone", () => {
    const other = device({
      "local:activeWalletId": "9",
      "local:themeSettings": { theme: "dark" },
      "local:lockSettings": { autoLockTimeout: "never" },
      "local:passkey": { credentialId: "c" },
    });
    expect(planPull({}, undefined, [other]).add).toEqual({});
  });

  it("never pulls a second copy of a wallet already here under another id", () => {
    const local: BackupData = { "local:wallets": [keyfileWallet("1")] };
    const other = device({ "local:wallets": [keyfileWallet("9", { address: address("1") })] });
    expect(planPull(local, undefined, [other]).add).toEqual({});
  });

  it("takes an item from the device that wrote last", () => {
    const older = device({ "local:contacts": [contact("y", { name: "Old" })] }, 1);
    const newer = device({ "local:contacts": [contact("y", { name: "New" })] }, 2);
    expect(planPull({}, undefined, [older, newer]).add["local:contacts"]).toEqual([contact("y", { name: "New" })]);
  });

  it("records what was removed here and doesn't pull it back", () => {
    const own = device({ "local:wallets": [keyfileWallet("1"), keyfileWallet("2")], "local:contacts": [contact("x")] });
    const other = device({ "local:wallets": [keyfileWallet("2")], "local:contacts": [contact("x")] });
    const { add, removed } = planPull({ "local:wallets": [keyfileWallet("1")] }, own, [other]);
    expect(add).toEqual({});
    expect(removed).toEqual({ "local:wallets": [address("2")], "local:contacts": [address("x")] });
  });

  it("keeps a removal across writes while another device still holds the item", () => {
    const own = device({ "local:wallets": [keyfileWallet("1")] }, 1, { "local:wallets": [address("2")] });
    const other = device({ "local:wallets": [keyfileWallet("2")] });
    const { add, removed } = planPull({ "local:wallets": [keyfileWallet("1")] }, own, [other]);
    expect(add).toEqual({});
    expect(removed).toEqual({ "local:wallets": [address("2")] });
  });

  it("drops a removal once no other device holds the item, or once it is back here", () => {
    const own = device({}, 1, { "local:wallets": [address("2"), address("3")] });
    const other = device({ "local:wallets": [keyfileWallet("3")] });
    expect(planPull({ "local:wallets": [keyfileWallet("3")] }, own, [other]).removed).toEqual({});
  });

  it("reads removals defensively", () => {
    expect(removedOf(device({}, 1, { a: ["x", 3 as unknown as string], b: "y" as unknown as string[] }))).toEqual({ a: ["x"] });
    expect(removedOf({ updatedAt: 1, data: {}, removed: null as unknown as BackupDevice["removed"] })).toEqual({});
    expect(removedOf(undefined)).toEqual({});
  });
});
