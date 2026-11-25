import {
  base64ToBytes,
  type AddTokenApprovalPreview,
  type ApprovalRequest,
  type ConnectAppInfo,
  type ConnectApprovalPreview,
  type PermissionType,
  type ScanAttestationApprovalPreview,
  type SigningApprovalPreview,
} from "@gleam/core";
import { buildAttestMessage } from "@gleam/core/src/points/index.ts";
import { attestationId, parseAttestation, type ParsedAttestation } from "@gleam/core/src/scan/attestation.ts";
import { readAoTransferMessage } from "@gleam/core/src/ao/transfer-message.ts";
import { COLLECTIBLE_TRANSFER_QUANTITY } from "@gleam/core/src/ao/collectible-transfer.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { safeSiteIconUrl } from "./site-wallet";
import { dappError } from "../dapp-error";
import type { AddTokenRequestInput, SigningRequestInput } from "./approval-types";
import { textDecoder } from "./approval-prepared";

export function previewCollectibleId(preview: ApprovalRequest["preview"], index = 0): string | null {
  if ("collectible" in preview && preview.collectible) return preview.collectible.id;
  // A data-item preview names a collectible per item, not at the top level;
  // payloads run in the same order as the items, so the index picks it.
  if ("items" in preview) return preview.items?.[index]?.transfer?.collectible?.id ?? null;
  return null;
}

/** The stored attestation, checked again: the brand doesn't survive storage. */
export function parsedAttestationOf(input: SigningRequestInput): ParsedAttestation {
  const parsed = parseAttestation(input.attestation);
  if (!parsed.ok) throw new Error(userErrorMessage("attestationInvalid"));
  return parsed.attestation;
}

/*
 * The window shows the start of the text and offers the rest on request
 * (`getApprovalData`), decoded from the stored payload. A full copy in the
 * preview would be stored a second time beside the payload and count
 * against `PENDING_BYTES_PER_ORIGIN`. The payload and `payloadHash` cover
 * every byte either way.
 */
const DATA_PREVIEW_CHARS = 4096;

export function decodeText(payload: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
  } catch {
    return null;
  }
}

function dataPreview(payload: Uint8Array): { decodedData: string | null; dataTruncated?: true } {
  const text = decodeText(payload);
  if (text === null) return { decodedData: null };
  if (text.length <= DATA_PREVIEW_CHARS) return { decodedData: text };
  const cut = /[\uD800-\uDBFF]/.test(text[DATA_PREVIEW_CHARS - 1]!) ? DATA_PREVIEW_CHARS - 1 : DATA_PREVIEW_CHARS;
  return { decodedData: `${text.slice(0, cut)}…`, dataTruncated: true };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildAddTokenPreview(input: AddTokenRequestInput): AddTokenApprovalPreview {
  return {
    kind: "addToken",
    processId: input.processId,
    ticker: input.ticker,
    name: input.name,
    address: input.address,
  };
}

/** What the window shows is derived from the attestation, and the message it signs must be the one for it. */
export async function buildScanAttestationPreview(
  input: SigningRequestInput & { walletId: string },
): Promise<ScanAttestationApprovalPreview> {
  if (!input.address) throw new Error(dappError("A scan attestation request needs its signing wallet."));
  const attestation = parsedAttestationOf(input);
  const id = await attestationId(attestation);
  const message = buildAttestMessage(attestation.release, id);
  if (textDecoder.decode(input.payload) !== message) {
    throw new Error(userErrorMessage("attestationMessageMismatch"));
  }
  return {
    kind: "scanAttestation",
    walletId: input.walletId,
    address: input.address,
    attestationId: id,
    message,
    release: attestation.release,
    commit: attestation.commit,
    model: attestation.model,
    challenge: attestation.challenge,
    result: attestation.result,
    answers: attestation.answers,
    report: attestation.report,
  };
}

export function buildConnectPreview(
  requestedPermissions: PermissionType[],
  appInfo: ConnectAppInfo | null,
): ConnectApprovalPreview {
  // The approval window would fetch the page's logo as given, so it gets the
  // same filter as the icon kept on the grant: no plaintext http fetch.
  return { kind: "connect", requestedPermissions, appInfo: appInfo && { ...appInfo, logo: safeSiteIconUrl(appInfo.logo) } };
}

/**
 * `signDataItem`/`batchSignDataItem` carry every item in `input.dataItems`
 * (`input.payload`/`input.tags` are only item 1's, kept for every other
 * kind's single-payload preview) — decodes each one so the approval window
 * can list them all rather than showing item 1 while the rest sign unseen.
 */
async function buildDataItemPreviews(
  dataItems: NonNullable<SigningRequestInput["dataItems"]>,
  tokenMetadata: SigningRequestInput["itemTokenMetadata"],
): Promise<SigningApprovalPreview["items"]> {
  return Promise.all(
    dataItems.map(async (item, index) => {
      const bytes = base64ToBytes(item.data);
      const tags = item.tags ?? [];
      const transfer = readAoTransferMessage({ target: item.target, tags });
      const metadata = tokenMetadata?.[index] ?? null;
      // A collectible's transfer of 1 shows as that collectible, as the
      // L1 path already does, not as 1 raw unit of an unknown token.
      const collectible =
        transfer?.kind === "transfer" && metadata?.collectible && transfer.quantity === COLLECTIBLE_TRANSFER_QUANTITY
          ? { id: transfer.processId }
          : null;
      return {
        ...dataPreview(bytes),
        dataSize: bytes.byteLength,
        tags,
        target: item.target ?? null,
        payloadHash: await sha256Hex(bytes),
        transfer:
          transfer?.kind === "transfer"
            ? {
                token: transfer.processId,
                recipient: transfer.recipient,
                amount: transfer.quantity,
                tokenDenomination: metadata?.tokenDenomination ?? null,
                tokenTicker: metadata?.tokenTicker ?? null,
                ...(collectible ? { collectible } : {}),
                ...(metadata?.impersonating ? { tokenImpersonating: true as const } : {}),
              }
            : null,
        ...(transfer?.kind === "unreadable" ? { unreadableTokenTransfer: true } : {}),
      };
    }),
  );
}

export async function buildSigningPreview(input: SigningRequestInput): Promise<SigningApprovalPreview> {
  if (input.kind === "scanAttestation") throw new Error(dappError("A scan attestation has its own preview."));
  const payloadHash = await sha256Hex(input.payload);
  const signedItems =
    input.kind === "signDataItem"
      ? input.dataItems?.slice(0, 1)
      : input.kind === "batchSignDataItem"
        ? input.dataItems
        : undefined;
  return {
    kind: input.kind,
    recipient: input.recipient ?? null,
    amount: input.amount ?? null,
    fee: input.fee ?? null,
    token: input.token ?? null,
    tokenDenomination: input.tokenDenomination ?? null,
    tokenTicker: input.tokenTicker ?? null,
    ...(input.collectible ? { collectible: input.collectible } : {}),
    ...(input.nameTarget ? { nameTarget: input.nameTarget } : {}),
    ...(input.unreadableTokenTransfer ? { unreadableTokenTransfer: true } : {}),
    ...(input.tokenImpersonating ? { tokenImpersonating: true } : {}),
    ...dataPreview(input.payload),
    dataSize: input.payload.byteLength,
    tags: input.tags ?? [],
    payloadHash,
    items: signedItems ? await buildDataItemPreviews(signedItems, input.itemTokenMetadata) : null,
  };
}
