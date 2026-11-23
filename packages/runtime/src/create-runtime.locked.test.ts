import { describe, expect, it } from "vitest";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { bytesToBase64Url, type WalletSummary } from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { createRuntime } from "./create-runtime";
import { createInMemoryPlatform } from "../testing/index";

const EXTENSION: CallerContext = { tier: "extension" };
const LOCKED = userErrorMessage("keyringLocked");

async function lockedRuntime() {
  const runtime = createRuntime(createInMemoryPlatform());
  const wallet = (await runtime.dispatch("createWallet", { name: "A", password: "correct horse" }, EXTENSION)) as WalletSummary;
  await runtime.dispatch("lockWallet", undefined, EXTENSION);
  return { runtime, wallet };
}

describe("a screen left open after the vault locks", () => {
  it("can't delete a wallet", async () => {
    const { runtime, wallet } = await lockedRuntime();
    await expect(runtime.dispatch("deleteWallet", { walletId: wallet.id }, EXTENSION)).rejects.toThrow(LOCKED);
    const state = (await runtime.dispatch("getState", { recordActivity: false }, EXTENSION)) as { wallets: unknown[] };
    expect(state.wallets).toHaveLength(1);
  });

  it("can't change the auto-lock timeout", async () => {
    const { runtime } = await lockedRuntime();
    await expect(runtime.dispatch("setLockSettings", { autoLockTimeout: "never" }, EXTENSION)).rejects.toThrow(LOCKED);
    await expect(runtime.dispatch("getLockSettings", undefined, EXTENSION)).resolves.toEqual({ autoLockTimeout: "1hr" });
  });

  it("can't stop or delete the cloud backup", async () => {
    const { runtime } = await lockedRuntime();
    await expect(runtime.dispatch("stopBackupSync", undefined, EXTENSION)).rejects.toThrow(LOCKED);
    await expect(runtime.dispatch("deleteBackup", undefined, EXTENSION)).rejects.toThrow(LOCKED);
  });

  it("can't connect a site", async () => {
    const { runtime } = await lockedRuntime();
    await expect(
      runtime.dispatch("useGleamOnSite", { origin: "https://example.com", permissions: ["ACCESS_ADDRESS"] }, EXTENSION),
    ).rejects.toThrow(LOCKED);
  });

  it("can't remove the passkey", async () => {
    const { runtime } = await lockedRuntime();
    await runtime.dispatch("unlockWallet", { password: "correct horse" }, EXTENSION);
    await runtime.dispatch(
      "enrollPasskey",
      { password: "correct horse", credentialId: "cred-1", prfSalt: "salt", prfOutput: bytesToBase64Url(new Uint8Array(32).fill(3)) },
      EXTENSION,
    );
    await runtime.dispatch("lockWallet", undefined, EXTENSION);
    await expect(runtime.dispatch("removePasskey", undefined, EXTENSION)).rejects.toThrow(LOCKED);
    await expect(runtime.dispatch("getPasskeyStatus", undefined, EXTENSION)).resolves.toMatchObject({ enrolled: true });
  });

  it("still changes the timeout while unlocked", async () => {
    const runtime = createRuntime(createInMemoryPlatform());
    await runtime.dispatch("createWallet", { name: "A", password: "correct horse" }, EXTENSION);
    await runtime.dispatch("setLockSettings", { autoLockTimeout: "4hr" }, EXTENSION);
    await expect(runtime.dispatch("getLockSettings", undefined, EXTENSION)).resolves.toEqual({ autoLockTimeout: "4hr" });
  });
});
