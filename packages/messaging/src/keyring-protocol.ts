import type { JWKInterface, MessageHashAlgorithm } from "@gleam/core";

/**
 * The wire contract between the background service worker and the
 * keyring offscreen document (`entrypoints/keyring/`), which holds the
 * unlocked wallets' non-extractable keys in memory.
 *
 * Not part of `ProtocolMap`: those messages go out with
 * `runtime.sendMessage`, which every open extension page receives. The
 * keyring instead opens one long-lived `runtime.connect` port named
 * `KEYRING_PORT_NAME` to the background. The background accepts it only
 * from the keyring document and posts requests on its end, which Chrome
 * delivers to the port's opener alone, so the JWK in an `import` reaches
 * only the keyring. Requests and replies share the port and are matched
 * by `id`.
 *
 * Chrome serializes port messages as JSON, so bytes travel as base64.
 */
export const KEYRING_PORT_NAME = "gleam:keyring";

export type KeyringRequest =
  | { op: "import"; walletId: string; jwk: JWKInterface }
  | { op: "sign"; walletId: string; hash: MessageHashAlgorithm; saltLength: number; data: string }
  | { op: "decrypt"; walletId: string; data: string; label?: string }
  | { op: "has"; walletIds: string[] }
  | { op: "remove"; walletId: string }
  | { op: "clear" };

/** What each request's `result` holds on success. */
export interface KeyringResults {
  import: null;
  /** Base64 signature. */
  sign: string;
  /** Base64 plaintext. */
  decrypt: string;
  has: string[];
  remove: null;
  clear: null;
}

export type KeyringReply<Op extends KeyringRequest["op"] = KeyringRequest["op"]> =
  | { ok: true; result: KeyringResults[Op] }
  | { ok: false; error: string; locked?: true };

/** Background → keyring. */
export interface KeyringEnvelope {
  id: number;
  request: KeyringRequest;
}

/** Keyring → background. */
export interface KeyringResponse {
  id: number;
  reply: KeyringReply;
}
