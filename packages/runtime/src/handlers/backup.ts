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
  planPull,
  pulledItemId,
  readBackupData,
  unwrapWithPasskey,
  writeBackupData,
  type BackupBody,
  type BackupFile,
  type BackupHeader,
  type BackupData,
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
  DEFAULT_ARGON2ID_PARAMS,
  envelopeNeedsUpgrade,
  type EncryptOptions,
} from "@gleam/core/signer";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { dappError } from "../dapp-error";
import { updateStored } from "../storage-update";
import { BACKUP_KEY, BACKUP_STATE_KEY, WALLETS_KEY } from "../storage-keys";
import { loadWallets } from "../stored-data";
import { loadBackupKey, loadBackupState, updateBackupState, type BackupState, type StoredBackupKey } from "./backup-state";
import type { KeySession } from "./key-session";

type Bytes = Uint8Array<ArrayBuffer>;

/** How often an unlocked install with no change of its own looks for other devices' additions. */
export const PULL_EVERY_MS = 5 * 60_000;
/** Writes tried in a row while another install keeps replacing this one's copy. */
const MAX_WRITE_ATTEMPTS = 3;

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
  /** A pull writes the wallets under the session lock, as every other wallet write does. */
  session: Pick<KeySession, "withSessionLock" | "isVaultLocked">;
  now?: () => number;
}

/** What a restore opens the backup with: the vault password, or a passkey's answer for one in the file's header. */
export type RestoreRequest = { password: string } | { credentialId: string; prfOutput: string };

/** What the UI needs to ask for one of the header's passkeys. */
export interface FoundBackup {
  found: boolean;
  passkeys: { credentialId: string; prfSalt: string }[];
}

type WriteOutcome = "written" | "current" | "off" | "locked" | "signIn" | "missing" | "otherPassword";

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
  private readonly session: BackupHandlerDeps["session"];
  private readonly now: () => number;
  /** In memory: a stopped worker pulls on its first tick back. */
  private lastPullAt = Number.NEGATIVE_INFINITY;
  /** One cloud operation at a time: two writes racing would each drop what the other read. */
  private readonly inTurn = createSerializer();

  constructor({ storage, sessionKeys, cloudFile, vault, session, now = Date.now }: BackupHandlerDeps) {
    this.storage = storage;
    this.sessionKeys = sessionKeys;
    this.cloudFile = cloudFile;
    this.vault = vault;
    this.session = session;
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
   * second device adds its vault to the same file. A backup this password
   * can't open is refused, since it may be another vault's only copy; a
   * file that isn't a backup at all is replaced.
   */
  async setUp(req: { password: string }): Promise<BackupStatus> {
    const cloud = this.requireCloud();
    await this.vault.checkVaultPassword(req);
    await this.inTurn(async () => {
      await this.signIn(cloud);
      const remote = await cloud.read();
      const file = remote ? decodeBackupFile(remote.bytes) : null;
      const joined = file ? await this.joinBackup(file, req.password) : null;
      if (file && !joined) throw new Error(userErrorMessage("backupOtherPassword"));
      const stored = joined ?? (await this.newBackup(req.password));
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

  /** "Sync", and the sign-in button: pulls and writes with the account's sign-in allowed. */
  async syncNow(): Promise<BackupStatus> {
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
   * Pulls other devices' additions and writes the backup, with no UI:
   * when the vault changed since the last write, when `pull` asks, or
   * every few minutes. Does nothing while a problem only the user can clear
   * stands, or while Gleam is locked; a change stays recorded for the next
   * call.
   */
  async sync({ pull = false }: { pull?: boolean } = {}): Promise<void> {
    const state = await loadBackupState(this.storage);
    if (!state || state.problem !== null) return;
    if (state.dirtyAt === null && !pull && this.now() - this.lastPullAt < PULL_EVERY_MS) return;
    if (await this.session.isVaultLocked()) return;
    await this.write({ interactive: false });
  }

  /**
   * Stops syncing on this install alone: forgets the backup key and state
   * and leaves the file, which other devices may still share. The account's
   * sign-in is kept, since revoking a Google grant would sign those devices
   * out too.
   */
  async stopSyncing(): Promise<BackupStatus> {
    await this.inTurn(async () => {
      await this.storage.remove(BACKUP_KEY);
      await this.storage.remove(BACKUP_STATE_KEY);
      await this.sessionKeys.removeBackupKey();
    });
    return this.status();
  }

  /** Deletes the file for every device, ends this install's access to the account and forgets the backup key. */
  async deleteBackup(): Promise<BackupStatus> {
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
      if (!(await this.vaultIsEmpty())) throw dappError("A backup restores only onto an empty vault.");
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

      // Checked again under the lock wallets are added under: one may have
      // been added while the backup was being opened.
      await this.session.withSessionLock(async () => {
        if (!(await this.vaultIsEmpty())) throw dappError("A backup restores only onto an empty vault.");
        try {
          await writeBackupData(this.storage, mergeBackupDevices(body.devices));
        } catch {
          throw new Error(userErrorMessage("backupFileCorrupt"));
        }
        await this.storage.setMany({
          [BACKUP_KEY]: { backupId, wrapped } satisfies StoredBackupKey,
          [BACKUP_STATE_KEY]: { writer: newBackupId(), lastWriteAt: null, dirtyAt: this.now(), problem: null } satisfies BackupState,
        });
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

  private async vaultIsEmpty(): Promise<boolean> {
    return (await loadWallets(this.storage)).length === 0;
  }

  private requireCloud(): CloudFilePort {
    if (!this.cloudFile) throw new Error(userErrorMessage("backupUnavailable"));
    return this.cloudFile;
  }

  private async signIn(cloud: CloudFilePort): Promise<void> {
    if (!(await cloud.signIn(true))) throw new Error(userErrorMessage("backupSignInNeeded"));
  }

  /** The key of a backup already in the account, when `password` opens it. */
  private async joinBackup(file: BackupFile, password: string): Promise<StoredBackupKey | null> {
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
   * Argon2id run. Only an envelope already at the current cost is reused:
   * copying a weaker envelope's params would wrap the backup key — the
   * key to the whole vault backup — below the current cost.
   */
  private async vaultEncryptOptions(): Promise<EncryptOptions> {
    const envelope = (await loadWallets(this.storage))
      .map((wallet) => wallet.encryptedKeyfile)
      .find((candidate): candidate is VaultEnvelopeV2 => candidate?.version === 2);
    if (envelope && !envelopeNeedsUpgrade(envelope)) {
      const { memoryKiB, iterations, parallelism, salt } = envelope;
      return { params: { memoryKiB, iterations, parallelism }, salt };
    }
    return { params: DEFAULT_ARGON2ID_PARAMS };
  }

  /**
   * Writes this install's vault into the account's file. The file has no
   * conditional write, so another install writing at the same moment can
   * replace this one's copy: each write reads the file back, and merges
   * and writes again when its copy isn't there.
   */
  private write({ interactive, alone = false }: WriteOptions): Promise<WriteOutcome> {
    return this.inTurn(async () => {
      const cloud = this.cloudFile;
      const stored = await loadBackupKey(this.storage);
      const state = await loadBackupState(this.storage);
      if (!cloud || !stored || !state) return "off";

      for (let attempt = 1; ; attempt += 1) {
        const startedAt = this.now();
        const retry = attempt > 1;
        let outcome: WriteOutcome;
        let kept: boolean;
        try {
          // A retry keeps the other installs' copies it finds, even after a restore.
          outcome = await this.writeOnce(cloud, stored, state, { interactive, alone: alone && !retry, force: retry, startedAt });
          kept = outcome !== "written" || (await this.ownCopyKept(cloud, stored, state.writer, startedAt));
        } catch (error) {
          if (error instanceof KeyringLockedError) return "locked";
          throw error;
        }
        if (outcome !== "written") return outcome;
        if (!kept && attempt < MAX_WRITE_ATTEMPTS) continue;

        await updateBackupState(this.storage, (current) => ({
          ...current,
          lastWriteAt: startedAt,
          problem: null,
          // A change that landed during the write is not in the file yet,
          // and a copy another install replaced each time is written again.
          dirtyAt: !kept ? this.now() : current.dirtyAt !== null && current.dirtyAt > startedAt ? current.dirtyAt : null,
        }));
        return "written";
      }
    });
  }

  private async writeOnce(
    cloud: CloudFilePort,
    stored: StoredBackupKey,
    state: BackupState,
    { interactive, alone, force, startedAt }: { interactive: boolean; alone: boolean; force: boolean; startedAt: number },
  ): Promise<WriteOutcome> {
    if (!(await cloud.signIn(interactive))) return this.stopped("signIn");
    const remote = await cloud.read();
    // A file that was there and is gone was removed from the account's
    // side. Only a person asking brings it back.
    if (!remote && state.lastWriteAt !== null && !interactive) return this.stopped("missing");
    // Another vault's backup, made under a different password, is never
    // written over: it may be that vault's only copy.
    const remoteFile = remote ? decodeBackupFile(remote.bytes) : null;
    if (remoteFile && remoteFile.header.backupId !== stored.backupId) {
      if (interactive) throw new Error(userErrorMessage("backupOtherPassword"));
      return this.stopped("otherPassword");
    }

    const { [state.writer]: own, ...others } = remote && !alone ? await this.devicesIn(remote.bytes, stored) : {};
    const { add, removed } = planPull(await readBackupData(this.storage), own, Object.values(others));
    const pulled = await this.addPulled(add, stored.backupId);
    if (pulled === null) return "off";
    this.lastPullAt = startedAt;
    if (!pulled && !interactive && !force && state.dirtyAt === null && own !== undefined) return "current";

    const mine: BackupDevice = { updatedAt: startedAt, data: await readBackupData(this.storage) };
    if (Object.keys(removed).length > 0) mine.removed = removed;
    const devices = { ...newestDevices(others, MAX_BACKUP_DEVICES - 1), [state.writer]: mine };
    const stamp = { v: 1, backupId: stored.backupId, updatedAt: startedAt, writer: state.writer } as const;
    const sealed = await this.sessionKeys.sealBackup(encodeBackupBody({ ...stamp, devices }), stored.backupId);
    await cloud.write(encodeBackupFile({ header: { ...stamp, wrapped: stored.wrapped, passkeys: backupPasskeysOf(devices) }, sealed }));
    return "written";
  }

  /**
   * Whether the account's file still holds the copy written at `startedAt`.
   * A file that is gone or became another backup counts as kept: the next
   * write deals with it, and a retry must not fight a delete.
   */
  private async ownCopyKept(cloud: CloudFilePort, stored: StoredBackupKey, writer: string, startedAt: number): Promise<boolean> {
    const back = await cloud.read();
    const file = back && decodeBackupFile(back.bytes);
    if (!file || file.header.backupId !== stored.backupId) return true;
    return (await this.devicesIn(back.bytes, stored))[writer]?.updatedAt === startedAt;
  }

  private async stopped(problem: NonNullable<BackupStatus["problem"]>): Promise<WriteOutcome> {
    await updateBackupState(this.storage, (state) => ({ ...state, problem }));
    return problem;
  }

  /**
   * Adds what `planPull` found to storage, each key merged with its value
   * at write time. Returns whether anything was added, or null when the
   * vault no longer uses `backupId`: a reset or a new setup since this
   * write began, which then has nothing to add or write.
   */
  private async addPulled(add: BackupData, backupId: string): Promise<boolean | null> {
    return this.session.withSessionLock(async () => {
      const current = await loadBackupKey(this.storage);
      if (current?.backupId !== backupId) return null;
      return this.mergePulled(add);
    });
  }

  private async mergePulled(add: BackupData): Promise<boolean> {
    let added = false;
    const merge = async (key: string, items: unknown[]) => {
      const written = await updateStored<unknown[]>(this.storage, key, (current) => {
        const existing = Array.isArray(current) ? current : [];
        const known = new Set(existing.map((item) => pulledItemId(key, item)));
        const fresh = items.filter((item) => !known.has(pulledItemId(key, item)));
        return fresh.length > 0 ? [...existing, ...fresh] : undefined;
      });
      if (written !== undefined) added = true;
    };
    const { [WALLETS_KEY]: wallets, ...rest } = add;
    if (Array.isArray(wallets)) await merge(WALLETS_KEY, wallets.filter(isValidWallet));
    for (const [key, items] of Object.entries(rest)) if (Array.isArray(items)) await merge(key, items);
    return added;
  }

  /**
   * Every install's vault in the account's file. A file that isn't this
   * backup's, or that this key can't open, holds none and is replaced.
   */
  private async devicesIn(bytes: Uint8Array, stored: StoredBackupKey): Promise<Record<string, BackupDevice>> {
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
    return body.devices;
  }
}

function newestDevices(devices: Record<string, BackupDevice>, count: number): Record<string, BackupDevice> {
  return Object.fromEntries(
    Object.entries(devices)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, count),
  );
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
