import { describe, expect, it } from "vitest";
import { isValidBackupData, watchedTokensBackupKey, type BackupData } from "./file";
import { mergeBackupData } from "./merge";
import { address, contact, keyfileWallet } from "./fixtures.testing";

const TOKENS = watchedTokensBackupKey(address("2"));

const A: BackupData = {
  "local:wallets": [keyfileWallet("1"), keyfileWallet("2")],
  "local:activeWalletId": "1",
  "local:contacts": [contact("x")],
  [TOKENS]: [address("t")],
  "local:themeSettings": { theme: "light" },
  "local:securityPhrase": { word: "willow" },
};

const B: BackupData = {
  "local:wallets": [keyfileWallet("2"), keyfileWallet("3")],
  "local:activeWalletId": "3",
  "local:contacts": [contact("y")],
  [TOKENS]: [address("u"), address("t")],
  "local:themeSettings": { theme: "dark" },
};

function ids(data: BackupData): string[] {
  return (data["local:wallets"] as { id: string }[]).map((wallet) => wallet.id);
}

describe("mergeBackupData", () => {
  it("keeps every wallet, contact and token of both devices, and the newer device's settings", () => {
    const merged = mergeBackupData(A, B);
    expect(ids(merged).sort()).toEqual(["1", "2", "3"]);
    expect(merged["local:contacts"]).toEqual([contact("y"), contact("x")]);
    expect(merged[TOKENS]).toEqual([address("u"), address("t")]);
    expect(merged["local:themeSettings"]).toEqual({ theme: "dark" });
    expect(merged["local:activeWalletId"]).toBe("3");
    expect(isValidBackupData(merged)).toBe(true);
  });

  it("keeps a setting only the older device has", () => {
    expect(mergeBackupData(A, B)["local:securityPhrase"]).toEqual({ word: "willow" });
  });

  it("keeps the copy of a shared wallet or contact that changed last", () => {
    const renamed = keyfileWallet("2", { name: "Savings", updatedAt: 5 });
    const merged = mergeBackupData({ ...A, "local:wallets": [keyfileWallet("1"), renamed], "local:contacts": [contact("y", { name: "Old", createdAt: 9 })] }, B);
    expect((merged["local:wallets"] as unknown[]).filter((wallet) => (wallet as { id: string }).id === "2")).toEqual([renamed]);
    expect(merged["local:contacts"]).toEqual([contact("y", { name: "Old", createdAt: 9 })]);
  });

  it("takes the newer copy when both changed at the same time", () => {
    const merged = mergeBackupData({ "local:wallets": [keyfileWallet("2", { name: "Older" })] }, { "local:wallets": [keyfileWallet("2", { name: "Newer" })] });
    expect(merged["local:wallets"]).toEqual([keyfileWallet("2", { name: "Newer" })]);
  });

  it("merges with an empty side", () => {
    expect(mergeBackupData({}, B)).toEqual(B);
    expect(mergeBackupData(A, {})).toEqual(A);
  });

  it("changes neither input", () => {
    const a = structuredClone(A);
    const b = structuredClone(B);
    mergeBackupData(a, b);
    expect([a, b]).toEqual([A, B]);
  });
});
