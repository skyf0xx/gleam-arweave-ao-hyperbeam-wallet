import {
  base64ToBytes,
  bytesToBase64,
  KeyringLockedError,
  zeroize,
  type MessageHashAlgorithm,
  type SessionKeyStorePort,
} from "@gleam/core";
import {
  KEYRING_PORT_NAME,
  type KeyringReply,
  type KeyringRequest,
  type KeyringResponse,
  type KeyringResults,
} from "@gleam/messaging/src/keyring-protocol.ts";

/**
 * The keyring offscreen document's side of `keyring-protocol.ts`. Plain
 * functions over minimal port shapes so they can be tested without a
 * browser; `entrypoints/keyring/main.ts` connects them to `browser.runtime`.
 */

export interface KeyringDocumentPort {
  postMessage(message: KeyringResponse): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface KeyringDocumentRuntime {
  connect(connectInfo: { name: string }): KeyringDocumentPort;
}

export interface ReconnectOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  schedule?: (run: () => void, delayMs: number) => void;
}

/**
 * Keeps one port open to the background for as long as this document
 * lives. Chrome drops it whenever the service worker stops, so it is
 * reopened, with backoff in case the background keeps refusing it; the
 * reconnect itself wakes the worker.
 *
 * The background vets this port's sender before it sends anything, and
 * what it posts reaches only this document. What this document posts
 * goes to every context that accepted the connection: the background,
 * plus any other extension page that listens on `runtime.onConnect` and
 * keeps the port, which no Gleam page does. Such a page could also post
 * requests here, since an opener can't tell its receivers apart. Both are
 * the "compromised extension code" case of the threat model: it can see
 * signatures and decrypted plaintexts and ask for more, but it can never
 * receive the key itself.
 */
export function keepKeyringConnected(
  runtime: KeyringDocumentRuntime,
  keyring: SessionKeyStorePort,
  { minDelayMs = 100, maxDelayMs = 2_000, schedule = (run, delayMs) => void setTimeout(run, delayMs) }: ReconnectOptions = {},
): void {
  let delayMs = minDelayMs;
  const open = () => {
    const port = runtime.connect({ name: KEYRING_PORT_NAME });
    port.onMessage.addListener((message) => {
      delayMs = minDelayMs;
      void serveKeyringEnvelope(keyring, message).then((response) => {
        if (response === null) return;
        try {
          port.postMessage(response);
        } catch {
          // The port dropped mid-request; the background has already failed the request.
        }
      });
    });
    port.onDisconnect.addListener(() => {
      schedule(open, delayMs);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    });
  };
  open();
}

/** Answers one envelope, or null when it has no usable id to answer to. */
export async function serveKeyringEnvelope(keyring: SessionKeyStorePort, message: unknown): Promise<KeyringResponse | null> {
  if (message === null || typeof message !== "object") return null;
  const { id, request } = message as Record<string, unknown>;
  if (!Number.isSafeInteger(id)) return null;
  return { id: id as number, reply: await serveKeyringRequest(keyring, request) };
}

const HASHES: readonly MessageHashAlgorithm[] = ["SHA-256", "SHA-384", "SHA-512"];

/** Answers one request. Never throws: every failure becomes an `{ ok: false }` reply. */
export async function serveKeyringRequest(keyring: SessionKeyStorePort, message: unknown): Promise<KeyringReply> {
  const request = parseRequest(message);
  if (request === null) return { ok: false, error: "Malformed keyring request." };
  try {
    return { ok: true, result: await run(keyring, request) };
  } catch (error) {
    if (error instanceof KeyringLockedError) return { ok: false, error: error.message, locked: true };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    // JS strings can't be overwritten, so deleting the fields only drops
    // this realm's references; the strings stay in memory until garbage
    // collection. The key itself now lives only in non-extractable CryptoKeys.
    if (request.op === "import") {
      for (const field of Object.keys(request.jwk)) delete (request.jwk as unknown as Record<string, unknown>)[field];
    }
  }
}

async function run(keyring: SessionKeyStorePort, request: KeyringRequest): Promise<KeyringResults[KeyringRequest["op"]]> {
  switch (request.op) {
    case "import":
      await keyring.importKey(request.walletId, request.jwk);
      return null;
    case "sign": {
      const signature = await keyring.sign(
        request.walletId,
        { hash: request.hash, saltLength: request.saltLength },
        base64ToBytes(request.data),
      );
      return bytesToBase64(signature);
    }
    case "decrypt": {
      const label = request.label === undefined ? undefined : base64ToBytes(request.label);
      const plaintext = await keyring.decrypt(request.walletId, base64ToBytes(request.data), label);
      try {
        return bytesToBase64(plaintext);
      } finally {
        zeroize(plaintext);
      }
    }
    case "has":
      return keyring.has(request.walletIds);
    case "remove":
      await keyring.remove(request.walletId);
      return null;
    case "clear":
      await keyring.clear();
      return null;
  }
}

function parseRequest(message: unknown): KeyringRequest | null {
  if (message === null || typeof message !== "object") return null;
  const value = message as Record<string, unknown>;
  const walletId = typeof value.walletId === "string" && value.walletId !== "" ? value.walletId : null;
  switch (value.op) {
    case "import": {
      const jwk = value.jwk as Record<string, unknown> | null | undefined;
      if (walletId === null || jwk === null || typeof jwk !== "object") return null;
      if (typeof jwk.n !== "string" || typeof jwk.e !== "string" || typeof jwk.d !== "string") return null;
      return { op: "import", walletId, jwk: jwk as unknown as Extract<KeyringRequest, { op: "import" }>["jwk"] };
    }
    case "sign": {
      const { hash, saltLength, data } = value;
      if (walletId === null || typeof data !== "string") return null;
      if (!HASHES.includes(hash as MessageHashAlgorithm)) return null;
      if (!Number.isSafeInteger(saltLength) || (saltLength as number) < 0) return null;
      return { op: "sign", walletId, hash: hash as MessageHashAlgorithm, saltLength: saltLength as number, data };
    }
    case "decrypt": {
      const { data, label } = value;
      if (walletId === null || typeof data !== "string") return null;
      if (label !== undefined && typeof label !== "string") return null;
      return label === undefined ? { op: "decrypt", walletId, data } : { op: "decrypt", walletId, data, label };
    }
    case "has": {
      const { walletIds } = value;
      if (!Array.isArray(walletIds) || !walletIds.every((id) => typeof id === "string")) return null;
      return { op: "has", walletIds: walletIds as string[] };
    }
    case "remove":
      return walletId === null ? null : { op: "remove", walletId };
    case "clear":
      return { op: "clear" };
    default:
      return null;
  }
}
