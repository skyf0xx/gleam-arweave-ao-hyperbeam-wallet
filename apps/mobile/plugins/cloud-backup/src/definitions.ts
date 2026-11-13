/**
 * Android: access tokens for the Drive app folder from Google Play
 * services' `AuthorizationClient`. Google matches the app to its Android
 * OAuth client by package name and signing certificate, so no client id
 * is passed. The only scope is `drive.appdata`.
 */
export interface GoogleDriveAuthPlugin {
  /**
   * A token, or none. With `interactive` false it never shows UI and
   * returns none when consent is needed; with it true, none means the
   * person closed the consent screen.
   */
  authorize(options: { interactive: boolean }): Promise<{ accessToken?: string }>;
  /** Drops `token` from Play services' cache, so the next `authorize` fetches a new one. */
  clearToken(options: { token: string }): Promise<void>;
}

/** iOS: one record in the private CloudKit database of `iCloud.app.gleamwallet`. */
export interface ICloudFilePlugin {
  /** Whether an iCloud account is signed in and reachable. Never shows UI. */
  available(): Promise<{ available: boolean }>;
  /** The record's bytes as base64 and its server modification time in ms, or neither when there is no record. */
  read(): Promise<{ data?: string; modifiedAt?: number }>;
  /** Creates the record or replaces its bytes. */
  write(options: { data: string }): Promise<void>;
  /** Deletes the record; resolves when there was none. */
  remove(): Promise<void>;
}

/**
 * The `code` a rejected call carries. Anything else, or no code, is a
 * failure the caller reports as unreachable.
 */
export const CLOUD_ERROR = {
  /** iOS: no iCloud account, or iCloud Drive is off for the app. */
  notSignedIn: "NOT_SIGNED_IN",
  /** Both: the network or the service didn't answer. */
  unreachable: "UNREACHABLE",
} as const;
