import { base64UrlToBytes, bytesToBase64Url } from "@gleam/core";

/**
 * WebAuthn ceremonies for passkey unlock. They run on extension pages
 * (`navigator.credentials` doesn't exist in the service worker), so the
 * relying party is this extension's id: a passkey made here only ever
 * works for this install of Gleam.
 *
 * Unlock depends on the PRF extension: the authenticator turns a stored
 * salt into a 32-byte secret only it can compute, after it has verified
 * the user. Gleam never checks the assertion signature, because nothing
 * is unlocked by it; only the PRF output can open the wrapped password.
 */

export type PasskeyErrorReason = "cancelled" | "unsupported" | "failed";

export class PasskeyError extends Error {
  constructor(
    readonly reason: PasskeyErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "PasskeyError";
  }
}

const CEREMONY_TIMEOUT_MS = 120_000;
const UNSUPPORTED_MESSAGE =
  "This passkey can't unlock Gleam. Try another option, like your phone or a different password manager.";

export function passkeysAvailable(): boolean {
  return typeof PublicKeyCredential !== "undefined" && typeof navigator.credentials?.create === "function";
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toPasskeyError(error: unknown): PasskeyError {
  if (error instanceof PasskeyError) return error;
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return new PasskeyError("cancelled", "The passkey request was cancelled or timed out.");
  }
  if (name === "NotSupportedError" || name === "SecurityError") {
    return new PasskeyError("unsupported", "Passkeys aren't available in this browser.");
  }
  return new PasskeyError("failed", "Something went wrong with the passkey. Try again.");
}

function prfFirst(credential: PublicKeyCredential): Uint8Array<ArrayBuffer> | null {
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (!first) return null;
  return new Uint8Array(ArrayBuffer.isView(first) ? first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) : first);
}

async function evaluatePrf(credentialId: string, prfSalt: string): Promise<Uint8Array<ArrayBuffer>> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: "public-key", id: base64UrlToBytes(credentialId) }],
        userVerification: "required",
        timeout: CEREMONY_TIMEOUT_MS,
        extensions: { prf: { eval: { first: base64UrlToBytes(prfSalt) } } },
      },
    });
  } catch (error) {
    throw toPasskeyError(error);
  }
  if (!(credential instanceof PublicKeyCredential)) {
    throw new PasskeyError("cancelled", "The passkey request was cancelled or timed out.");
  }
  const output = prfFirst(credential);
  if (!output) throw new PasskeyError("unsupported", UNSUPPORTED_MESSAGE);
  return output;
}

export interface CreatedPasskey {
  credentialId: string;
  prfSalt: string;
  prfOutput: string;
}

/**
 * Creates a passkey and reads its PRF output. Some authenticators return
 * the output at creation; the rest need a second, immediate assertion,
 * which the user sees as one more verification prompt.
 */
export async function createUnlockPasskey(): Promise<CreatedPasskey> {
  const salt = randomBytes(32);
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: "Gleam" },
        user: { id: randomBytes(16), name: "Gleam wallet", displayName: "Gleam wallet" },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: CEREMONY_TIMEOUT_MS,
        extensions: { prf: { eval: { first: salt } } },
      },
    });
  } catch (error) {
    throw toPasskeyError(error);
  }
  if (!(credential instanceof PublicKeyCredential)) {
    throw new PasskeyError("cancelled", "The passkey request was cancelled or timed out.");
  }

  const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));
  const prfSalt = bytesToBase64Url(salt);
  const prf = credential.getClientExtensionResults().prf;
  if (prf?.enabled === false || prf === undefined) {
    forgetPasskey(credentialId);
    throw new PasskeyError("unsupported", UNSUPPORTED_MESSAGE);
  }

  let output = prfFirst(credential);
  if (!output) {
    try {
      output = await evaluatePrf(credentialId, prfSalt);
    } catch (error) {
      forgetPasskey(credentialId);
      throw error;
    }
  }
  return { credentialId, prfSalt, prfOutput: bytesToBase64Url(output) };
}

/** Asks the user to verify with the enrolled passkey and returns its PRF output (base64url). */
export async function readPasskeyPrf(status: { credentialId: string; prfSalt: string }): Promise<string> {
  return bytesToBase64Url(await evaluatePrf(status.credentialId, status.prfSalt));
}

/**
 * Asks the password manager to delete a passkey Gleam no longer uses, so
 * it doesn't linger in the user's list. Best effort: not every browser
 * supports the signal, and nothing depends on it.
 */
export function forgetPasskey(credentialId: string): void {
  if (typeof PublicKeyCredential === "undefined") return;
  const signal = (
    PublicKeyCredential as unknown as {
      signalUnknownCredential?: (options: { rpId: string; credentialId: string }) => Promise<void>;
    }
  ).signalUnknownCredential;
  if (typeof signal !== "function") return;
  void signal.call(PublicKeyCredential, { rpId: location.hostname, credentialId }).catch(() => undefined);
}
