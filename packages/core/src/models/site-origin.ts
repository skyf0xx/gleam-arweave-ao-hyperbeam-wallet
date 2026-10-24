export const SITE_URL = "https://gleamwallet.app/";

/** The only origin `externally_connectable` lets message a production build. */
export const SITE_ORIGIN = new URL(SITE_URL).origin;

/**
 * Hosts a development build also takes site messages from, on any port,
 * so a local copy of the site (`attest.html`) can be tested before it
 * deploys. `wxt.config.ts` adds them to `externally_connectable` only in
 * development mode, and `isSiteOrigin` accepts them only when the
 * runtime is told it is a development build.
 */
export const DEV_SITE_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];
