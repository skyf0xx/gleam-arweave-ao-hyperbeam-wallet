import { GoogleDriveAuth, type GoogleDriveAuthPlugin } from "@gleam/cloud-backup";
import { createGoogleDriveFile, type GoogleAuth } from "@gleam/core/src/backup/google-drive.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import type { CloudFilePort } from "@gleam/core/src/ports/cloud-file.ts";

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Google access tokens for the Drive app folder on Android, from Play
 * services through the `GoogleDriveAuth` plugin. Play services caches the
 * token and renews it, so nothing is stored here.
 */
export function createAndroidGoogleAuth(plugin: GoogleDriveAuthPlugin = GoogleDriveAuth, fetchImpl: typeof fetch = fetch): GoogleAuth {
  async function authorize(interactive: boolean): Promise<string | null> {
    let answer: { accessToken?: unknown };
    try {
      answer = await plugin.authorize({ interactive });
    } catch {
      throw new Error(userErrorMessage("backupUnreachable"));
    }
    const { accessToken } = answer;
    return typeof accessToken === "string" && accessToken.length > 0 ? accessToken : null;
  }

  // One consent screen at a time: callers arriving together want the same answer.
  let consent: Promise<string | null> | null = null;

  return {
    token(interactive) {
      if (!interactive) return authorize(false);
      consent ??= authorize(true).finally(() => {
        consent = null;
      });
      return consent;
    },

    async forget(token) {
      await plugin.clearToken({ token }).catch(() => {});
    },

    async revoke() {
      const token = await authorize(false).catch(() => null);
      if (!token) return;
      // Revoking the token ends the grant on Google's side; the endpoint
      // sends no CORS headers, so the request is what counts.
      await fetchImpl(REVOKE_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }).catch(() => {});
      await plugin.clearToken({ token }).catch(() => {});
    },
  };
}

/** The Drive app-folder file on Android's real plugin. */
export function createAndroidGoogleDriveFile(): CloudFilePort {
  return createGoogleDriveFile(createAndroidGoogleAuth());
}
