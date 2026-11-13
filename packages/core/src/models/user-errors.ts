/**
 * Errors a person can reach in the wallet UI. Only `message` crosses every
 * transport (mobile's Comlink, the keyring's replies), so the text is the
 * identity: the app matches a message back to its code and translates it
 * at display, and dApps keep getting this English.
 *
 * `signer/` can't import this file, so the texts it throws are repeated here
 * and `user-errors.models.test.ts` fails if they drift.
 */
export const USER_ERRORS = {
  noStoredWallet: 'No stored wallet with id "{wallet}".',
  walletNotFound: 'Wallet "{wallet}" doesn\'t exist.',
  walletNotInGleam: "That wallet isn't in Gleam.",
  walletLocked: 'Wallet "{wallet}" is locked. Unlock it to continue.',
  noActiveWalletBalances: "No active wallet to read balances for.",
  noActiveWalletSign: "No active wallet to sign with.",
  noActiveWalletTokenBalance: "No active wallet to read a token balance for.",
  noActiveWalletTokens: "No active wallet to read tokens for.",
  noActiveWalletCheckTokens: "No active wallet to check tokens for.",
  noActiveWalletAddToken: "No active wallet to add a token to.",
  noWalletToConnect: "There is no wallet to connect. Create or import one first.",
  noWalletToUnlock: "There's no wallet to unlock.",
  unlockBeforeAddingHardware: "Unlock Gleam before adding a hardware wallet.",
  unlockBeforeAddingWallet: "Unlock Gleam before adding a wallet.",
  addressInGleam: 'This address is already in Gleam as "{name}".',
  addressInGleamHardware: 'This address is already in Gleam as the hardware wallet "{name}".',
  addressInGleamWatch: 'This address is already in Gleam as the watch-only wallet "{name}". Remove it, then import the keyfile.',
  invalidWatchAddress: "That isn't an Arweave address. An address is 43 letters, numbers, - and _.",
  enterValidAddress: "Enter a valid Arweave address.",
  enterContactName: "Enter a name up to {max} characters.",
  securityPhraseInvalid: "Pick a word of up to 24 letters or numbers.",
  enterWebAddress: "Enter a web address.",

  passwordTooShort: "Password must be at least {min} characters.",
  passwordTooCommon: "That password is too common. Choose something less guessable.",
  passwordFailed: "That password didn't work. Try again, or use your recovery method.",
  vaultPasswordFailed: "That password didn't work. Use the password you unlock Gleam with.",
  noVaultPassword: "Gleam has no password to protect. Add a wallet with a keyfile first.",
  walletPasswordFailed: "That password didn't unlock this wallet. Try again, or use your recovery method.",
  vaultUnreadableFormat: "This wallet was saved in a format this version can't read.",
  vaultCorrupted: "This wallet's saved data is corrupted and can't be read.",
  vaultKdfFailed:
    "Gleam couldn't run its password check on this device, so it can't tell whether the password is right. Close other tabs or restart the browser, then try again.",
  keyringLocked: "This wallet is locked. Unlock Gleam and try again.",
  sessionKeyStorageFailed: "Gleam couldn't keep the wallet unlocked. Restart the browser and try again.",
  keyfileReadBackFailed: "Gleam couldn't check the re-encrypted keyfile. Try again.",

  keyfileInvalid: "That file isn't a valid Arweave keyfile.",
  keyfileMissingField: 'That file isn\'t a valid Arweave keyfile. Missing required field "{key}".',
  keyfileWrongKeyType: 'That file isn\'t a valid Arweave keyfile. Expected key type "RSA", got "{kty}".',
  keyfileEmptyField: 'That file isn\'t a valid Arweave keyfile. Field "{key}" must be a non-empty string.',
  keyfileBadField: 'That file isn\'t a valid Arweave keyfile. Field "{key}" is not valid base64url.',
  keyfileNoPrivateKey: "This keyfile has no private key.",
  keyfileDownloadsUnavailable: "Keyfile downloads aren't available here.",
  keyfileNoneWatch: "This wallet is watch-only. Gleam has no keyfile for it.",
  keyfileNoneHardware: "This wallet's key stays on its device. There's no keyfile to export.",
  keyfileNoKeyMaterial: 'No exportable key material for wallet "{wallet}".',

  passkeyUnexpectedSecret: "The passkey returned an unexpected secret.",
  backupUnavailable: "Backup isn't available on this device.",
  backupSignInNeeded: "Sign in to back up.",
  backupFileMissing: "No backup found in this account.",
  backupFileCorrupt: "This backup can't be read.",
  backupWrongPassword: "That password didn't open this backup.",
  passkeyBadResponse: "The passkey didn't return what Gleam needs.",
  passkeyNotSetUp: "No passkey is set up for Gleam. Unlock with your password.",
  passkeyWrongCredential: "That isn't the passkey set up for Gleam. Try again, or use your password.",
  passkeyStale: "This passkey no longer matches your password. Unlock with your password, then set the passkey up again.",
  passkeyFailed: "That passkey didn't unlock Gleam. Use your password instead.",

  watchOnlyConnect: "The active Gleam wallet is watch-only, so it can't connect to sites. Switch to a wallet that can sign.",
  watchOnlyAction: "This wallet is watch-only, so it can't {action}.",
  watchOnlySign: "This wallet is watch-only, so it can't sign.",
  unsupportedAction: "This wallet can't {action}. Switch to a keyfile wallet.",
  hardwareSigning: "This wallet signs on its device. Signing with a hardware wallet isn't supported yet.",

  noApprovedFee: "This send has no approved network fee. Try again.",
  networkFeeNeeded: "Sending needs about {fee} AR for the network fee.",
  recipientInvalid: 'Recipient must be an Arweave address (43 base64url characters), got "{recipient}".',
  transferRecipientInvalid: 'Transfer recipient must be an Arweave address (43 base64url characters), got "{recipient}".',
  transactionDataMismatch: "The transaction's data_root or data_size doesn't match its data.",
  transactionSignatureMismatch: "The signature doesn't match this transaction or its owner.",
  transactionOwnerMismatch: "This transaction names a different owner than the signing key.",
  dataItemSignatureMismatch: "The signature doesn't match this data item or its owner.",
  dataItemOwnerMismatch: "This data item names a different owner than the signing key.",
  storedKeySigningMismatch: "This wallet's stored public key doesn't match its address, so Gleam won't sign with it.",
  storedKeyEncryptionMismatch: "This wallet's stored public key doesn't match its address, so Gleam won't encrypt with it.",
  noStoredPublicKey: 'No public key stored for wallet "{wallet}".',

  collectibleIdInvalid: "This collectible's process id isn't a valid Arweave id.",
  collectibleRecipientInvalid: "That doesn't look like a full Arweave address: check for a missing character.",
  collectibleSendToSelf: "That's this wallet's own address. Send to a different address.",
  collectibleSendToAsset: "That's the collectible's own address. Enter the recipient's wallet address.",
  noPeerConfigured: "No HyperBEAM peer configured. Add one in Network settings to find collectibles.",

  tokenPasteId: "Paste a token's process id.",
  tokenBadId: "That isn't a process id. A process id is 43 letters, digits, - and _; copy it from the token's page or explorer.",
  tokenIsOwnAddress: "That's your wallet address, not a token's process id.",
  tokenIsCollectible: "That's a collectible, not a token. Collectibles you hold show up in the Collectibles tab on their own.",
  notTokenSend: "Not a token send.",
  notCollectibleSend: "Not a collectible send.",
  tokenNoIdentity: "That process doesn't describe itself as a token (it has no name or ticker). Check the id.",
  tokenNoInfo: "The process didn't answer Info like a token.",
  tokenNotIndexed:
    "No process with that id is on Arweave yet. Check that you copied the whole id; a token spawned in the last few minutes may not be indexed yet.",
  tokenLookupUnreachable: "Couldn't reach {host} to look up that token. Check your connection, or switch gateways in Network settings, then try again.",
  tokenDetailsUnavailable: "Couldn't look up this token's details. Try again in a minute.",
  tokenNoDecimals: "This token doesn't say how many decimals it uses.",
  tokenBalanceUnreadable: "Couldn't read your {label} balance. Tried {failures}. The token's node may be busy, so try again in a minute.",
  tokenNoBalanceReply: "The token's Balance reply carried no balance.",
  tokenStateFailed: "Token state request failed ({status}).",

  arBalanceFailed: 'Failed to read AR balance for "{address}" from {gateway} (HTTP {status}).',
  arBalanceNotInteger: 'Gateway returned a non-integer balance for "{address}": "{body}".',
  aoBalanceFailed: 'Failed to read AO token balance for "{address}" on process "{process}" from {peer} (HTTP {status}).',
  collectibleBalanceFailed: "Could not read any collectible balance from {peer}.",
  computeUnitFailed: "The AO compute unit answered {status}.",
  aoSubmitFailed: "AO message submission to {url} failed ({status}).",
  aoSubmitFailedDetail: "AO message submission to {url} failed ({status}): {detail}.",
  transferSubmitFailed: "Failed to submit transfer to {gateway} (HTTP {status}: {statusText}).",
  dispatchFailed: "Failed to dispatch transaction to {gateway} (HTTP {status}: {statusText}).",
  bundlerSubmitFailed: "Failed to submit data item to bundler {bundler} (HTTP {status}: {statusText}).",
  gatewayQueryFailed: 'Gateway GraphQL query for "{address}" against "{gateway}" failed: {detail}',
  gatewayReceiptQueryFailed: 'Gateway token-receipt GraphQL query for "{address}" against "{gateway}" failed: {detail}',
  gatewayBlockQueryFailed: 'Gateway block-height GraphQL query against "{gateway}" failed: {detail}',
  gatewayAllFailed: "Gateway GraphQL query failed against every candidate gateway.",
  tokenLookupFailed: 'Token lookup against "{gateway}" failed: {detail}',
  collectibleLookupFailed: 'Collectible lookup against "{gateway}" failed: {detail}',

  approvalNotPending: 'No pending approval request with id "{id}".',
  approvalResolving: 'Approval request "{id}" is already being resolved.',
  approvalTimedOut: "The approval request timed out.",
  approvalAwaitingDevice: "This request is already approved. Sign it on your device.",
  approvalEndedPreparing: "This request ended while it was being prepared for your device. Start again from the app.",
  approvalNotWaitingForDevice: 'Approval request "{id}" isn\'t waiting for a device.',
  approvalNotWaitingForSignature: 'Approval request "{id}" isn\'t waiting for a device signature.',
  approvalMismatch: "The prepared {field} doesn't match the request, so nothing was sent to the device.",
  attestationInvalid: "This request's attestation isn't valid.",
  attestationMessageMismatch: "The message to sign isn't this attestation's.",
  attestationSignedMismatch: "The signed message isn't for this attestation.",
  attestationRefused: "The points server refused the attestation.",

  deviceSignatureCount: "Expected {expected} signature(s) from the device, got {received}.",
  deviceSignatureEncoding: "The device returned a signature that isn't base64url.",
  deviceSignatureMismatch: "The signature doesn't match this wallet. Check that the right device and account signed, then try again.",
  deviceKeyEncoding: "The device sent a public key that isn't valid base64url.",
  deviceKeyLength: "The device sent a {size}-byte public key. An Arweave key is {expected} bytes.",
  deviceDetailsMismatch: "The device details don't match this wallet type.",
  notHardwareWallet: 'Wallet "{wallet}" isn\'t a hardware wallet with a stored public key.',

  inviteRequired: "An invite is required to join Gleam Points.",
  inviteCodeInvalid: "That invite code isn't valid.",
  inviteCodeRejected: '"{code}" isn\'t a valid invite code.',
  pointsJoinFailed: "Couldn't join Gleam Points: {reason}",
  pointsLeaveFailed: "Couldn't leave Gleam Points: {reason}",
  pointsLoadFailed: "Couldn't load Gleam Points (HTTP {status}).",
  pointsUnexpectedResponse: "The points server sent an unexpected response.",
  pointsDeviceKeyFailed: "Couldn't store the Gleam Points device key.",
  unlockToAction: "Unlock this wallet to {action}.",

  ledgerLocked: "Unlock your Ledger and open the Arweave app.",
  ledgerAppClosed: "Open the Arweave app on your Ledger.",
  ledgerRejected: "Request rejected on your Ledger.",
  ledgerKeyNotReady: "Your Ledger is still setting up the Arweave key. This can take a few minutes the first time.",
  ledgerDataInvalid: "The Ledger app rejected the transaction data.",
  ledgerDataInvalidDetail: "The Ledger app rejected the transaction data: {detail}.",
  ledgerConditions: "Your Ledger couldn't complete the request (conditions not satisfied).",
  ledgerWrongLength: "Your Ledger rejected the request length.",
  ledgerBadData: "The Ledger app rejected the request data.",
  ledgerCommandFailed: "Ledger command failed ({status}).",
  ledgerUnexpectedReply: "Your Ledger sent an unexpected reply ({detail}).",
  ledgerOwnerMismatch: "This request belongs to a different account than the connected Ledger.",
  ledgerAddressMismatch: "Your Ledger's address doesn't match its public key.",
  ledgerFormat2Only: "Ledger only signs format-2 Arweave transactions.",
  ledgerTooManyTags: "Ledger signs at most {max} tags.",
  ledgerTagsTooLarge: "This transaction's tags are too large for your Ledger to sign.",
  ledgerType1Only: "Ledger only signs Arweave (type 1) data items.",
  ledgerDataItemTooLarge: "This data item is too large for your Ledger to sign.",
  ledgerFieldTooLarge: "This transaction's {field} is too large for a Ledger.",
  ledgerSignedDifferent: "Your Ledger signed a different {field} than Gleam built. Nothing was sent; update the Ledger app and try again.",
  ledgerSignatureUnread: "Gleam couldn't read the signature from your Ledger. Sign again on your Ledger.",
  ledgerSignatureInvalid: "Your Ledger returned a signature that doesn't check out. Nothing was sent; sign again on your Ledger.",
  ledgerTagNotAscii: 'Your Ledger only signs tags written in plain ASCII text, with a name. "{name}" can\'t be shown on the device.',
  ledgerDuplicateTag: 'Your Ledger can\'t sign a data item with two "{name}" tags.',
  ledgerPermawebReason: "Your Ledger can only send AR with the Arweave app.",
  ledgerPermawebRequired:
    "Your Ledger can only send AR with the Arweave app.\n\nTo send AO on Gleam, install the beta Permaweb app using the permawebOS extension: {url}",
  ledgerTargetRequired: "The Ledger Arweave app only signs transactions sent to an address. Use a Keystone or a keyfile wallet for this one.",
  ledgerMessageUnsupported: "The Ledger Arweave app can't sign messages. Use a Keystone or a keyfile wallet.",

  ledgerUnsupportedBrowser: "This browser can't talk to a Ledger. Open Gleam in Chrome or another Chromium browser.",
  ledgerNoDevice: "No Ledger was selected. Plug it in, unlock it and try again.",
  ledgerBusy: "Close Ledger Live or other wallet windows and try again.",
  ledgerDisconnected: "The Ledger was disconnected. Plug it back in and try again.",
  ledgerTransportBadReply: "Your Ledger sent an unexpected reply. Unplug it, plug it back in and try again.",

  keystoneDataTooLarge: "This transaction carries more than {limit} KB of data, which is too much to show as a QR for Keystone to sign. Try a smaller request.",
  keystoneTooManyFrames: "This request is too large to show as a QR ({frames} frames). Try a smaller request.",
} as const;

export type UserErrorCode = keyof typeof USER_ERRORS;

type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;

type ParamsArg<C extends UserErrorCode> = [Placeholders<(typeof USER_ERRORS)[C]>] extends [never]
  ? []
  : [params: Record<Placeholders<(typeof USER_ERRORS)[C]>, string | number>];

/** The English text of `code`, with its placeholders filled. */
export function userErrorMessage<C extends UserErrorCode>(code: C, ...[params]: ParamsArg<C>): string {
  const values: Record<string, string | number> = params ?? {};
  return USER_ERRORS[code].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
}

interface CompiledTemplate {
  code: UserErrorCode;
  /** The fixed text around the placeholders: always one more than `names`. */
  literals: string[];
  names: string[];
}

function compile(code: UserErrorCode): CompiledTemplate {
  const parts = USER_ERRORS[code].split(/\{(\w+)\}/);
  return {
    code,
    literals: parts.filter((_, index) => index % 2 === 0),
    names: parts.filter((_, index) => index % 2 === 1),
  };
}

/**
 * The placeholder values, or null when `message` isn't this template. A walk
 * over the literals rather than a regex: `errorText` runs on the UI thread and
 * lazy groups backtrack polynomially on long messages.
 */
function extractParams(message: string, literals: string[]): string[] | null {
  const first = literals[0]!;
  const last = literals[literals.length - 1]!;
  const end = message.length - last.length;
  if (end < first.length || !message.startsWith(first) || !message.endsWith(last)) return null;
  const values: string[] = [];
  let position = first.length;
  for (const literal of literals.slice(1, -1)) {
    const next = message.indexOf(literal, position);
    if (next === -1 || next + literal.length > end) return null;
    values.push(message.slice(position, next));
    position = next + literal.length;
  }
  values.push(message.slice(position, end));
  return values;
}

function literalLength(code: UserErrorCode): number {
  return USER_ERRORS[code].replace(/\{\w+\}/g, "").length;
}

const CODES = Object.keys(USER_ERRORS) as UserErrorCode[];

const STATIC_CODES = new Map<string, UserErrorCode>(
  CODES.filter((code) => !/\{\w+\}/.test(USER_ERRORS[code])).map((code) => [USER_ERRORS[code], code]),
);

/** Longest literal text first, so a broad template can't shadow a narrower one. */
const DYNAMIC_TEMPLATES = CODES.filter((code) => /\{\w+\}/.test(USER_ERRORS[code]))
  .sort((a, b) => literalLength(b) - literalLength(a))
  .map(compile);

/** The table entry that produced `message`, with its placeholder values; null for any other text. */
export function matchUserError(message: string): { code: UserErrorCode; params: Record<string, string> } | null {
  const staticCode = STATIC_CODES.get(message);
  if (staticCode) return { code: staticCode, params: {} };
  for (const { code, literals, names } of DYNAMIC_TEMPLATES) {
    const values = extractParams(message, literals);
    if (values) return { code, params: Object.fromEntries(names.map((name, index) => [name, values[index]!])) };
  }
  return null;
}
