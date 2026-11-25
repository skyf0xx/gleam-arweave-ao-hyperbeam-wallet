import { AO_LEGACY_CU_URL } from "./result";
import { userErrorMessage } from "../models/user-errors";
import { trimTrailingSlashes } from "../models/network";
import { isPlainRecord } from "../models/guards";
import { tagValue, type Tag } from "../models/tag";

/**
 * Read-only queries to a legacynet token process through the Compute
 * Unit's `dry-run`: the CU evaluates an unsigned message against the
 * process's current state and returns what it would reply, without
 * scheduling anything. This is how legacy tokens are read when a
 * HyperBEAM peer won't serve them (state.forward.computer answers 403 for
 * every process outside its allowlist).
 */
const DRY_RUN_TIMEOUT_MS = 15_000;

export interface LegacyTokenInfo {
  name: string | null;
  ticker: string | null;
  denomination: number | null;
  logo: string | null;
}

function replyMessages(body: unknown): Array<{ data: unknown; tags: Tag[] }> {
  if (!isPlainRecord(body)) return [];
  const messages = body.Messages ?? body.messages;
  if (!Array.isArray(messages)) return [];
  return messages.filter(isPlainRecord).map((message) => {
    const rawTags = message.Tags ?? message.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((tag): tag is Tag => isPlainRecord(tag) && typeof tag.name === "string" && typeof tag.value === "string")
      : [];
    return { data: message.Data ?? message.data, tags };
  });
}

async function dryRun(processId: string, tags: Tag[], cuUrl: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${trimTrailingSlashes(cuUrl)}/dry-run?process-id=${encodeURIComponent(processId)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    // Id and Owner are placeholders: a dry-run is never signed or scheduled.
    body: JSON.stringify({
      Id: "1234",
      Owner: "1234",
      Target: processId,
      Data: "1234",
      Tags: [...tags, { name: "Data-Protocol", value: "ao" }, { name: "Type", value: "Message" }, { name: "Variant", value: "ao.TN.1" }],
    }),
    signal: AbortSignal.timeout(DRY_RUN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(userErrorMessage("computeUnitFailed", { status: response.status }));
  return response.json();
}

function atomic(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return null;
}

/** The atomic balance `address` holds on legacy token `processId`, from its `Balance` handler's reply. */
export async function readLegacyTokenBalance(
  processId: string,
  address: string,
  cuUrl: string = AO_LEGACY_CU_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = await dryRun(
    processId,
    [
      { name: "Action", value: "Balance" },
      { name: "Recipient", value: address },
    ],
    cuUrl,
    fetchImpl,
  );
  for (const message of replyMessages(body)) {
    const fromData = atomic(message.data);
    if (fromData !== null) return fromData;
    const fromTag = atomic(tagValue(message.tags, "Balance"));
    if (fromTag !== null) return fromTag;
  }
  throw new Error(userErrorMessage("tokenNoBalanceReply"));
}

/**
 * Name, ticker, denomination and logo from a legacy token's `Info`
 * handler. Legacy processes set these in Lua, so their spawn tags
 * usually don't carry them.
 */
export async function readLegacyTokenInfo(
  processId: string,
  cuUrl: string = AO_LEGACY_CU_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<LegacyTokenInfo> {
  const body = await dryRun(processId, [{ name: "Action", value: "Info" }], cuUrl, fetchImpl);
  for (const { tags } of replyMessages(body)) {
    const value = (name: string) => tagValue(tags, name, { anyCase: true })?.trim() || null;
    const ticker = value("ticker");
    const name = value("name");
    if (ticker === null && name === null) continue;
    const denomination = value("denomination");
    return {
      name,
      ticker,
      denomination: denomination !== null && /^\d{1,2}$/.test(denomination) ? Number(denomination) : null,
      logo: value("logo"),
    };
  }
  throw new Error(userErrorMessage("tokenNoInfo"));
}
