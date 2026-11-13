import {
  backupPasskeysOf,
  base64UrlToBytes,
  bodyMatchesHeader,
  createSerializer,
  decodeBackupBody,
  decodeBackupFile,
  encodeBackupBody,
  encodeBackupFile,
  isValidWallet,
  MAX_BACKUP_DEVICES,
  mergeBackupDevices,
  newBackupId,
  readBackupData,
  unwrapWithPasskey,
  writeBackupData,
  type BackupBody,
  type BackupHeader,
  type BackupDevice,
  type BackupStatus,
  type CloudFilePort,
  type SessionKeyStorePort,
  type StoragePort,
  type VaultEnvelopeV2,
} from "@gleam/core";
import {
  importBackupKey,
  KeyringLockedError,
  mintBackupKey,
  openBackup,
  unwrapBackupKey,
  VaultKdfError,
  wrapBackupKey,
  zeroize,
  type EncryptOptions,
} from "@gleam/core/signer";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { dappError } from "../dapp-error";
import { BACKUP_KEY, BACKUP_STATE_KEY, WALLETS_KEY } from "../storage-keys";
import { loadBackupKey, loadBackupState, updateBackupState, type BackupState, type StoredBackupKey } from "./backup-state";

type Bytes = Uint8Array<ArrayBuffer>;

/** The vault operations backup needs. `WalletLifecycleHandler` provides them. */
export interface BackupVault {
  checkVaultPassword(req: { password: string }): Promise<void>;
  unlockWallet(req: { password: string }): Promise<{ unlockedWalletIds: string[] }>;
}

export interface BackupHandlerDeps {
  storage: StoragePort;
  sessionKeys: SessionKeyStorePort;
  /** Absent on a shell with nowhere to keep a backup. */
  cloudFile: CloudFilePort | undefined;
  vault: BackupVault;
  now?: () => number;
}

/** What a restore opens the backup with: the vault password, or a passkey's answer for one in the file's header. */
export type RestoreRequest = { password: string } | { credentialId: string; prfOutput: string };

/** What the UI needs to ask for one of the header's passkeys. */
export interface FoundBackup {
  found: boolean;
  passkeys: { credentialId: string; prfSalt: string }[];
}

type WriteOutcome = "written" | "off" | "locked" | "signIn" | "missing";

interface WriteOptions {
  /** A person asked for this write, so the account may show its sign-in and a removed file is made again. */
  interactive: boolean;
  /** Write this install's vault alone, dropping every other device's copy. */
  alone?: boolean;
}

/**
 * The vault backup: one encrypted file in the user's own cloud account
 * (`core/backup`). The backup key is random; it is stored wrapped under
 * the vault password and held unwrapped only by the keyring, so writes
 * need no password while Gleam is unlocked and nothing here can read it.
 */
export class BackupHandler {
  private readonly storage: StoragePort;
  private readonly sessionKeys: SessionKeyStorePort;
  private readonly cloudFile: CloudFilePort | undefined;
  private readonly vault: BackupVault;
  private readonly now: () => number;
  /** One cloud operation at a time: two writes racing would each drop what the other read. */
  private readonly inTurn = createSerializer();

  constructor({ storage, sessionKeys, cloudFile, vault, now = Date.now }: BackupHandlerDeps) {
    this.storage = storage;
    this.sessionKeys = sessionKeys;
    this.cloudFile = cloudFile;
    this.vault = vault;
    this.now = now;
  }

  async status(): Promise<BackupStatus> {
    const provider = this.cloudFile?.provider ?? null;
    const state = provider && (await loadBackupKey(this.storage)) ? await loadBackupState(this.storage) : null;
    if (!state) return { provider, enabled: false, lastBackupAt: null, problem: null };
    return { provider, enabled: true, lastBackupAt: state.lastWriteAt, problem: state.problem };
  }

  /**
   * Turns backup on and writes the first file. A backup already in the
   * account that this password opens is joined, keeping its key, so a
   * second device adds its vault to the same file. Any other file there is
   * replaced.
   */
  async setUp(req: { password: string }): Promise<BackupStatus> {
    const cloud = this.requireCloud();
    await this.vault.checkVaultPassword(req);
    await this.inTurn(async () => {
      await this.signIn(cloud);
      const remote = await cloud.read();
      const stored = (remote && (await this.joinBackup(remote.bytes, req.password))) ?? (await this.newBackup(req.password));
      const previous = await loadBackupState(this.storage);
      await this.storage.setMany({
        [BACKUP_KEY]: stored,
        [BACKUP_STATE_KEY]: {
          writer: previous?.writer ?? newBackupId(),
          lastWriteAt: null,
          dirtyAt: this.now(),
          problem: null,
        } satisfies BackupState,
      });
    });
    await this.write({ interactive: true });
    return this.status();
  }

  /** "Back up now", and the sign-in button: writes with the account's sign-in allowed. */
  async backUpNow(): Promise<BackupStatus> {
    const outcome = await this.write({ interactive: true });
    if (outcome === "off") throw new Error(userErrorMessage("backupUnavailable"));
    if (outcome === "signIn") throw new Error(userErrorMessage("backupSignInNeeded"));
    return this.status();
  }

  /** Records that the vault changed. The next `sync` writes it. */
  async markChanged(): Promise<void> {
    await updateBackupState(this.storage, (state) => ({ ...state, dirtyAt: this.now() }));
  }

  /**
   * Writes the backup when the vault changed since the last write, with no
   * UI. Does nothing while a problem only the user can clear stands, or
   * while Gleam is locked; the change stays recorded for the next call.
   */
  async sync(): Promise<void> {
    const state = await loadBackupState(this.storage);
    if (!state || state.dirtyAt === null || state.problem !== null) return;
    await this.write({ interactive: false });
  }

  /** Deletes the file, ends this install's access to the account and forgets the backup key. */
  async turnOff(): Promise<BackupStatus> {
    const cloud = this.requireCloud();
    await this.inTurn(async () => {
      await this.signIn(cloud);
      await cloud.remove();
      await cloud.revoke();
      await this.storage.remove(BACKUP_KEY);
      await this.storage.remove(BACKUP_STATE_KEY);
      await this.sessionKeys.removeBackupKey();
    });
    return this.status();
  }

  /**
   * Signs in and reports whether the account holds a backup, and which
   * passkeys can open it, before the restore asks for a password.
   */
  async find(): Promise<FoundBackup> {
    const cloud = this.requireCloud();
    return this.inTurn(async () => {
      await this.signIn(cloud);
      const remote = await cloud.read();
      const file = remote && decodeBackupFile(remote.bytes);
      if (!file) return { found: false, passkeys: [] };
      return { found: true, passkeys: (file.header.passkeys ?? []).map(({ credentialId, prfSalt }) => ({ credentialId, prfSalt })) };
    });
  }

  /**
   * Restores the account's backup onto an empty vault and unlocks it.
   * Nothing is written until the password has opened the backup key and
   * every value has passed its guard. The restored vault is then this
   * install's backup too.
   *
   * `unlockedWalletIds` is empty when the backup restored but its wallets
   * are under another password; the vault is then there, locked.
   */
  async restore(req: RestoreRequest): Promise<{ unlockedWalletIds: string[] }> {
    const cloud = this.requireCloud();
    const password = await this.inTurn(async () => {
      const wallets = await this.storage.get<unknown>(WALLETS_KEY);
      if (Array.isArray(wallets) && wallets.length > 0) throw dappError("A backup restores only onto an empty vault.");
      await this.signIn(cloud);
      const remote = await cloud.read();
      if (!remote) throw new Error(userErrorMessage("backupFileMissing"));
      const file = decodeBackupFile(remote.bytes);
      if (!file) throw new Error(userErrorMessage("backupFileCorrupt"));
      const { backupId, wrapped } = file.header;
      const password = "password" in req ? req.password : await passkeyPassword(file.header, req);

      const raw = await unwrapBackupKey(wrapped, password, backupId).catch((error: unknown) => {
        // A check that couldn't run is not a wrong password.
        if (error instanceof VaultKdfError) throw error;
        // The passkey opened a password from another time: the backup moved on since.
        throw new Error(userErrorMessage("password" in req ? "backupWrongPassword" : "passkeyFailed"));
      });
      let body: BackupBody | null;
      try {
        body = decodeBackupBody(await openBackup(await importBackupKey(raw), file.sealed, backupId));
      } catch {
        body = null;
      } finally {
        zeroize(raw);
      }
      if (!body || !bodyMatchesHeader(body, file.header)) throw new Error(userErrorMessage("backupFileCorrupt"));

      try {
        await writeBackupData(this.storage, mergeBackupDevices(body.devices));
      } catch {
        throw new Error(userErrorMessage("backupFileCorrupt"));
      }
      await this.storage.setMany({
        [BACKUP_KEY]: { backupId, wrapped } satisfies StoredBackupKey,
        [BACKUP_STATE_KEY]: { writer: newBackupId(), lastWriteAt: null, dirtyAt: this.now(), problem: null } satisfies BackupState,
      });
      return password;
    });

    const unlocked = await this.vault.unlockWallet({ password }).catch(() => ({ unlockedWalletIds: [] }));
    // The restored vault is every device's merged. Writing it alone drops the
    // copies of installs that are gone; one still in use adds its own back
    // on its next write.
    await this.write({ interactive: true, alone: true }).catch((error: unknown) => {
      console.error("The first backup after a restore failed; the next change retries it.", error);
    });
    return unlocked;
  }

  private requireCloud(): CloudFilePort {
    if (!this.cloudFile) throw new Error(userErrorMessage("backupUnavailable"));
    return this.cloudFile;
  }

  private async signIn(cloud: CloudFilePort): Promise<void> {
    if (!(await cloud.signIn(true))) throw new Error(userErrorMessage("backupSignInNeeded"));
  }

  /** The key of a backup already in the account, when `password` opens it. */
  private async joinBackup(bytes: Uint8Array, password: string): Promise<StoredBackupKey | null> {
    const file = decodeBackupFile(bytes);
    if (!file) return null;
    const { backupId, wrapped } = file.header;
    let raw: Bytes;
    try {
      raw = await unwrapBackupKey(wrapped, password, backupId);
    } catch {
      return null;
    }
    try {
      await this.sessionKeys.importBackupKey(raw);
    } finally {
      zeroize(raw);
    }
    return { backupId, wrapped };
  }

  private async newBackup(password: string): Promise<StoredBackupKey> {
    const backupId = newBackupId();
    const raw = mintBackupKey();
    try {
      await this.sessionKeys.importBackupKey(raw);
      return { backupId, wrapped: await wrapBackupKey(raw, password, backupId, await this.vaultEncryptOptions()) };
    } finally {
      zeroize(raw);
    }
  }

  /**
   * The salt and cost of a stored wallet's envelope, so the key an unlock
   * derives for the wallets opens the backup key too, with no second
   * Argon2id run.
   */
  private async vaultEncryptOptions(): Promise<EncryptOptions> {
    const wallets = await this.storage.get<unknown>(WALLETS_KEY);
    const envelope = (Array.isArray(wallets) ? wallets : [])
      .filter(isValidWallet)
      .map((wallet) => wallet.encryptedKeyfile)
      .find((candidate): candidate is VaultEnvelopeV2 => candidate?.version === 2);
    if (!envelope) return {};
    const { memoryKiB, iterations, parallelism, salt } = envelope;
    return { params: { memoryKiB, iterations, parallelism }, salt };
  }

  private write({ interactive, alone = false }: WriteOptions): Promise<WriteOutcome> {
    return this.inTurn(async () => {
      const cloud = this.cloudFile;
      const stored = await loadBackupKey(this.storage);
      const state = await loadBackupState(this.storage);
      if (!cloud || !stored || !state) return "off";
      const startedAt = this.now();

      if (!(await cloud.signIn(interactive))) return this.stopped("signIn");
      const remote = await cloud.read();
      // A file that was there and is gone was removed from the account's
      // side. Only a person asking brings it back.
      if (!remote && state.lastWriteAt !== null && !interactive) return this.stopped("missing");

      try {
        const others = remote && !alone ? await this.otherDevices(remote.bytes, stored, state.writer) : {};
        const devices = { ...others, [state.writer]: { updatedAt: startedAt, data: await readBackupData(this.storage) } };
        const stamp = { v: 1, backupId: stored.backupId, updatedAt: startedAt, writer: state.writer } as const;
        const sealed = await this.sessionKeys.sealBackup(encodeBackupBody({ ...stamp, devices }), stored.backupId);
        await cloud.write(encodeBackupFile({ header: { ...stamp, wrapped: stored.wrapped, passkeys: backupPasskeysOf(devices) }, sealed }));
      } catch (error) {
        if (error instanceof KeyringLockedError) return "locked";
        throw error;
      }

      await updateBackupState(this.storage, (current) => ({
        ...current,
        lastWriteAt: startedAt,
        problem: null,
        // A change that landed during the write is not in the file yet.
        dirtyAt: current.dirtyAt !== null && current.dirtyAt > startedAt ? current.dirtyAt : null,
      }));
      return "written";
    });
  }

  private async stopped(problem: NonNullable<BackupStatus["problem"]>): Promise<WriteOutcome> {
    await updateBackupState(this.storage, (state) => ({ ...state, problem }));
    return problem;
  }

  /**
   * The other installs' vaults in the account's file, to carry into the
   * next write. A file that isn't this backup's, or that this key can't
   * open, contributes nothing and is replaced.
   */
  private async otherDevices(bytes: Uint8Array, stored: StoredBackupKey, writer: string): Promise<Record<string, BackupDevice>> {
    const file = decodeBackupFile(bytes);
    if (!file || file.header.backupId !== stored.backupId) return {};
    let body: BackupBody | null;
    try {
      body = decodeBackupBody(await this.sessionKeys.openBackup(file.sealed, stored.backupId));
    } catch (error) {
      if (error instanceof KeyringLockedError) throw error;
      return {};
    }
    if (!body || !bodyMatchesHeader(body, file.header)) return {};
    return Object.fromEntries(
      Object.entries(body.devices)
        .filter(([id]) => id !== writer)
        .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_BACKUP_DEVICES - 1),
    );
  }
}

/** The vault password one of the header's passkeys wraps, opened with that passkey's PRF output. */
async function passkeyPassword(header: BackupHeader, answer: { credentialId: string; prfOutput: string }): Promise<string> {
  const passkey = header.passkeys?.find((candidate) => candidate.credentialId === answer.credentialId);
  if (!passkey) throw new Error(userErrorMessage("passkeyWrongCredential"));
  let prfOutput: Bytes;
  try {
    prfOutput = base64UrlToBytes(answer.prfOutput);
  } catch {
    throw new Error(userErrorMessage("passkeyUnexpectedSecret"));
  }
  try {
    return await unwrapWithPasskey(passkey, prfOutput, passkey.credentialId);
  } finally {
    zeroize(prfOutput);
  }
}
