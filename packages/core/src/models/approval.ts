import type { PermissionType } from "./permission";

export type ApprovalKind =
  | "connect"
  | "sign"
  | "dispatch"
  | "signDataItem"
  | "batchSignDataItem"
  | "encrypt"
  | "decrypt"
  | "transferAoTokens";

export interface ConnectApprovalPreview {
  kind: "connect";
  requestedPermissions: PermissionType[];
}

/**
 * A decoded-intent preview of a signing request: recipient, amount, fee, a
 * decoded-data preview, tags, and a SHA-256 hash of the exact signing
 * payload (PRD §4 — Signing approval). Fields are optional because not
 * every signing kind carries every field (e.g. `encrypt` has no recipient).
 *
 * `token` identifies which token/denomination `amount`/`fee`'s atomic-integer
 * strings are in — `null` for the native AR token (matching
 * `TransferDraft.token`'s own `null`-means-AR convention), an AO processId
 * otherwise. Only meaningful when `amount` is non-null; every non-transfer
 * signing kind (`sign`/`dispatch`/`signDataItem`/`batchSignDataItem`/
 * `encrypt`/`decrypt`) that carries no amount also carries no token — added
 * for the `transferAoTokens` provider-surface method so its approval window
 * can show which token is being sent instead of a generic "sign this data"
 * preview, closing the debt declared on `AO-TOKEN-SEND-PROVIDER-BRIDGE`.
 */
export interface SigningApprovalPreview {
  kind:
    | "sign"
    | "dispatch"
    | "signDataItem"
    | "batchSignDataItem"
    | "encrypt"
    | "decrypt"
    | "transferAoTokens";
  recipient: string | null;
  amount: string | null;
  fee: string | null;
  token: string | null;
  decodedData: string | null;
  tags: Array<{ name: string; value: string }>;
  payloadHash: string;
}

export type ApprovalPreview = ConnectApprovalPreview | SigningApprovalPreview;

/**
 * A pending action awaiting user sign-off in its own window: a Grant
 * request (connection) or a signing request (PRD §3 Glossary —
 * ApprovalRequest).
 */
export interface ApprovalRequest {
  requestId: string;
  kind: ApprovalKind;
  origin: string;
  createdAt: number;
  preview: ApprovalPreview;
}
