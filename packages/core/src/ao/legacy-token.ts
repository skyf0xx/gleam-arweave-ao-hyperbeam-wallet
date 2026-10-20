import { AO_LEGACY_CU_URL } from "./result";

/**
 * Read-only queries to a legacynet token process through the Compute
 * Unit's `dry-run`: the CU evaluates an unsigned message against the
 * process's current state and returns what it would reply, without
 * scheduling anything. This is how legacy tokens are read when a
 * HyperBEAM peer won't serve them (state.forward.computer answers 403 for
 * every process outside its allowlist).
 */
const DRY_RUN_TIMEOUT_MS = 15_000;

type Tag = { name: string; value: string };

export interface LegacyTokenInfo {
  name: string | null;
  ticker: string | null;
  denomination: number | null;
  logo: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replyMessages(body: unknown): Array<{ data: unknown; tags: Tag[] }> {
  if (!isRecord(body)) return [];
  const messages = body.Messages ?? body.messages;
  if (!Array.isArray(messages)) return [];
  return messages.filter(isRecord).map((message) => {
    const rawTags = message.Tags ?? message.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((tag): tag is Tag => isRecord(tag) && typeof tag.name === "string" && typeof tag.value === "string")
      : [];
    return { data: message.Data ?? message.data, tags };
  });
}

async function dryRun(processId: string, tags: Tag[], cuUrl: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${cuUrl.replace(/\/+$/, "")}/dry-run?process-id=${encodeURIComponent(processId)}`, {
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
  if (!response.ok) throw new Error(`The AO compute unit answered ${response.status}.`);
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
    const fromTag = atomic(message.tags.find((tag) => tag.name === "Balance")?.value);
    if (fromTag !== null) return fromTag;
  }
  throw new Error("The token's Balance reply carried no balance.");
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
    const value = (name: string) => tags.find((tag) => tag.name.toLowerCase() === name)?.value?.trim() || null;
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
  throw new Error("The process didn't answer Info like a token.");
}
