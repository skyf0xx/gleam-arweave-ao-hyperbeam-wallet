import type { BackupProvider } from "../models/backup";

/**
 * One file in the user's own cloud account: a Google Drive app folder, or
 * iCloud on iOS. The port moves bytes and knows nothing of their contents;
 * whatever it returns is untrusted until the caller has decrypted it.
 */
export interface CloudFilePort {
  readonly provider: BackupProvider;
  /**
   * Whether the account can be reached. With `interactive` false it never
   * shows UI and resolves false when it would have to.
   */
  signIn(interactive: boolean): Promise<boolean>;
  /** The file and when the account last saw it change, or null when there is none. */
  read(): Promise<{ bytes: Uint8Array<ArrayBuffer>; updatedAt: number } | null>;
  /** Creates the file or replaces its contents. */
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  /** Resolves when the file is gone, including when there was none. */
  remove(): Promise<void>;
  /** Ends this install's access to the account. */
  revoke(): Promise<void>;
}
