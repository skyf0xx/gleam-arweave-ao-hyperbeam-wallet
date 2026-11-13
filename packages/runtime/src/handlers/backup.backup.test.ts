import { beforeAll, describe, expect, it } from "vitest";
import { decodeBackupFile, type Wallet } from "@gleam/core";
import { Keyring } from "@gleam/core/signer";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { InMemoryCloudAccount, InMemoryCloudFile, InMemoryStorage, InMemoryTimer } from "../../testing";
import { registerBackupSync } from "../backup-sync";
import { BACKUP_KEY, BACKUP_STATE_KEY, CONTACTS_KEY, WALLETS_KEY } from "../storage-keys";
import { BackupHandler } from "./backup";
import { ContactsHandler } from "./contacts";
import { createKeySession, type KeySession } from "./key-session";
import { WalletLifecycleHandler } from "./wallet-lifecycle";

const PASSWORD = "correct horse battery staple 42";
const TEST_KDF = { kdfParams: { memoryKiB: 64, iterations: 1, parallelism: 1 } };
const ADDRESS = "a".repeat(43);

interface Device {
  storage: InMemoryStorage;
  keySession: KeySession;
  lifecycle: WalletLifecycleHandler;
  backup: BackupHandler;
  cloud: InMemoryCloudFile;
  clock: { now: number };
}

function device(account: InMemoryCloudAccount, seed: Record<string, unknown> = {}): Device {
  const storage = new InMemoryStorage();
  for (const [key, value] of Object.entries(seed)) storage.entries.set(key, structuredClone(value));
  const sessionKeys = new Keyring();
  const keySession = createKeySession({ sessionKeys, storage });
  const lifecycle = new WalletLifecycleHandler(storage, keySession, TEST_KDF);
  const cloud = new InMemoryCloudFile(account);
  const clock = { now: 1_700_000_000_000 };
  const backup = new BackupHandler({ storage, sessionKeys, cloudFile: cloud, vault: lifecycle, now: () => (clock.now += 1_000) });
  return { storage, keySession, lifecycle, backup, cloud, clock };
}

function walletsOf(target: Device): Wallet[] {
  return (target.storage.entries.get(WALLETS_KEY) as Wallet[] | undefined) ?? [];
}

function names(target: Device): string[] {
  return walletsOf(target).map((wallet) => wallet.name).sort();
}

/** A vault with two keyfile wallets, made once: generating RSA-4096 keys is the slow part. */
let vault: Record<string, unknown>;
/** A vault under the same password holding one other keyfile wallet. */
let otherVault: Record<string, unknown>;

beforeAll(async () => {
  const first = device(new InMemoryCloudAccount());
  await first.lifecycle.createWallet({ name: "Main", password: PASSWORD });
  await first.lifecycle.createWallet({ name: "Savings", password: PASSWORD });
  await first.lifecycle.addWatchWallet({ address: ADDRESS, name: "Watched" });
  await new ContactsHandler(first.storage).saveContact({ address: "c".repeat(43), name: "Ada" });
  vault = Object.fromEntries([...first.storage.entries].filter(([key]) => key.startsWith("local:")));

  const second = device(new InMemoryCloudAccount());
  await second.lifecycle.createWallet({ name: "Travel", password: PASSWORD });
  otherVault = Object.fromEntries([...second.storage.entries].filter(([key]) => key.startsWith("local:")));
}, 120_000);

async function unlocked(account: InMemoryCloudAccount, seed = vault): Promise<Device> {
  const target = device(account, seed);
  await target.lifecycle.unlockWallet({ password: PASSWORD });
  return target;
}

async function backedUp(account = new InMemoryCloudAccount()): Promise<Device> {
  const target = await unlocked(account);
  await target.backup.setUp({ password: PASSWORD });
  return target;
}

describe("BackupHandler: set up", () => {
  it("is off until set up, and names where a backup can go", async () => {
    const target = await unlocked(new InMemoryCloudAccount());
    expect(await target.backup.status()).toEqual({ provider: "google", enabled: false, lastBackupAt: null, problem: null });
  });

  it("writes the first file and reports when", async () => {
    const target = await backedUp();
    const status = await target.backup.status();
    expect(status).toMatchObject({ enabled: true, problem: null });
    expect(status.lastBackupAt).toBeGreaterThan(0);
    expect(target.cloud.account.writes).toBe(1);
  });

  it("puts nothing readable in the account", async () => {
    const target = await backedUp();
    const text = new TextDecoder().decode(target.cloud.account.file!.bytes);
    for (const wallet of walletsOf(target)) {
      expect(text).not.toContain(wallet.address);
      expect(text).not.toContain(wallet.name);
    }
    expect(text).not.toContain("Ada");
  });

  it("refuses a password that doesn't open the vault, before signing in", async () => {
    const target = await unlocked(new InMemoryCloudAccount());
    await expect(target.backup.setUp({ password: "not the password 99" })).rejects.toThrow(userErrorMessage("vaultPasswordFailed"));
    expect(target.cloud.account.file).toBeNull();
    expect(target.storage.entries.has(BACKUP_KEY)).toBe(false);
  });

  it("stays off when the sign-in is not completed", async () => {
    const account = new InMemoryCloudAccount();
    account.signedIn = false;
    account.allowsSignIn = false;
    const target = await unlocked(account);
    await expect(target.backup.setUp({ password: PASSWORD })).rejects.toThrow(userErrorMessage("backupSignInNeeded"));
    expect((await target.backup.status()).enabled).toBe(false);
  });

  it("is unavailable on a shell with nowhere to keep a backup", async () => {
    const { storage, lifecycle } = await unlocked(new InMemoryCloudAccount());
    const backup = new BackupHandler({ storage, sessionKeys: new Keyring(), cloudFile: undefined, vault: lifecycle });
    expect((await backup.status()).provider).toBeNull();
    await expect(backup.setUp({ password: PASSWORD })).rejects.toThrow(userErrorMessage("backupUnavailable"));
  });
});

describe("BackupHandler: keeping up to date", () => {
  it("writes a change on the next sync, and nothing when there is none", async () => {
    const target = await backedUp();
    await target.backup.sync();
    expect(target.cloud.account.writes).toBe(1);

    await target.lifecycle.renameWallet({ walletId: walletsOf(target)[0]!.id, name: "Renamed" });
    await target.backup.markChanged();
    await target.backup.sync();
    expect(target.cloud.account.writes).toBe(2);
  });

  it("holds a change made while locked for the unlock that follows", async () => {
    const target = await backedUp();
    await target.lifecycle.lockWallet();
    await target.backup.markChanged();
    await target.backup.sync();
    expect(target.cloud.account.writes).toBe(1);

    await target.lifecycle.unlockWallet({ password: PASSWORD });
    await target.backup.sync();
    expect(target.cloud.account.writes).toBe(2);
  });

  it("stops at a sign-in it can't make without UI, until the person signs in", async () => {
    const target = await backedUp();
    target.cloud.account.signedIn = false;
    await target.backup.markChanged();
    await target.backup.sync();
    expect((await target.backup.status()).problem).toBe("signIn");
    await target.backup.sync();
    expect(target.cloud.account.writes).toBe(1);

    expect((await target.backup.backUpNow()).problem).toBeNull();
    expect(target.cloud.account.writes).toBe(2);
  });

  it("reports a file removed from the account's side, and makes it again when asked", async () => {
    const target = await backedUp();
    target.cloud.account.file = null;
    await target.backup.markChanged();
    await target.backup.sync();
    expect((await target.backup.status()).problem).toBe("missing");
    expect(target.cloud.account.file).toBeNull();

    expect((await target.backup.backUpNow()).problem).toBeNull();
    expect(target.cloud.account.file).not.toBeNull();
  });

  it("keeps a change that lands during a write for the next one", async () => {
    const target = await backedUp();
    await target.backup.markChanged();
    const write = target.cloud.write.bind(target.cloud);
    target.cloud.write = async (bytes) => {
      await target.backup.markChanged();
      await write(bytes);
    };
    await target.backup.sync();
    await target.backup.sync();
    expect(target.cloud.account.writes).toBe(3);
  });

  it("debounces changes to what the backup holds, and ignores the rest", async () => {
    const target = await backedUp();
    const timer = new InMemoryTimer();
    const scheduled: Array<() => void> = [];
    registerBackupSync(target.storage, timer, target.backup, { schedule: (run) => scheduled.push(run), cancel: () => {} });

    await target.storage.set("local:grants", []);
    expect(scheduled).toHaveLength(0);

    await new ContactsHandler(target.storage).saveContact({ address: "d".repeat(43), name: "Grace" });
    expect(scheduled).toHaveLength(1);
    scheduled[0]!();
    await expect.poll(() => target.cloud.account.writes).toBe(2);
  });
});

describe("BackupHandler: restore", () => {
  it("brings the vault back on a fresh install and unlocks it", async () => {
    const original = await backedUp();
    const fresh = device(original.cloud.account);

    expect(await fresh.backup.find()).toEqual({ found: true });
    const { unlockedWalletIds } = await fresh.backup.restore({ password: PASSWORD });

    expect(walletsOf(fresh)).toEqual(walletsOf(original));
    expect(fresh.storage.entries.get(CONTACTS_KEY)).toEqual(original.storage.entries.get(CONTACTS_KEY));
    expect((await fresh.lifecycle.getState()).activeWalletId).toBe((await original.lifecycle.getState()).activeWalletId);
    expect(unlockedWalletIds).toHaveLength(3);
    const signer = await fresh.keySession.getSigner(walletsOf(fresh).find((wallet) => wallet.method === "jwk")!.id);
    expect(signer).not.toBeNull();
    expect((await fresh.backup.status()).enabled).toBe(true);
  });

  it("refuses a wrong password and leaves the vault empty", async () => {
    const original = await backedUp();
    const fresh = device(original.cloud.account);
    await expect(fresh.backup.restore({ password: "not the password 99" })).rejects.toThrow(userErrorMessage("backupWrongPassword"));
    expect([...fresh.storage.entries.keys()]).toEqual([]);
  });

  it("refuses an altered file and leaves the vault empty", async () => {
    const original = await backedUp();
    const { bytes } = original.cloud.account.file!;
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { body: string };
    parsed.body = `${parsed.body.slice(0, 40)}${parsed.body[40] === "A" ? "B" : "A"}${parsed.body.slice(41)}`;
    original.cloud.account.file!.bytes = new TextEncoder().encode(JSON.stringify(parsed));

    const fresh = device(original.cloud.account);
    await expect(fresh.backup.restore({ password: PASSWORD })).rejects.toThrow(userErrorMessage("backupFileCorrupt"));
    expect([...fresh.storage.entries.keys()]).toEqual([]);
  });

  it("refuses a header moved onto another write's body", async () => {
    const original = await backedUp();
    const parsed = JSON.parse(new TextDecoder().decode(original.cloud.account.file!.bytes)) as { updatedAt: number };
    parsed.updatedAt += 1;
    original.cloud.account.file!.bytes = new TextEncoder().encode(JSON.stringify(parsed));

    const fresh = device(original.cloud.account);
    await expect(fresh.backup.restore({ password: PASSWORD })).rejects.toThrow(userErrorMessage("backupFileCorrupt"));
  });

  it("reports an account with no backup", async () => {
    const fresh = device(new InMemoryCloudAccount());
    expect(await fresh.backup.find()).toEqual({ found: false });
    await expect(fresh.backup.restore({ password: PASSWORD })).rejects.toThrow(userErrorMessage("backupFileMissing"));
  });

  it("never restores over a vault that has wallets", async () => {
    const original = await backedUp();
    const occupied = await unlocked(original.cloud.account, otherVault);
    await expect(occupied.backup.restore({ password: PASSWORD })).rejects.toThrow();
    expect(names(occupied)).toEqual(["Travel"]);
  });
});

describe("BackupHandler: two devices", () => {
  it("joins the account's backup and keeps both devices' wallets through every write", async () => {
    const first = await backedUp();
    const second = await unlocked(first.cloud.account, otherVault);
    await second.backup.setUp({ password: PASSWORD });
    expect(decodeBackupFile(first.cloud.account.file!.bytes)!.header.backupId).toBe(
      (first.storage.entries.get(BACKUP_KEY) as { backupId: string }).backupId,
    );

    // Each device writes twice in a row: neither write may drop the other's wallets.
    for (const target of [first, first, second, second]) {
      await target.backup.markChanged();
      await target.backup.sync();
      const fresh = device(first.cloud.account);
      await fresh.backup.restore({ password: PASSWORD });
      expect(names(fresh)).toEqual(["Main", "Savings", "Travel", "Watched"]);
      // The restore wrote the file alone; put both devices' copies back.
      for (const again of [first, second]) {
        await again.backup.markChanged();
        await again.backup.sync();
      }
    }
  });

  it("drops a deleted wallet from the backup once no device has it", async () => {
    const target = await backedUp();
    const savings = walletsOf(target).find((wallet) => wallet.name === "Savings")!;
    await target.lifecycle.deleteWallet({ walletId: savings.id });
    await target.backup.markChanged();
    await target.backup.sync();

    const fresh = device(target.cloud.account);
    await fresh.backup.restore({ password: PASSWORD });
    expect(names(fresh)).toEqual(["Main", "Watched"]);
  });
});

describe("BackupHandler: turn off", () => {
  it("deletes the file, ends access and forgets the key", async () => {
    const target = await backedUp();
    expect(await target.backup.turnOff()).toEqual({ provider: "google", enabled: false, lastBackupAt: null, problem: null });
    expect(target.cloud.account.file).toBeNull();
    expect(target.cloud.account.revoked).toBe(1);
    expect(target.storage.entries.has(BACKUP_KEY)).toBe(false);
    expect(target.storage.entries.has(BACKUP_STATE_KEY)).toBe(false);

    await target.backup.markChanged();
    await target.backup.sync();
    expect(target.cloud.account.file).toBeNull();
  });
});

describe("vault reset", () => {
  it("turns backup off on this device and leaves the file in the account", async () => {
    const target = await backedUp();
    await target.lifecycle.resetAllWallets();
    expect((await target.backup.status()).enabled).toBe(false);
    expect(target.cloud.account.file).not.toBeNull();
  });
});
