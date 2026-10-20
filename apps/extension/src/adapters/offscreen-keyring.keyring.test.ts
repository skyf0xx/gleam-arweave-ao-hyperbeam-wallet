import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildUnsignedDataItem,
  createSignedDataItem,
  verifyDataItemSignature,
} from "@gleam/core/src/arweave/data-item.ts";
import {
  applyTransactionSignature,
  buildUnsignedTransaction,
  signTransactionWithSigner,
} from "@gleam/core/src/arweave/transaction.ts";
import { clientForGateway } from "@gleam/core/src/arweave/client.ts";
import {
  encrypt,
  type JWKInterface,
} from "@gleam/core";
import { Keyring, KeyringLockedError, signerFromKeyStore, generateJWK } from "@gleam/core/signer";
import { KEYRING_PORT_NAME, type KeyringEnvelope, type KeyringResponse } from "@gleam/messaging/src/keyring-protocol.ts";
import { keepKeyringConnected, type KeyringDocumentPort } from "../keyring/server";
import {
  isKeyringSender,
  OffscreenKeyring,
  type KeyringBackgroundPort,
  type KeyringPortSender,
  type OffscreenHost,
} from "./offscreen-keyring";

const IDENTITY = { extensionId: "gleam-id", keyringUrl: "chrome-extension://gleam-id/keyring.html" };

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

const wire = <T>(message: T): T => JSON.parse(JSON.stringify(message)) as T;

/**
 * Stands in for `chrome.offscreen` and `runtime.connect`. A created
 * document runs the real `keepKeyringConnected` over a fresh `Keyring`;
 * its connection reaches `OffscreenKeyring.accept` as Chrome's
 * `runtime.onConnect` would. Messages go through JSON as Chrome's do, and
 * what the background posts on its end reaches only that port's opener.
 */
class FakeOffscreen implements OffscreenHost {
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

let jwk: JWKInterface;

beforeAll(async () => {
  jwk = await generateJWK();
}, 60_000);

describe("OffscreenKeyring", () => {
  let host: FakeOffscreen;
  let keyring: OffscreenKeyring;

  beforeEach(() => {
    host = new FakeOffscreen();
    keyring = new OffscreenKeyring(host, { requestMs: 1_000, connectMs: 200 });
    host.keyring = keyring;
  });

  it("signs a transaction arweave-js verifies, through the document", async () => {
    await keyring.importKey("wallet-a", jwk);
    const signer = signerFromKeyStore(keyring, "wallet-a", { address: "address-a", owner: jwk.n });
    const unsigned = await buildUnsignedTransaction("https://arweave.net", jwk.n, {
      target: "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI",
      quantity: "1000",
      reward: "5000",
      last_tx: "b".repeat(64),
    });

    const { transaction } = await applyTransactionSignature(unsigned, await signTransactionWithSigner(unsigned, signer), jwk.n);

    const arweave = clientForGateway("https://arweave.net");
    await expect(arweave.transactions.verify(arweave.transactions.fromRaw(transaction))).resolves.toBe(true);
  });

  it("signs an ANS-104 data item that verifies, through the document", async () => {
    await keyring.importKey("wallet-a", jwk);
    const signer = signerFromKeyStore(keyring, "wallet-a", { address: "address-a", owner: jwk.n });
    const fields = { data: bytes("ao message"), target: "", anchor: "", tags: [{ name: "Action", value: "Transfer" }] };

    const { raw } = await createSignedDataItem(signer, fields);

    await expect(verifyDataItemSignature(buildUnsignedDataItem(jwk.n, fields), raw.subarray(2, 514), jwk.n)).resolves.toBe(true);
  });

  it("decrypts with a label, through the document", async () => {
    await keyring.importKey("wallet-a", jwk);
    const label = bytes("ctx");
    const ciphertext = new Uint8Array(await encrypt(jwk.n, bytes("secret"), { name: "RSA-OAEP", label: label.buffer }));

    const plaintext = await keyring.decrypt("wallet-a", ciphertext, label);

    expect(new TextDecoder().decode(plaintext)).toBe("secret");
  });

  it("creates the document once for concurrent imports", async () => {
    await Promise.all([keyring.importKey("wallet-a", jwk), keyring.importKey("wallet-b", jwk)]);

    expect(host.creates).toBe(1);
    expect(await keyring.has(["wallet-a", "wallet-b"])).toEqual(["wallet-a", "wallet-b"]);
  });

  it("carries on when another create already made the document", async () => {
    const create = host.createDocument.bind(host);
    await create();
    vi.spyOn(host, "hasDocument").mockResolvedValueOnce(false);

    await keyring.importKey("wallet-a", jwk);

    expect(await keyring.has(["wallet-a"])).toEqual(["wallet-a"]);
  });

  it("never creates the document just to read, sign or clear", async () => {
    expect(await keyring.has(["wallet-a"])).toEqual([]);
    await expect(keyring.sign("wallet-a", { hash: "SHA-256", saltLength: 32 }, bytes("x"))).rejects.toBeInstanceOf(
      KeyringLockedError,
    );
    await keyring.remove("wallet-a");
    await keyring.clear();

    expect(host.creates).toBe(0);
  });

  it("closes the document on clear", async () => {
    await keyring.importKey("wallet-a", jwk);

    await keyring.clear();

    expect(host.document).toBeNull();
    expect(await keyring.has(["wallet-a"])).toEqual([]);
  });

  it("reads a document that vanished (closed by Chrome, crashed) as locked", async () => {
    await keyring.importKey("wallet-a", jwk);
    await host.closeDocument();

    expect(await keyring.has(["wallet-a"])).toEqual([]);
    await expect(keyring.sign("wallet-a", { hash: "SHA-256", saltLength: 32 }, bytes("x"))).rejects.toBeInstanceOf(
      KeyringLockedError,
    );
  });

  it("reports a wallet the document has no key for as locked", async () => {
    await keyring.importKey("wallet-a", jwk);

    await expect(keyring.sign("wallet-b", { hash: "SHA-256", saltLength: 32 }, bytes("x"))).rejects.toBeInstanceOf(
      KeyringLockedError,
    );
  });

  it("refuses a rogue context that connects with the keyring's port name, and never sends it an import", async () => {
    const rogue = host.open(KEYRING_PORT_NAME, { id: "gleam-id", url: "chrome-extension://gleam-id/approval.html", tab: { id: 3 } });

    await keyring.importKey("wallet-a", jwk);
    await keyring.has(["wallet-a"]);

    expect(rogue.isOpen()).toBe(false);
    expect(rogue.posted).toEqual([]);
  });

  it("waits for the keyring to connect after creating the document", async () => {
    await keyring.importKey("wallet-a", jwk);

    expect(await keyring.has(["wallet-a"])).toEqual(["wallet-a"]);
  });

  it("fails a request when the keyring never connects", async () => {
    host.connectKeyring = false;

    await expect(keyring.importKey("wallet-a", jwk)).rejects.toThrow("didn't connect");
  });

  it("fails a request in flight when the port drops, as locked", async () => {
    await keyring.importKey("wallet-a", jwk);
    const signing = keyring.sign("wallet-a", { hash: "SHA-256", saltLength: 32 }, bytes("x"));
    host.document!.ports.forEach((close) => close());

    await expect(signing).rejects.toBeInstanceOf(KeyringLockedError);
  });

  it("serves the keyring again after the service worker restarts", async () => {
    await keyring.importKey("wallet-a", jwk);
    const restarted = new OffscreenKeyring(host, { requestMs: 1_000, connectMs: 500 });
    host.keyring = restarted;

    host.document!.receivers.forEach((port) => port.disconnect());

    await vi.waitFor(async () => expect(await restarted.has(["wallet-a"])).toEqual(["wallet-a"]));
  });

  it("uses the new document's port after the document is recreated", async () => {
    await keyring.importKey("wallet-a", jwk);
    await keyring.clear();

    await keyring.importKey("wallet-b", jwk);

    expect(host.creates).toBe(2);
    expect(await keyring.has(["wallet-a", "wallet-b"])).toEqual(["wallet-b"]);
  });
});

describe("isKeyringSender", () => {
  it("accepts the keyring document", () => {
    expect(isKeyringSender({ id: "gleam-id", url: IDENTITY.keyringUrl, documentId: "doc-1" }, IDENTITY, ["doc-1"])).toBe(true);
    expect(isKeyringSender({ id: "gleam-id", url: IDENTITY.keyringUrl }, IDENTITY, [])).toBe(true);
  });

  it.each<[string, KeyringPortSender | undefined]>([
    ["no sender", undefined],
    ["a content script", { id: "gleam-id", url: "https://evil.example/", tab: { id: 4 } }],
    ["a tab showing the keyring page", { id: "gleam-id", url: IDENTITY.keyringUrl, tab: { id: 4 } }],
    ["the popup", { id: "gleam-id", url: "chrome-extension://gleam-id/popup.html" }],
    ["the side panel", { id: "gleam-id", url: "chrome-extension://gleam-id/sidepanel.html" }],
    ["another extension", { id: "other-id", url: IDENTITY.keyringUrl }],
    ["a keyring URL in a document that isn't the offscreen one", { id: "gleam-id", url: IDENTITY.keyringUrl, documentId: "doc-9" }],
  ])("refuses %s", (_, sender) => {
    expect(isKeyringSender(sender, IDENTITY, ["doc-1"])).toBe(false);
  });
});
