import { errorMessage } from "@gleam/core/src/models/error-message.ts";
import { matchUserError, type UserErrorCode } from "@gleam/core/src/models/user-errors.ts";
import type { MessageKey } from "./catalog";
import { t, type MessageParams } from "./index";

const ACTION_KEYS = new Map<string, MessageKey>([
  ["sign transactions", "errors.actionSignTransactions"],
  ["send transactions", "errors.actionSendTransactions"],
  ["sign data items", "errors.actionSignDataItems"],
  ["send AO tokens", "errors.actionSendAoTokens"],
  ["sign messages", "errors.actionSignMessages"],
  ["decrypt data", "errors.actionDecryptData"],
  ["encrypt data", "errors.actionEncryptData"],
  ["send collectibles", "errors.actionSendCollectibles"],
  ["change a name's target", "errors.actionChangeNameTarget"],
  ["send this token", "errors.actionSendThisToken"],
  ["join Gleam Points", "errors.actionJoinPoints"],
  ["leave Gleam Points", "errors.actionLeavePoints"],
  ["sign a scan attestation", "errors.actionSignAttestation"],
]);

const FIELD_KEYS = new Map<string, MessageKey>([
  ["recipient", "errors.fieldRecipient"],
  ["amount", "errors.fieldAmount"],
  ["tags", "errors.fieldTags"],
  ["data", "errors.fieldData"],
  ["fee", "errors.fieldFee"],
  ["target", "errors.fieldTarget"],
  ["anchor", "errors.fieldAnchor"],
  ["item count", "errors.fieldItemCount"],
  ["AO transfer", "errors.fieldAoTransfer"],
  ["token", "errors.fieldToken"],
  ["message", "errors.fieldMessage"],
  ["tag name", "errors.fieldTagName"],
  ["tag value", "errors.fieldTagValue"],
  ["tag count", "errors.fieldTagCount"],
  ["transaction", "errors.fieldTransaction"],
  ["data item", "errors.fieldDataItem"],
]);

/** The points server's refusals a person can run into, as `apps/points-api` words them. */
const REASON_KEYS = new Map<string, MessageKey>([
  ["Too many requests.", "errors.reasonTooManyRequests"],
  ["This wallet is being registered elsewhere. Try again.", "errors.reasonRegistering"],
  ["Register message is stale.", "errors.reasonStale"],
  ["Leave message is stale.", "errors.reasonLeaveStale"],
  ["Wallet signature is invalid.", "errors.reasonBadSignature"],
]);

/** A code with no `errors` entry fails `tsc` here. */
export function userErrorKey(code: UserErrorCode): MessageKey {
  return `errors.${code}`;
}

/** A placeholder value in this language, or null when it is English we can't translate. */
function localizedParam(name: string, value: string): string | null {
  const translated = (key: MessageKey | undefined) => (key ? t(key) : null);
  switch (name) {
    case "action": {
      const ticker = /^send (.+)$/.exec(value)?.[1];
      return translated(ACTION_KEYS.get(value)) ?? (ticker ? t("errors.actionSendTicker", { ticker }) : null);
    }
    case "field":
      return translated(FIELD_KEYS.get(value));
    case "label":
      return value === "token" ? t("errors.fieldToken") : value;
    case "reason":
      return /^HTTP \d+$/.test(value) ? value : translated(REASON_KEYS.get(value));
    case "failures":
      return value
        .replaceAll("(timed out)", `(${t("errors.failureTimedOut")})`)
        .replaceAll("(unreadable answer)", `(${t("errors.failureUnreadable")})`);
    default:
      return value;
  }
}

/**
 * What the UI shows for a caught error: the translation when it is a
 * `USER_ERRORS` entry, otherwise the English as it came, whole rather than
 * spliced into a translated sentence.
 */
export function errorText(error: unknown): string {
  const message = errorMessage(error);
  const match = matchUserError(message);
  if (!match) return message;
  const params: MessageParams = {};
  for (const [name, value] of Object.entries(match.params)) {
    const text = localizedParam(name, value);
    if (text === null) return message;
    params[name] = text;
  }
  return t(userErrorKey(match.code), params);
}
