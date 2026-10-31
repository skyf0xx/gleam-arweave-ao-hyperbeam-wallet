import { z } from "zod";
import {
  PERMISSION_TYPES,
  type ConnectAppInfo,
  type PermissionType,
  type ProviderMethod,
} from "@gleam/core";
import { hasPointsProofTag, isPointsMessage, isValidInviteCode } from "@gleam/core/src/points/index.ts";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import type { CallerTier } from "@gleam/messaging/src/caller.ts";
import { SITE_ATTEST_MESSAGE_TYPE, SITE_ATTEST_STATUS_MESSAGE_TYPE } from "@gleam/messaging/src/site-protocol.ts";
import { attestFailure } from "../handlers/attest-errors";
import {
  readBytes,
  readDataItem,
  readDataItems,
  readEncryptAlgorithm,
  readHashAlgorithm,
  readProcessId,
  readTransaction,
  type ProviderTransaction,
} from "../handlers/provider-params";

/**
 * Every method the background answers, with who may call it, whether it
 * can open an approval window, and the schema its caller-supplied
 * params are parsed with before any handler runs. The dispatcher in
 * `create-runtime.ts` reads nothing else to decide whether
 * a call goes through, so this table is the privilege boundary to audit.
 *
 * - `extension`: this extension's own pages (popup, side panel, approval
 *   and passkey windows). Their params are typed by `ProtocolMap`.
 * - `contentScript`: a web page's content script, about its own tab. The
 *   origin is Chrome's `sender`, never the message body.
 * - `page`: a `window.arweaveWallet` method, relayed through
 *   `providerCall`. Only these are reachable from a web page.
 * - `site`: a message from the Gleam site's own pages over
 *   `externally_connectable` (`SITE_MESSAGES`), never from a dApp.
 */
export type Tier = CallerTier | "page";

/** `ProtocolMap` methods the background pushes to tabs rather than answers. */
type PushMessage = "providerEvent" | "siteWalletMode";

export type BackgroundMessage = Exclude<keyof ProtocolMap, PushMessage>;

export interface ExtensionMethodSpec {
  tier: "extension";
}

export interface ContentScriptMethodSpec<S extends z.ZodType = z.ZodType> {
  tier: "contentScript";
  params: S;
}

export interface PageMethodSpec<S extends z.ZodType = z.ZodType> {
  tier: "page";
  /** Can open an approval window, so it's refused from a plain-http origin. */
  approval: boolean;
  /** Needs an active grant. Only `connect` and `disconnect`, which manage the grant, don't. */
  grant: boolean;
  params: S;
}

/**
 * Wraps a `provider-params` reader so its error message becomes the
 * issue's. The readers carry the page-facing wording dApps already see.
 */
function reader<T>(read: (value: unknown) => T) {
  // `.optional()` first, so a missing key still reaches the reader (which
  // decides whether it's required) and an `undefined` result is accepted.
  return z.unknown().optional().transform((value, ctx): T => {
    try {
      return read(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
      return z.NEVER;
    }
  });
}

/**
 * Gleam Points payloads are signed only by `PointsHandler`. A site holding
 * one could register or remove the wallet in Gleam Points, so a dApp
 * `signMessage` of one is refused before any window opens.
 */
function refusePointsMessage(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (isPointsMessage(data)) {
    throw new Error("Gleam refused this request because Gleam Points messages can only be signed from Gleam itself.");
  }
  return data;
}

/**
 * A hardware wallet's Points proof is a transaction with a `Gleam-Points`
 * tag. Other fields of the proof keep a dApp transaction from matching it
 * too; refusing the tag means a site can't get close to one at all.
 */
function refusePointsProofTag(transaction: ProviderTransaction): ProviderTransaction {
  if (hasPointsProofTag(transaction.tags)) {
    throw new Error("Gleam refused this transaction because a Gleam-Points tag can only be signed from Gleam itself.");
  }
  return transaction;
}

/** Caps `appInfo.name` so an unbounded dApp-supplied string can't break the approval screen's layout. */
const APP_INFO_NAME_MAX_LENGTH = 64;

/**
 * The dApp's own claim of who it is, passed to `connect(permissions,
 * appInfo)` per ArConnect's `AppInfo` shape. Only the two display fields
 * are kept, and only when they're strings, so a malformed payload
 * degrades to `null` (the approval screen's origin-derived fallback)
 * instead of failing the connect.
 */
function readAppInfo(value: unknown): ConnectAppInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { name?: unknown; logo?: unknown };
  const trimmedName = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const name = trimmedName.length > 0 ? trimmedName.slice(0, APP_INFO_NAME_MAX_LENGTH) : null;
  const logo = typeof candidate.logo === "string" ? candidate.logo : null;
  if (name === null && logo === null) return null;
  return { name, logo };
}

/** Unknown permission names are dropped, and asking for none asks for the address. */
function readRequestedPermissions(value: unknown): PermissionType[] {
  const requested = Array.isArray(value)
    ? value.filter(
        (permission): permission is PermissionType =>
          typeof permission === "string" && (PERMISSION_TYPES as readonly string[]).includes(permission),
      )
    : [];
  return requested.length > 0 ? requested : ["ACCESS_ADDRESS"];
}

const TRANSFER_FIELDS_MESSAGE = "transferAoTokens requires token, recipient, and amount.";
const transferField = z.string({ error: TRANSFER_FIELDS_MESSAGE }).min(1, TRANSFER_FIELDS_MESSAGE);
// The recipient and amount go verbatim into the signed Transfer tags, and
// the approval screen can only render an address and an atomic integer
// faithfully, so anything else is refused before a window opens.
const TRANSFER_ADDRESS_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const transferAddress = (field: "token" | "recipient", what: string) =>
  transferField.regex(TRANSFER_ADDRESS_PATTERN, `transferAoTokens: ${field} must be ${what} (43 base64url characters).`);
const transferAmount = transferField.regex(
  /^[1-9]\d*$/,
  "transferAoTokens: amount must be a positive whole number in the token's smallest unit.",
);

/** Methods that only read the grant or the wallet take no params; extra keys are dropped. */
const NO_PARAMS = z.object({});

function page<S extends z.ZodType, const G extends boolean>(spec: {
  approval: boolean;
  grant: G;
  params: S;
}): PageMethodSpec<S> & { grant: G } {
  return { tier: "page", ...spec };
}

export const PAGE_METHODS = {
  connect: page({
    approval: true,
    grant: false,
    params: z.object({
      permissions: reader(readRequestedPermissions),
      appInfo: reader(readAppInfo),
    }),
  }),
  disconnect: page({ approval: false, grant: false, params: NO_PARAMS }),
  getPermissions: page({ approval: false, grant: true, params: NO_PARAMS }),
  getActiveAddress: page({ approval: false, grant: true, params: NO_PARAMS }),
  getAllAddresses: page({ approval: false, grant: true, params: NO_PARAMS }),
  getActivePublicKey: page({ approval: false, grant: true, params: NO_PARAMS }),
  getWalletNames: page({ approval: false, grant: true, params: NO_PARAMS }),
  getArweaveConfig: page({ approval: false, grant: true, params: NO_PARAMS }),
  getBalances: page({ approval: false, grant: true, params: NO_PARAMS }),
  sign: page({
    approval: true,
    grant: true,
    params: z.object({ transaction: reader((value) => refusePointsProofTag(readTransaction(value, "sign"))) }),
  }),
  dispatch: page({
    approval: true,
    grant: true,
    params: z.object({ transaction: reader((value) => refusePointsProofTag(readTransaction(value, "dispatch"))) }),
  }),
  encrypt: page({
    approval: true,
    grant: true,
    params: z.object({
      data: reader((value) => readBytes(value, "data", "utf8")),
      options: reader((value) => readEncryptAlgorithm(value, "encrypt")),
    }),
  }),
  decrypt: page({
    approval: true,
    grant: true,
    params: z.object({
      data: reader((value) => readBytes(value, "data", "reject")),
      options: reader((value) => readEncryptAlgorithm(value, "decrypt")),
    }),
  }),
  signMessage: page({
    approval: true,
    grant: true,
    params: z.object({
      data: reader((value) => refusePointsMessage(readBytes(value, "data"))),
      options: reader((value) => readHashAlgorithm(value, "signMessage")),
    }),
  }),
  verifyMessage: page({
    approval: false,
    grant: true,
    params: z.object({
      data: reader((value) => readBytes(value, "data")),
      signature: reader((value) => readBytes(value, "signature", "base64url")),
      // Wander defaults a missing key to the active wallet's.
      publicKey: z.string({ error: "verifyMessage publicKey must be a string." }).nullish(),
      options: reader((value) => readHashAlgorithm(value, "verifyMessage")),
    }),
  }),
  signDataItem: page({
    approval: true,
    grant: true,
    params: z.object({ dataItem: reader((value) => readDataItem(value, "signDataItem")) }),
  }),
  batchSignDataItem: page({
    approval: true,
    grant: true,
    params: z.object({ dataItems: reader(readDataItems) }),
  }),
  transferAoTokens: page({
    approval: true,
    grant: true,
    params: z.object({
      token: transferAddress("token", "an AO process id"),
      recipient: transferAddress("recipient", "an Arweave address"),
      amount: transferAmount,
    }),
  }),
  tokenBalance: page({
    approval: false,
    grant: true,
    // The id becomes a path segment of the HyperBEAM URL.
    params: z.object({ id: reader((value) => readProcessId(value, "tokenBalance")) }),
  }),
  userTokens: page({
    approval: false,
    grant: true,
    params: z.object({
      options: reader((value) => {
        const options = value as { fetchBalance?: unknown } | null | undefined;
        return { fetchBalance: typeof options === "object" && options?.fetchBalance === true };
      }),
    }),
  }),
  isTokenAdded: page({
    approval: false,
    grant: true,
    params: z.object({ id: reader((value) => readProcessId(value, "isTokenAdded")) }),
  }),
  addToken: page({
    approval: true,
    grant: true,
    params: z.object({ id: reader((value) => readProcessId(value, "addToken")) }),
  }),
} as const satisfies Record<ProviderMethod, PageMethodSpec>;

export type PageParams<M extends ProviderMethod> = z.output<(typeof PAGE_METHODS)[M]["params"]>;

const EXTENSION: ExtensionMethodSpec = { tier: "extension" };

export const BACKGROUND_MESSAGES = {
  // wallet lifecycle
  createWallet: EXTENSION,
  importWallet: EXTENSION,
  addHardwareWallet: EXTENSION,
  addWatchWallet: EXTENSION,
  deleteWallet: EXTENSION,
  renameWallet: EXTENSION,
  switchWallet: EXTENSION,
  downloadKeyfile: EXTENSION,
  cancelKeyfileDownload: EXTENSION,
  lockWallet: EXTENSION,
  unlockWallet: EXTENSION,
  getPasskeyStatus: EXTENSION,
  checkVaultPassword: EXTENSION,
  probeVaultPassword: EXTENSION,
  enrollPasskey: EXTENSION,
  unlockWithPasskey: EXTENSION,
  removePasskey: EXTENSION,
  resetAllWallets: EXTENSION,

  // reads
  getState: EXTENSION,
  getBalance: EXTENSION,
  getArFee: EXTENSION,
  getTokenBalances: EXTENSION,
  getPendingTransfers: EXTENSION,
  getCollectibles: EXTENSION,
  getWatchedTokens: EXTENSION,
  previewWatchedToken: EXTENSION,
  addWatchedToken: EXTENSION,
  removeWatchedToken: EXTENSION,
  getActivity: EXTENSION,
  getPortfolioHistory: EXTENSION,
  getTokenPrices: EXTENSION,
  getConnectedApps: EXTENSION,
  listContacts: EXTENSION,
  listBrowserSites: EXTENSION,

  // actions
  estimateTransfer: EXTENSION,
  assessRecipient: EXTENSION,
  submitTransfer: EXTENSION,
  estimateCollectibleSend: EXTENSION,
  sendCollectible: EXTENSION,

  // approvals
  getApproval: EXTENSION,
  resolveApproval: EXTENSION,
  submitDeviceSignature: EXTENSION,
  checkScanAttestation: EXTENSION,
  deviceActivity: EXTENSION,

  // settings
  getNetworkSettings: EXTENSION,
  setNetworkSettings: EXTENSION,
  getLockSettings: EXTENSION,
  setLockSettings: EXTENSION,
  getThemePreference: EXTENSION,
  setThemePreference: EXTENSION,
  getDisplaySettings: EXTENSION,
  setDisplaySettings: EXTENSION,
  getSecurityPhrase: EXTENSION,
  setSecurityPhrase: EXTENSION,
  revokeGrant: EXTENSION,
  getActiveSite: EXTENSION,
  useGleamOnSite: EXTENSION,
  stopGleamOnSite: EXTENSION,
  dismissSiteSuggestion: EXTENSION,
  saveContact: EXTENSION,
  deleteContact: EXTENSION,
  saveBrowserSite: EXTENSION,
  removeBrowserSite: EXTENSION,
  recordRecentSite: EXTENSION,
  clearRecentSites: EXTENSION,

  // Gleam Points
  joinPoints: EXTENSION,
  leavePoints: EXTENSION,
  getPointsMemberships: EXTENSION,
  getPointsScores: EXTENSION,
  getPointsInviteUnlock: EXTENSION,
  redeemPointsInvite: EXTENSION,
  getPointsPendingInvite: EXTENSION,
  getPointsRevealSeen: EXTENSION,
  markPointsRevealSeen: EXTENSION,
  getPointsClaimPending: EXTENSION,
  setPointsClaimPending: EXTENSION,
  getPointsShareSeen: EXTENSION,
  markPointsShareSeen: EXTENSION,
  getPointsSeatsSeen: EXTENSION,
  markPointsSeatsSeen: EXTENSION,
  getAnnouncements: EXTENSION,
  getScanStats: EXTENSION,
  getDismissedAnnouncements: EXTENSION,
  dismissAnnouncement: EXTENSION,
  getReviewPrompt: EXTENSION,
  finishReviewPrompt: EXTENSION,

  // A content script's questions about its own tab, and the one relay a
  // web page has into the wallet.
  // Takes nothing; whatever is sent is ignored.
  getSiteWalletMode: { tier: "contentScript", params: z.unknown() },
  reportOtherWallet: {
    tier: "contentScript",
    params: z.object({
      walletName: z.string({ error: "reportOtherWallet needs a walletName." }),
      used: z.boolean({ error: "reportOtherWallet needs a boolean used." }),
      // `SiteWalletHandler.report` keeps the known names and drops the rest.
      permissions: z.unknown().optional(),
    }),
  },
  providerCall: {
    tier: "contentScript",
    params: z.object({
      method: z.string({ error: "A provider call needs a method name." }),
      // Messaging is JSON, so `params: undefined` arrives as a missing key.
      params: z.unknown().optional(),
    }),
  },
} as const satisfies Record<BackgroundMessage, ExtensionMethodSpec | ContentScriptMethodSpec>;

export interface SiteMessageSpec<S extends z.ZodType = z.ZodType> {
  tier: "site";
  params: S;
  /** The reply to a message of this type that fails its origin or schema check. */
  refused: unknown;
}

/**
 * Messages the Gleam site's pages send with
 * `chrome.runtime.sendMessage(EXTENSION_ID, …)`, keyed by their `type`.
 * `dispatchSiteMessage` (`dispatch/site.ts`) is the only way in: Chrome
 * delivers these only from the manifest's `externally_connectable`
 * origin, and the dispatcher also requires Chrome's `sender.origin` to be
 * the site's before parsing. A content script's messages arrive on
 * `onMessage`, never here, so no dApp page can send one. The schemas are
 * strict: a site page an XSS controls can send anything, so an unknown
 * key is refused rather than ignored.
 */
export const SITE_MESSAGES = {
  "gleam-points:invite": {
    tier: "site",
    params: z.strictObject({
      type: z.literal("gleam-points:invite"),
      code: z.string().refine(isValidInviteCode),
    }),
    refused: { ok: false },
  },
  [SITE_ATTEST_MESSAGE_TYPE]: {
    tier: "site",
    // Checked by `parseAttestation` in the handler, which reports why.
    params: z.strictObject({ type: z.literal(SITE_ATTEST_MESSAGE_TYPE), attestation: z.unknown() }),
    refused: attestFailure("refused", ""),
  },
  [SITE_ATTEST_STATUS_MESSAGE_TYPE]: {
    tier: "site",
    params: z.strictObject({ type: z.literal(SITE_ATTEST_STATUS_MESSAGE_TYPE) }),
    refused: { ok: false },
  },
} as const satisfies Record<string, SiteMessageSpec>;

export type SiteMessageType = keyof typeof SITE_MESSAGES;

export type SiteMessage<T extends SiteMessageType> = z.output<(typeof SITE_MESSAGES)[T]["params"]>;

/**
 * The message as `SITE_MESSAGES[type]` describes it, or null if it isn't
 * one. Only a plain object qualifies, since a schema reads inherited
 * fields as if they were the message's own.
 */
export function readSiteMessage<T extends SiteMessageType>(type: T, message: unknown): SiteMessage<T> | null {
  if (typeof message !== "object" || message === null) return null;
  const prototype = Object.getPrototypeOf(message);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const parsed = SITE_MESSAGES[type].params.safeParse(message);
  return parsed.success ? (parsed.data as SiteMessage<T>) : null;
}

/** Parses with `schema`, failing with the first issue's message as a plain `Error`. */
export function parseParams<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid parameters.");
  }
  return result.data;
}
