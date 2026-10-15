import {
  base64ToBytes,
  bytesToBase64,
  KeyringLockedError,
  type JWKInterface,
  type RsaPssSignParams,
  type SessionKeyStorePort,
} from "@gleam/core";
import {
  KEYRING_PORT_NAME,
  type KeyringEnvelope,
  type KeyringReply,
  type KeyringRequest,
  type KeyringResults,
} from "@gleam/messaging/src/keyring-protocol.ts";
import type { MessageSenderLike } from "../sender";

type Bytes = Uint8Array<ArrayBuffer>;

export interface KeyringPortSender extends MessageSenderLike {
  id?: string;
  documentId?: string;
}

/** The background's end of a `runtime.onConnect` port. */
export interface KeyringBackgroundPort {
  name: string;
  sender?: KeyringPortSender;
  postMessage(message: KeyringEnvelope): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

/** The `chrome.offscreen` and `chrome.runtime` calls `OffscreenKeyring` needs. */
export interface OffscreenHost {
  hasDocument(): Promise<boolean>;
  createDocument(): Promise<void>;
  closeDocument(): Promise<void>;
  /** Whether a port named `KEYRING_PORT_NAME` really comes from the keyring document. */
  isKeyringSender(sender: KeyringPortSender | undefined): Promise<boolean>;
}

export interface KeyringIdentity {
  extensionId: string;
  /** `runtime.getURL("/keyring.html")`. */
  keyringUrl: string;
}

/**
 * Chrome fills in the sender, so a page can't forge it. A content script
 * has a `tab` and the page's URL; the popup, side panel and approval
 * window have their own URLs; another extension has another id. When
 * Chrome reports a `documentId`, it must also be the live offscreen
 * document's.
 */
export function isKeyringSender(
  sender: KeyringPortSender | undefined,
  identity: KeyringIdentity,
  offscreenDocumentIds: readonly string[],
): boolean {
  if (sender === undefined || sender.id !== identity.extensionId || sender.tab !== undefined) return false;
  if (sender.url !== identity.keyringUrl) return false;
  return sender.documentId === undefined || offscreenDocumentIds.includes(sender.documentId);
}

interface Pending {
  port: KeyringBackgroundPort;
  resolve(result: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * `SessionKeyStorePort` over the keyring offscreen document. The JWK
 * crosses to it once, in `importKey`; afterwards only signatures and
 * plaintexts come back.
 *
 * The keyring connects to the background, not the other way round: a
 * port the background opened would reach every extension page that
 * listens on `runtime.onConnect`, while a message posted on the
 * receiving end reaches only the opener. `accept` vets each incoming
 * port; requests wait for an accepted one.
 *
 * Only `importKey` creates the document. Every other call treats a
 * missing document (closed on lock, or gone after a crash) as "no keys",
 * so a wallet whose keys vanished reads as locked rather than failing.
 */
export class OffscreenKeyring implements SessionKeyStorePort {
  private creating: Promise<void> | null = null;
  private port: KeyringBackgroundPort | null = null;
  private portWaiters: Array<(port: KeyringBackgroundPort) => void> = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    private readonly host: OffscreenHost,
    private readonly timeouts = { requestMs: REQUEST_TIMEOUT_MS, connectMs: CONNECT_TIMEOUT_MS },
  ) {}

  /** For `runtime.onConnect`. Ignores other port names; disconnects an impostor using the keyring's. */
  async accept(port: KeyringBackgroundPort): Promise<void> {
    if (port.name !== KEYRING_PORT_NAME) return;
    let trusted = false;
    try {
      trusted = await this.host.isKeyringSender(port.sender);
    } catch {
      // Treat an unverifiable sender as untrusted.
    }
    if (!trusted) {
      port.disconnect();
      return;
    }
    this.attach(port);
  }

  async importKey(walletId: string, jwk: JWKInterface): Promise<void> {
    await this.ensureDocument();
    await this.request({ op: "import", walletId, jwk });
  }

  async sign(walletId: string, { hash, saltLength }: RsaPssSignParams, data: Bytes): Promise<Bytes> {
    if (!(await this.host.hasDocument())) throw new KeyringLockedError();
    const signature = await this.request({ op: "sign", walletId, hash, saltLength, data: bytesToBase64(data) });
    return base64ToBytes(signature);
  }

  async decrypt(walletId: string, ciphertext: Bytes, label?: Bytes): Promise<Bytes> {
    if (!(await this.host.hasDocument())) throw new KeyringLockedError();
    const request: KeyringRequest = { op: "decrypt", walletId, data: bytesToBase64(ciphertext) };
    if (label !== undefined) request.label = bytesToBase64(label);
    return base64ToBytes(await this.request(request));
  }

  async has(walletIds: readonly string[]): Promise<string[]> {
    if (walletIds.length === 0 || !(await this.host.hasDocument())) return [];
    return this.request({ op: "has", walletIds: [...walletIds] });
  }

  async remove(walletId: string): Promise<void> {
    if (!(await this.host.hasDocument())) return;
    await this.request({ op: "remove", walletId });
  }

  /** Clears the keys, then closes the document, so its whole heap goes too. */
  async clear(): Promise<void> {
    if (!(await this.host.hasDocument())) return;
    try {
      await this.request({ op: "clear" });
    } finally {
      await this.host.closeDocument().catch(async (error: unknown) => {
        if (await this.host.hasDocument()) throw error;
      });
    }
  }

  private attach(port: KeyringBackgroundPort): void {
    // A second keyring connection means the document was recreated or
    // reconnected before the old port's disconnect arrived.
    if (this.port !== null && this.port !== port) {
      const old = this.port;
      this.drop(old);
      try {
        old.disconnect();
      } catch {
        // Already gone.
      }
    }
    this.port = port;
    port.onMessage.addListener((message) => this.settle(port, message));
    port.onDisconnect.addListener(() => this.drop(port));
    const waiters = this.portWaiters;
    this.portWaiters = [];
    waiters.forEach((resolve) => resolve(port));
  }

  /** Fails every request still waiting on `port`: the document closed, crashed or was replaced. */
  private drop(port: KeyringBackgroundPort): void {
    if (this.port === port) this.port = null;
    for (const [id, entry] of this.pending) {
      if (entry.port !== port) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new KeyringLockedError());
    }
  }

  private settle(port: KeyringBackgroundPort, message: unknown): void {
    if (message === null || typeof message !== "object") return;
    const { id, reply } = message as { id?: unknown; reply?: KeyringReply };
    if (typeof id !== "number" || reply === null || typeof reply !== "object") return;
    const entry = this.pending.get(id);
    if (!entry || entry.port !== port) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (reply.ok) entry.resolve(reply.result);
    else entry.reject(reply.locked ? new KeyringLockedError() : new Error(reply.error));
  }

  private waitForPort(): Promise<KeyringBackgroundPort> {
    if (this.port) return Promise.resolve(this.port);
    return new Promise((resolve, reject) => {
      const waiter = (port: KeyringBackgroundPort) => {
        clearTimeout(timer);
        resolve(port);
      };
      const timer = setTimeout(() => {
        this.portWaiters = this.portWaiters.filter((candidate) => candidate !== waiter);
        reject(new Error("Gleam's keyring didn't connect. Lock and unlock Gleam, then try again."));
      }, this.timeouts.connectMs);
      this.portWaiters.push(waiter);
    });
  }

  private async ensureDocument(): Promise<void> {
    if (await this.host.hasDocument()) return;
    // Chrome allows one offscreen document per extension and rejects a
    // second create, so concurrent callers share one attempt, and a
    // rejection is fine when the document exists after all.
    this.creating ??= this.host
      .createDocument()
      .catch(async (error: unknown) => {
        if (!(await this.host.hasDocument())) throw error;
      })
      .finally(() => {
        this.creating = null;
      });
    await this.creating;
  }

  private async request<R extends KeyringRequest>(request: R): Promise<KeyringResults[R["op"]]> {
    const port = await this.waitForPort();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Gleam's keyring didn't answer. Lock and unlock Gleam, then try again."));
      }, this.timeouts.requestMs);
      this.pending.set(id, { port, resolve: resolve as (result: unknown) => void, reject, timer });
      try {
        port.postMessage({ id, request });
      } catch {
        this.drop(port);
      }
    });
  }
}
