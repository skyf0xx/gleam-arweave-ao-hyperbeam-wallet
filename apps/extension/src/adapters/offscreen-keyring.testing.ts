import { Keyring } from "@gleam/core/signer";
import type { KeyringEnvelope, KeyringResponse } from "@gleam/messaging/src/keyring-protocol.ts";
import { keepKeyringConnected, type KeyringDocumentPort } from "../keyring/server";
import {
  isKeyringSender,
  type KeyringBackgroundPort,
  type KeyringPortSender,
  type OffscreenHost,
  type OffscreenKeyring,
} from "./offscreen-keyring";

export const IDENTITY = { extensionId: "gleam-id", keyringUrl: "chrome-extension://gleam-id/keyring.html" };

const wire = <T>(message: T): T => JSON.parse(JSON.stringify(message)) as T;

/**
 * Stands in for `chrome.offscreen` and `runtime.connect`. A created
 * document runs the real `keepKeyringConnected` over a fresh `Keyring`;
 * its connection reaches `OffscreenKeyring.accept` as Chrome's
 * `runtime.onConnect` would. Messages go through JSON as Chrome's do, and
 * what the background posts on its end reaches only that port's opener.
 */
export class FakeOffscreen implements OffscreenHost {
  keyring: OffscreenKeyring | null = null;
  document: { id: string; ports: Array<() => void>; receivers: KeyringBackgroundPort[] } | null = null;
  creates = 0;
  connectKeyring = true;
  private documents = 0;

  async hasDocument() {
    return this.document !== null;
  }

  async createDocument() {
    this.creates += 1;
    await Promise.resolve();
    if (this.document) throw new Error("Only a single offscreen document may be created.");
    const document = {
      id: `doc-${++this.documents}`,
      ports: [] as Array<() => void>,
      receivers: [] as KeyringBackgroundPort[],
    };
    this.document = document;
    if (!this.connectKeyring) return;
    keepKeyringConnected(
      {
        connect: ({ name }) => {
          const { opener, receiver, closeFromOpener } = this.open(name, {
            id: "gleam-id",
            url: IDENTITY.keyringUrl,
            documentId: document.id,
          });
          document.ports.push(closeFromOpener);
          document.receivers.push(receiver);
          return opener;
        },
      },
      new Keyring(),
      { schedule: (run, delayMs) => void setTimeout(() => this.document === document && run(), delayMs) },
    );
  }

  async closeDocument() {
    if (!this.document) throw new Error("No current offscreen document.");
    const { ports } = this.document;
    this.document = null;
    ports.forEach((close) => close());
  }

  async isKeyringSender(sender: KeyringPortSender | undefined) {
    return isKeyringSender(sender, IDENTITY, this.document ? [this.document.id] : []);
  }

  /** A connection from some extension context, delivered to the background's `onConnect`. */
  open(name: string, sender: KeyringPortSender) {
    const toOpener: Array<(message: unknown) => void> = [];
    const toReceiver: Array<(message: unknown) => void> = [];
    const openerGone: Array<() => void> = [];
    const receiverGone: Array<() => void> = [];
    let open = true;
    const close = (listeners: Array<() => void>) => {
      if (!open) return;
      open = false;
      queueMicrotask(() => listeners.forEach((listener) => listener()));
    };
    const opener: KeyringDocumentPort = {
      postMessage: (message: KeyringResponse) => {
        const copy = wire(message);
        queueMicrotask(() => open && toReceiver.forEach((listener) => listener(copy)));
      },
      onMessage: { addListener: (listener) => void toOpener.push(listener) },
      onDisconnect: { addListener: (listener) => void openerGone.push(listener) },
    };
    const posted: KeyringEnvelope[] = [];
    const receiver: KeyringBackgroundPort = {
      name,
      sender,
      postMessage: (message: KeyringEnvelope) => {
        if (!open) throw new Error("Attempting to use a disconnected port object");
        posted.push(message);
        const copy = wire(message);
        queueMicrotask(() => open && toOpener.forEach((listener) => listener(copy)));
      },
      disconnect: () => close(openerGone),
      onMessage: { addListener: (listener) => void toReceiver.push(listener) },
      onDisconnect: { addListener: (listener) => void receiverGone.push(listener) },
    };
    void this.keyring?.accept(receiver);
    return { opener, receiver, posted, closeFromOpener: () => close(receiverGone), isOpen: () => open };
  }
}
