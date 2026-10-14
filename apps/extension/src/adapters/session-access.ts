import { browser } from "wxt/browser";

/**
 * Pins `storage.session`, where unlocked signing keys are cached, to the
 * extension's own pages and service worker. TRUSTED_CONTEXTS is Chrome's
 * default, but stating it here means widening it to content scripts (which
 * run inside web pages) would take a visible change to this line.
 */
export async function restrictSessionStorageToTrustedContexts(): Promise<void> {
  try {
    await browser.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    console.error("Couldn't pin session storage to trusted contexts.");
  }
}
