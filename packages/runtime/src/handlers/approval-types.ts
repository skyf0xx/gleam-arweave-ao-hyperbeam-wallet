import {
  type CollectibleRef,
  type ApprovalKind,
  type ConnectAppInfo,
  type DataItemInput,
  type EncryptAlgorithm,
  type NameTargetPreview,
  type NameTargetRequest,
  type PermissionType,
  type UnsignedPayload,
} from "@gleam/core";
import { type Attestation, type ParsedAttestation } from "@gleam/core/src/scan/attestation.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import type { AttestationCheck } from "@gleam/messaging/src/protocol.ts";
import type { OwnershipProof } from "./points";
import type { SubmitTransferRequest } from "./transfer";

/** A signing request's decoded intent — the input to `describeIntent`-style preview building. */
export interface SigningRequestInput {
  kind: Exclude<ApprovalKind, "connect" | "addToken">;
  /** Present for value-transfer-shaped calls (`sign` a transfer, `dispatch`, `transferAoTokens`). */
  recipient?: string | null;
  amount?: string | null;
  fee?: string | null;
  /**
   * Identifies which token `amount`/`fee` are denominated in — `null` for the
   * native AR token, an AO processId otherwise. Only ever set for
   * `transferAoTokens` today (see `SigningApprovalPreview.token`'s own doc
   * comment); every other signing kind carries no token.
   */
  token?: string | null;
  /**
   * Decimal-places count for `token`'s atomic `amount` — resolved by the
   * dispatcher the same way a token balance's denomination is (`ReadsHandler.
   * previewWatchedToken`) before calling `requestApproval`. `undefined`/`null`
   * when `token` is `null` or that resolution failed; the approval screen
   * then falls back to the raw atomic amount (see `SigningApprovalPreview.
   * tokenDenomination`'s own doc comment).
   */
  tokenDenomination?: number | null;
  /**
   * `token`'s resolved ticker from that same lookup — the unit label shown
   * once the amount is scaled by `tokenDenomination`. `undefined`/`null`
   * when `token` is `null` or the lookup didn't resolve a ticker (see
   * `SigningApprovalPreview.tokenTicker`'s own doc comment).
   */
  tokenTicker?: string | null;
  /** A wallet `transfer` of this collectible: an L1 transaction to its process carrying the transfer tags. */
  collectible?: CollectibleRef | null;
  /** A `setNameTarget`'s name and new target; `fee` is then the reward plus the 1 winston the set carries. */
  nameTarget?: NameTargetPreview | null;
  /** See `SigningApprovalPreview.unreadableTokenTransfer`. */
  unreadableTokenTransfer?: boolean;
  /** See `SigningApprovalPreview.tokenImpersonating`. */
  tokenImpersonating?: boolean;
  /** Raw bytes this request will sign/encrypt/decrypt, for the payload hash and decoded preview. */
  payload: Uint8Array;
  tags?: Array<{ name: string; value: string }>;
  /** `true` when the review screen must escalate to Irreversible-tier framing. */
  firstSeenOrHighRisk?: boolean;
  /**
   * Gateway URL `sign`/`dispatch` need to construct an arweave-js client
   * (for `last_tx`/reward defaults and, for `dispatch`, posting a `BASE`
   * transaction) — resolved by the dispatcher from `ReadsHandler.
   * getNetworkSettings()` at call time, since `ApprovalHandler` itself has
   * no network-settings storage access of its own.
   */
  gatewayUrl?: string;
  /** Bundler a bundled `dispatch` posts to, from the same settings read; the handler's own default otherwise. */
  bundlerUrl?: string;
  /** `sign`/`dispatch`'s transaction-shaped fields beyond `payload`/`tags` — `target`/`quantity`/`reward`/`last_tx`. */
  target?: string;
  quantity?: string;
  reward?: string;
  last_tx?: string;
  /** `signDataItem`/`batchSignDataItem`'s items. `payload` and `tags` above are the first item's, for the preview. */
  dataItems?: DataItemInput[];
  /**
   * Display-only token metadata for each `dataItems` entry that is an AO
   * transfer, by index; never signed. The transfer itself is read from
   * the item. `collectible` is set when the process is a collectible
   * rather than a token, so a transfer of 1 previews as that collectible.
   */
  itemTokenMetadata?: Array<{
    tokenDenomination: number | null;
    tokenTicker: string | null;
    collectible?: boolean;
    impersonating?: boolean;
  } | null>;
  /** `encrypt`/`decrypt`'s WebCrypto algorithm parameter. */
  encryptAlgorithm?: EncryptAlgorithm;
  /** `signMessage`'s hash digest selection. */
  hashAlgorithm?: "SHA-256" | "SHA-384" | "SHA-512";
  /**
   * `scanAttestation`'s attestation, as `parseAttestation` returned it.
   * `payload` is then the attest message it signs.
   */
  attestation?: Attestation;
  /** `scanAttestation`'s signing wallet address, for the preview. */
  address?: string;
}

/**
 * The `AoTokenTransferRequest` shape a `transferAoTokens` signing approval
 * carries through to `performSigning`, so it can call
 * `TransferHandler.submitTransfer` with exactly the fields that handler
 * needs (`token`/`recipient`/`amount`/`fee`/`walletId`) once the user
 * approves — never re-derived from the decoded preview payload, which is
 * display-only.
 */
export interface AoTransferSigningInput {
  token: string;
  recipient: string;
  amount: string;
}

/**
 * The subset of `TransferHandler` this handler needs to finalize an
 * approved `transferAoTokens` (or wallet `transfer`) request — injected
 * rather than imported directly, so `ApprovalHandler` doesn't need to know
 * how a transfer is actually submitted (mirrors the existing
 * `StoragePort`/`ApprovalPresenterPort` ports-style injection this class
 * already uses). Optional constructor param: every existing call
 * site/test that never exercises a transfer is unaffected.
 */
export interface AoTransferSubmitter {
  submitTransfer(req: SubmitTransferRequest): Promise<{ txId: string }>;
}

/** The `TransferHandler` steps a hardware wallet's transfer is split into around the device signature. */
export interface DeviceTransferSubmitter {
  prepareDeviceTransfer(req: SubmitTransferRequest, ownerB64Url: string): Promise<UnsignedPayload>;
  /** Posts the transfer and writes its activity entry. */
  finishDeviceTransfer(
    req: SubmitTransferRequest,
    unsigned: UnsignedPayload,
    signature: Uint8Array,
    expectedOwner: string,
  ): Promise<{ txId: string }>;
}

/** The `TransferHandler` steps a hardware wallet's name change is split into around the device signature. */
export interface DeviceNameTargetSubmitter {
  prepareDeviceNameTarget(req: NameTargetRequest, ownerB64Url: string): Promise<UnsignedPayload>;
  finishDeviceNameTarget(
    req: NameTargetRequest,
    unsigned: UnsignedPayload,
    signature: Uint8Array,
    expectedOwner: string,
  ): Promise<{ txId: string }>;
}

export type TransferSubmitter = AoTransferSubmitter & Partial<DeviceTransferSubmitter> & Partial<DeviceNameTargetSubmitter>;

/**
 * The `PointsHandler` steps a scan attestation needs. A keyfile signs and
 * submits in one call; a hardware wallet signs in this window, then hands
 * its proof over.
 */
export interface ScanAttestationSubmitter {
  attest(req: { walletId: string; attestation: ParsedAttestation }): Promise<SiteAttestResponse>;
  submitAttestation(attestation: ParsedAttestation, proof: OwnershipProof): Promise<SiteAttestResponse>;
  check(attestation: ParsedAttestation, address?: string): Promise<AttestationCheck>;
}

/**
 * Thrown to whoever awaits a request the user rejected, closed or let time
 * out, as opposed to one that was approved and then failed.
 */
export class ApprovalDeclinedError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean,
  ) {
    super(message);
    this.name = "ApprovalDeclinedError";
  }
}

/** A hardware wallet's verified signature over the Gleam Points ownership transaction. */
export interface PointsDeviceProof {
  owner: string;
  address: string;
  signature: string;
}

/** A wallet send handed to the approval window, with the token metadata its preview shows. */
export interface WalletTransferRequest extends SubmitTransferRequest {
  tokenDenomination?: number | null;
  tokenTicker?: string | null;
  /** See `SigningApprovalPreview.tokenImpersonating`. */
  tokenImpersonating?: boolean;
}

/** The subset of `ReadsHandler` an approved `addToken` request writes through. */
export interface TokenWatchList {
  addWatchedToken(req: { address: string; processId: string }): Promise<unknown>;
}

/** Metadata is resolved by the caller, which has network settings; this handler has none. */
export interface AddTokenRequestInput {
  kind: "addToken";
  address: string;
  processId: string;
  ticker: string | null;
  name: string | null;
}

export interface ConnectRequestInput {
  kind: "connect";
  requestedPermissions: PermissionType[];
  /** Omitted by callers (tests, internal re-grants) that have no dApp-supplied identity. */
  appInfo?: ConnectAppInfo | null;
  /** The requesting tab's favicon, kept on the grant when `appInfo` has no logo. */
  favIconUrl?: string | null;
}

/**
 * A `connect` may arrive before any wallet exists: the approval window
 * runs onboarding first, and the grant goes to whichever wallet is active
 * when the user approves.
 */
export type CreateApprovalInput =
  | ({ origin: string; walletId: string | null } & ConnectRequestInput)
  | ({ origin: string; walletId: string } & SigningRequestInput)
  | ({ origin: string; walletId: string } & AddTokenRequestInput);

export type WalletApprovalInput = CreateApprovalInput extends infer U
  ? U extends unknown
    ? Omit<U, "origin" | "payload" | "tags"> & { payload?: Uint8Array }
    : never
  : never;
