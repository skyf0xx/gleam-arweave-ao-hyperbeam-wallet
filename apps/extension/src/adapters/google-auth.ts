import { browser, type Browser } from "wxt/browser";
import type { StoragePort } from "@gleam/core";
import { GOOGLE_DRIVE_SCOPE, type GoogleAuth } from "@gleam/core/src/backup/google-drive.ts";

type IdentityApi = Pick<typeof Browser.identity, "launchWebAuthFlow" | "getRedirectURL">;

/**
 * Gleam's OAuth client in Google Cloud ("Gleam extension", a Web
 * application client). Not a secret: the implicit flow has none, and the
 * client only answers to this extension's `chromiumapp.org` redirect.
 */
export const GOOGLE_OAUTH_CLIENT_ID = "468692447028-k4kle830782v3ap76li6gjck784sj8it.apps.googleusercontent.com";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * The access token, kept for its hour so a restarted service worker
 * doesn't sign in again for every write. It opens only the app folder,
 * which holds ciphertext, and session storage goes when the browser closes.
 */
const TOKEN_KEY = "session:backupToken";
/** A token this close to expiring is replaced rather than risked on an upload. */
const EXPIRY_MARGIN_MS = 60_000;
/** Google's silent redirect needs its page to load and run; Chrome's default gives up at the first load. */
const SILENT_TIMEOUT_MS = 10_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

function isCachedToken(value: unknown): value is CachedToken {
  if (value === null || typeof value !== "object") return false;
  const { token, expiresAt } = value as Record<string, unknown>;
  return typeof token === "string" && token.length > 0 && typeof expiresAt === "number";
}

export interface GoogleAuthOptions {
  storage: StoragePort;
  identity?: IdentityApi;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Google access tokens for the Drive app folder, through
 * `identity.launchWebAuthFlow`. No Gleam server takes part: Google hands
 * the token straight back to this extension's own redirect URL.
 */
export function createGoogleAuth({ storage, identity = browser.identity, fetchImpl = fetch, now = Date.now }: GoogleAuthOptions): GoogleAuth {
  async function cached(): Promise<CachedToken | null> {
    const stored = await storage.get<unknown>(TOKEN_KEY);
    return isCachedToken(stored) ? stored : null;
  }

  async function signIn(interactive: boolean): Promise<string | null> {
    const state = crypto.randomUUID();
    const url = `${AUTH_URL}?${new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: identity.getRedirectURL(),
      response_type: "token",
      scope: GOOGLE_DRIVE_SCOPE,
      state,
      ...(interactive ? {} : { prompt: "none" }),
    })}`;
    let redirect: string | undefined;
    try {
      redirect = await identity.launchWebAuthFlow(
        interactive ? { url, interactive } : { url, interactive, abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: SILENT_TIMEOUT_MS },
      );
    } catch {
      // Closed by the person, or a silent flow that would have needed them.
      return null;
    }
    if (!redirect) return null;
    const answer = new URLSearchParams(new URL(redirect).hash.slice(1));
    const token = answer.get("access_token");
    const lifetimeSeconds = Number(answer.get("expires_in"));
    // `state` ties the answer to this request, so a redirect made up elsewhere can't plant a token.
    if (answer.get("state") !== state || !token || !Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) return null;
    await storage.set<CachedToken>(TOKEN_KEY, { token, expiresAt: now() + lifetimeSeconds * 1000 });
    return token;
  }

  // One flow at a time: Chrome runs a single auth window, and callers arriving together want the same token.
  let pending: Promise<string | null> | null = null;

  return {
    async token(interactive) {
      const current = await cached();
      if (current && current.expiresAt - EXPIRY_MARGIN_MS > now()) return current.token;
      if (pending) {
        const token = await pending;
        // A silent flow that came back empty doesn't answer for a person who is asking.
        if (token !== null || !interactive) return token;
      }
      pending ??= signIn(interactive).finally(() => {
        pending = null;
      });
      return pending;
    },

    async forget(token) {
      if ((await cached())?.token === token) await storage.remove(TOKEN_KEY);
    },

    async revoke() {
      const current = await cached();
      await storage.remove(TOKEN_KEY);
      if (!current) return;
      // The endpoint sends no CORS headers, so the answer can't be read; the request is what revokes.
      await fetchImpl(REVOKE_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: current.token }),
      }).catch(() => {});
    },
  };
}
