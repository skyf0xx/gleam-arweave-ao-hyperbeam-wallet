import { z } from "zod";
import {
  PERMISSION_TYPES,
  type ConnectAppInfo,
  type PermissionType,
  type ProviderMethod,
} from "@gleam/core";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import {
  readBytes,
  readDataItem,
  readDataItems,
  readEncryptAlgorithm,
  readHashAlgorithm,
  readProcessId,
  readSaltLength,
  readTransaction,
} from "@/src/handlers/provider-params";

/**
 * Every method the background answers, with who may call it, whether it
 * can open an approval window, and the schema its caller-supplied
 * params are parsed with before any handler runs. The dispatcher in
 * `entrypoints/background/index.ts` reads nothing else to decide whether
 * a call goes through, so this table is the privilege boundary to audit.
 *
 * - `extension`: this extension's own pages (popup, side panel, approval
 *   and passkey windows). Their params are typed by `ProtocolMap`.
 * - `contentScript`: a web page's content script, about its own tab. The
 *   origin is Chrome's `sender`, never the message body.
 * - `page`: a `window.arweaveWallet` method, relayed through
 *   `providerCall`. Only these are reachable from a web page.
 */
export type Tier = "extension" | "contentScript" | "page";

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
    params: z.object({ transaction: reader((value) => readTransaction(value, "sign")) }),
  }),
  dispatch: page({
    approval: true,
    grant: true,
    params: z.object({ transaction: reader((value) => readTransaction(value, "dispatch")) }),
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
  signature: page({
    approval: true,
    grant: true,
    params: z.object({
      data: reader((value) => readBytes(value, "data")),
      options: reader((value) => readSaltLength(value, "signature")),
    }),
  }),
  signMessage: page({
    approval: true,
    grant: true,
    params: z.object({
      data: reader((value) => readBytes(value, "data")),
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
    params: z.object({ token: transferField, recipient: transferField, amount: transferField }),
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
  deleteWallet: EXTENSION,
  renameWallet: EXTENSION,
  switchWallet: EXTENSION,
  downloadKeyfile: EXTENSION,
  cancelKeyfileDownload: EXTENSION,
  lockWallet: EXTENSION,
  unlockWallet: EXTENSION,
  getPasskeyStatus: EXTENSION,
  checkVaultPassword: EXTENSION,
  enrollPasskey: EXTENSION,
  unlockWithPasskey: EXTENSION,
  removePasskey: EXTENSION,
  resetAllWallets: EXTENSION,

  // reads
  getState: EXTENSION,
  getBalance: EXTENSION,
  getArFee: EXTENSION,
  getTokenBalances: EXTENSION,
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

  // actions
  estimateTransfer: EXTENSION,
  assessRecipient: EXTENSION,
  submitTransfer: EXTENSION,
  estimateCollectibleSend: EXTENSION,
  sendCollectible: EXTENSION,
  reviewUpload: EXTENSION,
  submitUpload: EXTENSION,

  // approvals
  getApproval: EXTENSION,
  resolveApproval: EXTENSION,
  submitDeviceSignature: EXTENSION,
  deviceActivity: EXTENSION,

  // settings
  getNetworkSettings: EXTENSION,
  setNetworkSettings: EXTENSION,
  getLockSettings: EXTENSION,
  setLockSettings: EXTENSION,
  getThemePreference: EXTENSION,
  setThemePreference: EXTENSION,
  revokeGrant: EXTENSION,
  getActiveSite: EXTENSION,
  useGleamOnSite: EXTENSION,
  stopGleamOnSite: EXTENSION,
  dismissSiteSuggestion: EXTENSION,
  saveContact: EXTENSION,
  deleteContact: EXTENSION,

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
  getDismissedAnnouncements: EXTENSION,
  dismissAnnouncement: EXTENSION,

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

/** Parses with `schema`, failing with the first issue's message as a plain `Error`. */
export function parseParams<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid parameters.");
  }
  return result.data;
}
