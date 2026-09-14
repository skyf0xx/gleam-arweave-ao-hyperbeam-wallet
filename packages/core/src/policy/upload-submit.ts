import { ArweaveSigner, createData } from "@dha-team/arbundles/web";
import type { JWKInterface } from "../models/wallet";
import type { UploadTag } from "../models/upload";

/**
 * Scope note (reported per this task's packet): this file builds and
 * submits an ANS-104 `DataItem` via `@dha-team/arbundles`, which is
 * genuinely `core/arweave`-shaped work, not "policy" — but this task's
 * ALLOWED SCOPE only grants `packages/core/src/policy/**`, with no
 * `core/arweave/**`-style grant or new core submodule glob for it, and
 * `@dha-team/arbundles` (like `arweave-js` for `core/arweave/transfer.ts`)
 * only resolves from inside `packages/core` — `apps/extension` has no
 * dependency on it and `apps/extension/package.json` is outside this
 * layer's ALLOWED SCOPE to widen (the same "shared workspace config, no
 * layer owns it" class of gap `onboarding-unlock` hit with
 * `@webext-core/messaging`, per the Correction Protocol log). Housing it
 * here — the one core-scoped directory this task has — was the least-bad
 * option short of silently widening scope; a later pass should relocate
 * this to a proper `core/arweave/upload.ts` (mirroring `transfer.ts`)
 * once that scope exists. Flagged as debt.
 *
 * Signing-capability boundary: mirrors `core/arweave/transfer.ts` and
 * `handlers/transfer.ts` exactly. This module never decrypts anything
 * itself — it accepts an already-decrypted `JWKInterface` and never
 * imports `core/vault`. The caller (`handlers/upload.ts`) is responsible
 * for deriving that key from a password, for the identical reason
 * `transfer.ts`'s doc comment documents: `WalletLifecycleHandler.
 * unlockWallet` never persists derived key material.
 *
 * Imports from `@dha-team/arbundles/web`, not the package root: the
 * package root's Node build pulls in its `file`/`stream` upload helpers
 * (`FileDataItem`, used for large streamed file uploads), which import
 * `axios` — a dependency this package doesn't declare and this project
 * has no use for (uploads here are in-memory `Uint8Array` payloads, not
 * streamed). The `/web` subpath is the browser-safe entry point arbundles
 * itself publishes for exactly this shape of consumer (an MV3 service
 * worker is a browser-like runtime, not Node), and it's the one that
 * actually resolves without a missing-dependency error.
 */

const BUNDLER_TX_ENDPOINT_SUFFIX = "/tx";

export interface SubmittedUpload {
  txId: string;
}

/**
 * Builds an ANS-104 `DataItem` from the draft's payload/tags/license tag,
 * signs it with the caller-supplied JWK, and posts the signed binary to
 * an ANS-104 bundler endpoint (`up.arweave.net` by default — CLAUDE.md
 * item 7's "or equivalent").
 *
 * Bundler response-shape caveat (reported per this task's packet):
 * ARCHITECTURE.md §7.4 lists "Bundler POST — exact endpoint, headers, and
 * success/error shapes for `up.arweave.net`" as one of the sibling
 * repo's own *unresolved* spikes ("Code samples we don't have"), not
 * settled knowledge this build can port. This function posts the raw
 * signed DataItem binary to `<bundlerUrl>/tx` with
 * `Content-Type: application/octet-stream`, the documented ANS-104
 * bundler convention, and treats any non-2xx response as failure — but
 * the *exact* success-body shape (e.g. whether it echoes `{ id }` or just
 * 200s) is unverified against a live bundler and should be confirmed
 * before this is trusted in production. The DataItem's own locally
 * computed `id` is used as the returned `txId` rather than trusting a
 * bundler response field, since ANS-104 ids are deterministic from the
 * signed binary and don't require the bundler to echo one back.
 */
export async function submitUploadToBundler(
  bundlerUrl: string,
  jwk: JWKInterface,
  data: Uint8Array,
  contentType: string,
  tags: UploadTag[],
  licenseTag: UploadTag | null,
): Promise<SubmittedUpload> {
  const signer = new ArweaveSigner(jwk);
  const allTags: UploadTag[] = [
    { name: "Content-Type", value: contentType },
    ...tags,
    ...(licenseTag ? [licenseTag] : []),
  ];

  const dataItem = createData(data, signer, { tags: allTags });
  await dataItem.sign(signer);

  // `getRaw()` returns a Node `Buffer` (arbundles' Node-oriented typing,
  // even via the `/web` entry point) — copied into a plain `Uint8Array`
  // so it satisfies `fetch`'s `BodyInit` typing without depending on
  // `Buffer` structurally matching it, which TS' DOM lib doesn't assume.
  const rawBytes = new Uint8Array(dataItem.getRaw());

  const endpoint = new URL(BUNDLER_TX_ENDPOINT_SUFFIX, bundlerUrl).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: rawBytes,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Failed to submit upload to bundler ${bundlerUrl} (HTTP ${response.status}: ${response.statusText}).`,
    );
  }

  return { txId: dataItem.id };
}
