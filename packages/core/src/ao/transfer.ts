import type { JWKInterface } from "../models/wallet";

/**
 * Mirrors `arweave/transfer.ts`'s shape exactly (see that module's doc
 * comment for why every function here takes an already-decrypted `jwk`
 * rather than a password or wallet id): pure, no `chrome.*`/window/document
 * dependency, no `core/vault` import.
 *
 * Connection convention: per this task's INHERITED DECISIONS, aoconnect's
 * `connect({MODE:'mainnet', URL, device:'process@1.0'})` speaks the same
 * `~process@1.0` HyperBEAM device-path vocabulary `ao/balance.ts` already
 * reads against directly with `fetch`. `balance.ts` doesn't go through
 * aoconnect at all (a plain unauthenticated read has no reason to), but a
 * transfer is a *signed* message post — exactly what aoconnect's
 * `message`/`result` pair exists for — so this module is the first real
 * consumer of the aoconnect dependency `core-design.md` already names.
 * `URL` is the caller's `NetworkSettings.activePeerUrl`, the same HyperBEAM
 * peer `getTokenBalance` reads from, so both paths target one peer, not two
 * independently-configured ones.
 *
 * `@permaweb/aoconnect` is imported dynamically inside `buildClient`, not
 * as a static top-level import: its Node build (`dist/index.js`, the
 * `import` condition Vite resolves) transitively pulls in `axios`, whose
 * browser-env-detection module (`axios/lib/platform/common/utils.js`)
 * unconditionally reads `window.location.href` at module-evaluation time.
 * WXT's background-entrypoint discovery pass runs that module graph
 * through Vite's Node-side module runner to generate the manifest — a
 * context where `window` is a partial stub with no `location` — and a
 * static import crashes that build step outright ("Cannot read properties
 * of undefined (reading 'href')") before a single real transfer ever
 * runs. A dynamic `import()` defers evaluation to genuine runtime (inside
 * a real browser's service worker, where `window.location` exists), which
 * both `pnpm wxt build` and every real send call round-trip cleanly. This
 * is a real upstream-dependency env-detection bug (same class as the
 * `arbundles/web` Node-import issue `core-design.md`'s Correction
 * Protocol log already documents), not a design choice — a
 * `wxt.config.ts`-level fix (module aliasing/polyfill, mirroring that
 * same log's `vite-plugin-node-polyfills` fix) would be the more durable
 * resolution, but that file is outside this task's ALLOWED SCOPE; see
 * this task's final report.
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
 * nothing in AO-Core's `~process@1.0` vocabulary quotes a sender-side fee
 * before posting. Rather than inventing a fabricated `0` or a
 * plausible-looking placeholder, this is made explicit: there is no fee
 * quote for this path, and callers should carry `TransferDraft.fee` as
 * `null` for every AO transfer, matching its `Winston | null` shape.
 */
export const AO_TRANSFER_HAS_NO_FEE = true;

/**
 * Builds, signs, and posts an AO `Transfer` message to `processId` via
 * aoconnect's `message`. `amount` is an atomic-integer string in the
 * token's own smallest unit (matching `TokenBalance.quantity`'s shape) —
 * never a floating-point number.
 *
 * What "submitted" means here: aoconnect's `message()` resolves once the
 * Messenger Unit has accepted and scheduled the signed data item, returning
 * its id — it is not a guarantee the token process has executed the
 * `Transfer` handler yet, nor that the recipient's balance has updated.
 * That is a materially weaker guarantee than AR's `transactions.post`,
 * which the gateway either accepts or rejects synchronously for the exact
 * transaction being submitted. Callers writing an optimistic activity entry
 * from this result should treat status as "message accepted by the MU",
 * not "transfer confirmed" — this module does not additionally await
 * `result()` to confirm CU-side execution, since doing so would block the
 * caller on AO's scheduling latency the same way AR's `submitTransfer`
 * never has to.
 */
export async function submitTransfer(
  peerUrl: string,
  jwk: JWKInterface,
  processId: string,
  recipient: string,
  amount: string,
): Promise<SubmittedAoTransfer> {
  const { message, createDataItemSigner } = await buildClient(peerUrl, jwk);

  const messageId = await message({
    process: processId,
    signer: createDataItemSigner(jwk),
    tags: [
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

async function buildClient(peerUrl: string, jwk: JWKInterface) {
  const { connect, createDataItemSigner } = await import("@permaweb/aoconnect");
  return {
    message: connect({
      MODE: "mainnet",
      URL: peerUrl,
      device: "process@1.0",
      signer: createDataItemSigner(jwk),
    }).message,
    createDataItemSigner,
  };
}
