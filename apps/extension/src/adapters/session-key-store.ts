import { browser, type Browser } from "wxt/browser";
import type { SessionKeyStorePort } from "@gleam/core";
import {
  isKeyringSender,
  OffscreenKeyring,
  type KeyringBackgroundPort,
  type OffscreenHost,
} from "./offscreen-keyring";

const KEYRING_PATH = "/keyring.html";

async function offscreenDocumentIds(): Promise<string[]> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [browser.runtime.getURL(KEYRING_PATH)],
  });
  return contexts.flatMap((context) => (context.documentId ? [context.documentId] : []));
}

const chromeOffscreenHost: OffscreenHost = {
  async hasDocument() {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [browser.runtime.getURL(KEYRING_PATH)],
    });
    return contexts.length > 0;
  },
  createDocument() {
    return browser.offscreen.createDocument({
      url: KEYRING_PATH,
      // No reason covers "hold keys in memory". WORKERS is the closest:
      // the document is a long-lived worker context that outlives the
      // service worker's idle shutdown. The justification says what it does.
      reasons: ["WORKERS"],
      justification:
        "Holds the unlocked wallet's signing keys in memory, as non-extractable WebCrypto keys, so they are never written to disk. It is closed when the wallet locks.",
    });
  },
  closeDocument() {
    return browser.offscreen.closeDocument();
  },
  async isKeyringSender(sender) {
    const identity = { extensionId: browser.runtime.id, keyringUrl: browser.runtime.getURL(KEYRING_PATH) };
    return isKeyringSender(sender, identity, await offscreenDocumentIds());
  },
};

const keyring = new OffscreenKeyring(chromeOffscreenHost);

/**
 * Lets the keyring document's port in. Call from the background's main
 * function, which runs at the service worker's top level, so the
 * reconnect that wakes the worker finds the listener.
 */
export function listenForKeyringConnections(): void {
  browser.runtime.onConnect.addListener((port: Browser.runtime.Port) => {
    void keyring.accept(port as unknown as KeyringBackgroundPort);
  });
}

/** Unlocked wallets' keys, held in memory by the keyring offscreen document (`entrypoints/keyring/`). */
export const sessionKeyStore: SessionKeyStorePort = keyring;
