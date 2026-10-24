import type { PermissionType } from "./permission";
import type { CollectibleRef } from "./collectible";
import type { HardwareDevice, HardwareWalletMethod } from "./wallet";
import type { AttestationAnswer, ScanResult } from "../scan/attestation";

export type ApprovalKind =
  | "connect"
  | "sign"
  | "dispatch"
  | "signDataItem"
  | "batchSignDataItem"
  | "encrypt"
  | "decrypt"
  | "transferAoTokens"
  | "signMessage"
  | "addToken"
  | "transfer"
  | "pointsProof"
  | "scanAttestation";

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
 *
 * `tokenDenomination` is the decimal-places count for `token`'s atomic
 * amount, resolved the same way a token balance's denomination is (see
 * `ReadsHandler.previewWatchedToken` in `handlers/reads.ts`). `null` when
 * `token` is `null` (AR, always shown via `formatWinstonAsAr` instead) or
 * when that resolution failed/hasn't run — the approval screen then falls
 * back to the raw atomic amount rather than guessing a scale.
 *
 * `tokenTicker` is that same lookup's resolved ticker, shown as the unit
 * label once the amount is scaled. `null` when `token` is `null`, or when
 * the lookup didn't resolve a ticker (falls back to a shortened `token`
 * process id — see `SigningApprovalScreen.tsx`'s `formatAmountUnit`).
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
    | "signMessage"
    | "transfer"
    | "pointsProof";
  recipient: string | null;
  amount: string | null;
  fee: string | null;
  token: string | null;
  tokenDenomination: number | null;
  tokenTicker: string | null;
  /** Set for a wallet `transfer` that sends this collectible; `amount` is then 0 AR. */
  collectible?: CollectibleRef | null;
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

/**
 * The Gleam site asking the wallet to sign a community scan attestation
 * (SCANS.md). Every text field came from an agent's output through a link,
 * so the window shows it as plain text only. Signing proves the wallet
 * vouches for the scan; it signs no transaction and moves nothing.
 */
export interface ScanAttestationApprovalPreview {
  kind: "scanAttestation";
  /** The wallet that signs, and so the one that gets the points. */
  walletId: string;
  address: string;
  /** Lowercase hex SHA-256 of the canonical attestation. */
  attestationId: string;
  /** `gleam-points:attest:v1:<release>:<attestationId>`, what is signed. */
  message: string;
  release: string;
  commit: string;
  model: string;
  challenge: string;
  result: ScanResult;
  answers: AttestationAnswer[];
  report: string;
}

export type ApprovalPreview =
  | ConnectApprovalPreview
  | SigningApprovalPreview
  | AddTokenApprovalPreview
  | ScanAttestationApprovalPreview;

/**
 * The origin of a request Gleam makes for itself: a send from the popup
 * by a hardware wallet, which signs in the approval window like a dApp's
 * request does.
 */
export const WALLET_APPROVAL_ORIGIN = "gleam:wallet";

/**
 * One thing the device signs, as it crosses the messaging boundary. A
 * transaction is the unsigned format-2 JSON (`signature` and `id` empty);
 * a data item is the unsigned ANS-104 bytes, base64url; a message is the
 * `signMessage` data, base64url.
 */
export type DeviceSigningPayload =
  | {
      kind: "transaction";
      transaction: {
        format: number;
        id: string;
        last_tx: string;
        owner: string;
        tags: Array<{ name: string; value: string }>;
        target: string;
        quantity: string;
        data: string;
        data_size: string;
        data_root: string;
        reward: string;
        signature: string;
      };
    }
  | { kind: "dataItem"; raw: string }
  | { kind: "message"; data: string };

/**
 * What a device payload actually says, decoded by the background from the
 * payload itself, so the user confirms the fee and amounts that get
 * signed rather than the estimates the preview showed. Amounts are
 * atomic strings: Winston for a transaction, the token's unit for an AO
 * transfer.
 */
export type DeviceSigningSummary =
  | { kind: "transaction"; recipient: string | null; quantity: string; fee: string; dataSize: string }
  | { kind: "aoTransfer"; process: string; recipient: string; quantity: string }
  /**
   * A zero-AR L1 transaction whose tags move `quantity` of an
   * `arweave-scheduler@1.0` token (`ao/l1-transfer.ts`). `fee` is the AR
   * reward the transaction actually carries.
   */
  | { kind: "l1TokenTransfer"; process: string; recipient: string; quantity: string; fee: string }
  /** A zero-AR L1 transaction whose tags move one collectible (`ao/collectible-transfer.ts`). */
  | { kind: "collectibleTransfer"; asset: string; recipient: string; fee: string }
  | { kind: "dataItem"; target: string | null; dataSize: number }
  /** `text` is the message as UTF-8, or null when it isn't valid text. */
  | { kind: "message"; text: string | null; size: number };

/**
 * What the approval window needs to drive a hardware wallet once the user
 * has approved the preview. The page answers with one base64url
 * signature per payload, in order.
 */
export interface DeviceSigningRequest {
  method: HardwareWalletMethod;
  device: HardwareDevice | null;
  address: string;
  /** The wallet's stored owner (base64url RSA modulus); every payload names it. */
  publicKey: string;
  payloads: DeviceSigningPayload[];
  /** One per payload, in the same order. */
  summaries: DeviceSigningSummary[];
  /** Epoch ms after which the request times out unless the page reports device activity. */
  deadline: number;
}

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
  /** Set once a hardware wallet's request is approved and waits for the device's signatures. */
  device?: DeviceSigningRequest;
}
