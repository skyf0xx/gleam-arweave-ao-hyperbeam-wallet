import { ArweaveSigner } from "@dha-team/arbundles/web";
import type { JWKInterface } from "../models/wallet";

/**
 * An AO `Transfer` is a signed ANS-104 data item posted to a legacynet
 * Messenger Unit via `@permaweb/aoconnect`'s `connect()`/`message()`.
 * `connect({ MODE: "legacy" })` resolves aoconnect's own default MU
 * (`https://mu.ao-testnet.xyz`) with no URL to configure — legacynet
 * MU/CU routing is independent of `NetworkSettings.activePeerUrl`, which
 * selects a HyperBEAM peer for `ao/balance.ts`'s `~process@1.0` reads,
 * an unrelated piece of infrastructure.
 *
 * Tags follow the `ao.TN.1` message protocol
 * (`Data-Protocol`/`Variant`/`Type`/`Action`/`Recipient`/`Quantity`,
 * capitalized) that AO token processes' `Transfer` handler matches on.
 *
 * `@permaweb/aoconnect` is imported dynamically inside `submitTransfer`,
 * not as a static top-level import: its Node build transitively pulls in
 * `axios`, whose browser-env-detection module unconditionally reads
 * `window.location.href` at module-evaluation time, which crashes WXT's
 * background-entrypoint discovery pass (a Node-side module runner where
 * `window` has no `location`). A dynamic `import()` defers evaluation to
 * genuine runtime, where `window.location` exists.
 *
 * Signing does not go through aoconnect's `createDataItemSigner`: its
 * `browser` export condition's signer only accepts an injected wallet
 * (`window.arweaveWallet`), not a raw JWK, and forcing its Node build
 * instead runs `@permaweb/ao-core-libs`'s JWK validation on top of this
 * extension's polyfilled `Buffer`, whose `buffer` package has never
 * implemented the `"base64url"` encoding under real Node — it throws
 * "Invalid base64url encoding in JWK modulus" for a perfectly valid key.
 * `buildJwkSigner` instead matches aoconnect's own `(create, format) => ...`
 * signer contract directly (see its doc comment below), letting aoconnect's
 * `browser` build assemble the ANS-104 item itself and using
 * `@dha-team/arbundles/web`'s `ArweaveSigner` only for the RSA-PSS signing
 * operation, backed by `arweave/web`'s WebCrypto driver.
 */
export interface SubmittedAoTransfer {
  /** The data item id aoconnect returns once the Messenger Unit accepts the message. */
  messageId: string;
}

/**
 * AO token transfers have no `arweave/transfer.ts`-style fee quote to
 * estimate: an AR value-transfer pays a miner fee taken from the sender's
 * own balance, computed up front via the gateway's `price` endpoint. An AO
 * `Transfer` message posts to the token process for the process to execute
 * — the token process (not the sender) bears its own compute cost, and
 * nothing in AO's message protocol quotes a sender-side fee before
 * posting. Rather than inventing a fabricated `0` or a plausible-looking
 * placeholder, this is made explicit: there is no fee quote for this
 * path, and callers should carry `TransferDraft.fee` as `null` for every
 * AO transfer, matching its `Winston | null` shape.
 */
export const AO_TRANSFER_HAS_NO_FEE = true;

/**
 * Builds an aoconnect-compatible signer — `(create, format) => ...` — from
 * a raw JWK, bypassing `createDataItemSigner` (see this module's doc
 * comment). Only the `"ans104"` format is implemented, which is what
 * `message()` requests when posting to the legacynet MU.
 *
 * Mirrors aoconnect's own built-in (Node-only) JWK signer contract: `create`
 * is called with `{ publicKey, type, alg }` and returns the ANS-104 deep
 * hash to sign as a `Uint8Array` — not the full unsigned item — and this
 * returns `{ signature, address }` for aoconnect to embed into the item it
 * assembles itself. Signing the deep hash directly through
 * `ArweaveSigner.sign` (backed by `arweave/web`'s WebCrypto driver) avoids
 * needing `@dha-team/arbundles/web` to build/serialize the item ourselves.
 */
type AoSignerCreate = (args: {
  publicKey: Uint8Array;
  type: number;
  alg: string;
}) => Promise<Uint8Array>;

/**
 * Chrome's WebCrypto `importKey("jwk", ...)` enforces RFC 7518's base64url
 * strictly — no `=` padding, and `-`/`_` in place of `+`/`/` — and rejects
 * the key outright ("The JWK member ... could not be base64url decoded or
 * contained padding") if a field doesn't already comply. Re-encoding every
 * string field defensively here guards against any padded/standard-base64
 * value reaching `ArweaveSigner`, regardless of where in storage/decryption
 * it was introduced.
 */
function normalizeJwkBase64Url(jwk: JWKInterface): JWKInterface {
  const toBase64Url = (value: string) => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const normalized: Record<string, unknown> = { ...jwk };
  for (const key of ["n", "e", "d", "p", "q", "dp", "dq", "qi"]) {
    const value = normalized[key];
    if (typeof value === "string") {
      normalized[key] = toBase64Url(value);
    }
  }
  return normalized as unknown as JWKInterface;
}

function buildJwkSigner(rawJwk: JWKInterface) {
  const jwk = normalizeJwkBase64Url(rawJwk);
  const arweaveSigner = new ArweaveSigner(jwk);
  const publicKey = new Uint8Array(arweaveSigner.publicKey);

  return async (create: unknown, format: unknown) => {
    if (format !== "ans104") {
      throw new Error(`buildJwkSigner only supports the "ans104" signer format, got "${JSON.stringify(format)}".`);
    }

    const deepHash = await (create as AoSignerCreate)({ publicKey, type: 1, alg: "rsa-v1_5-sha256" });
    const signature = await arweaveSigner.sign(deepHash);
    // The Arweave wallet address is the SHA-256 digest of the raw public
    // key (the RSA modulus), not the public key itself.
    const address = new Uint8Array(await crypto.subtle.digest("SHA-256", publicKey));

    return { signature, address };
  };
}

/**
 * Builds, signs, and posts an AO `Transfer` message to `processId` via
 * aoconnect's `message()`, targeting aoconnect's own default legacynet
 * Messenger Unit. `amount` is an atomic-integer string in the token's own
 * smallest unit (matching `TokenBalance.quantity`'s shape) — never a
 * floating-point number. `processId` and `recipient` must be valid
 * 43-character base64url Arweave addresses (32 raw bytes) — aoconnect
 * rejects anything else when building the data item's `target`/`Recipient`
 * tag.
 *
 * What "submitted" means here: aoconnect's `message()` resolves once the
 * Messenger Unit has accepted and scheduled the signed data item,
 * returning its id — it is not a guarantee the token process has
 * executed the `Transfer` handler yet, nor that the recipient's balance
 * has updated. Callers writing an optimistic activity entry from this
 * result should treat status as "message accepted by the MU", not
 * "transfer confirmed".
 */
export async function submitTransfer(
  jwk: JWKInterface,
  processId: string,
  recipient: string,
  amount: string,
): Promise<SubmittedAoTransfer> {
  // "@permaweb/aoconnect/browser" ships no types for its subpath export
  // (only the package root's `.d.ts` is published); the root export's
  // `connect` signature is otherwise identical, so it's reused here purely
  // for typing.
  // @ts-expect-error -- see comment above; no declaration file for this subpath
  const { connect }: typeof import("@permaweb/aoconnect") = await import("@permaweb/aoconnect/browser");
  const signer = buildJwkSigner(jwk);
  const ao = connect({ MODE: "legacy" });

  const messageId = await ao.message({
    process: processId,
    signer,
    tags: [
      { name: "Data-Protocol", value: "ao" },
      { name: "Variant", value: "ao.TN.1" },
      { name: "Type", value: "Message" },
      { name: "Action", value: "Transfer" },
      { name: "Recipient", value: recipient },
      { name: "Quantity", value: amount },
    ],
  });

  if (typeof messageId !== "string") {
    throw new Error(
      `Unexpected aoconnect message() result for process "${processId}": expected a message id string, got ${JSON.stringify(messageId)}.`,
    );
  }

  return { messageId };
}
