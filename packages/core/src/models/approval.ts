import type { PermissionType } from "./permission";

export type ApprovalKind =
  | "connect"
  | "sign"
  | "dispatch"
  | "signDataItem"
  | "batchSignDataItem"
  | "encrypt"
  | "decrypt"
  | "transferAoTokens"
  | "signature"
  | "signMessage"
  | "privateHash"
  | "addToken";

/**
 * A dApp's self-reported identity, passed to `connect()` per the ArConnect
 * `AppInfo` shape. Untrusted — shown to the user alongside the origin
 * (which is authoritative), never in place of it. `null` fields render as
 * the origin-derived fallback `ConnectionRequestScreen` already used.
 */
export interface ConnectAppInfo {
  name: string | null;
  logo: string | null;
}

export interface ConnectApprovalPreview {
  kind: "connect";
  requestedPermissions: PermissionType[];
  appInfo: ConnectAppInfo | null;
}

/**
 * A decoded-intent preview of a signing request: recipient, amount, fee, a
 * decoded-data preview, tags, and a SHA-256 hash of the exact signing
 * payload. Fields are optional because not every signing kind carries
 * every field (e.g. `encrypt` has no recipient).
 *
 * `token` identifies which token/denomination `amount`/`fee`'s atomic-integer
 * strings are in — `null` for the native AR token (matching
 * `TransferDraft.token`'s own `null`-means-AR convention), an AO processId
 * otherwise. Only meaningful when `amount` is non-null.
 */
export interface SigningApprovalPreview {
  kind:
    | "sign"
    | "dispatch"
    | "signDataItem"
    | "batchSignDataItem"
    | "encrypt"
    | "decrypt"
    | "transferAoTokens"
    | "signature"
    | "signMessage"
    | "privateHash";
  recipient: string | null;
  amount: string | null;
  fee: string | null;
  token: string | null;
  decodedData: string | null;
  tags: Array<{ name: string; value: string }>;
  payloadHash: string;
  /**
   * Every item `signDataItem`/`batchSignDataItem` will sign, in order —
   * so a `batchSignDataItem` approval isn't just item 1's
   * `decodedData`/`tags`. `null` for every other kind.
   */
  items: Array<{
    decodedData: string | null;
    tags: Array<{ name: string; value: string }>;
    target: string | null;
    payloadHash: string;
  }> | null;
}

/**
 * A dApp asking to add an AO token to the active wallet's token list.
 * Metadata is resolved by the background before the window opens, so the
 * user sees what the process claims to be, not just its id. A field the
 * process didn't resolve is `null`.
 */
export interface AddTokenApprovalPreview {
  kind: "addToken";
  processId: string;
  ticker: string | null;
  name: string | null;
  /** The address whose token list the token joins. */
  address: string;
}

export type ApprovalPreview = ConnectApprovalPreview | SigningApprovalPreview | AddTokenApprovalPreview;

/**
 * A pending action awaiting user sign-off in its own window: a Grant
 * request (connection) or a signing request.
 */
export interface ApprovalRequest {
  requestId: string;
  kind: ApprovalKind;
  origin: string;
  createdAt: number;
  preview: ApprovalPreview;
}
