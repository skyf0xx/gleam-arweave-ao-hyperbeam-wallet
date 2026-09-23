/**
 * Resolves what happened to an AO `Transfer` message after the Messenger
 * Unit accepted it, by reading the process's evaluated result from the
 * legacynet Compute Unit: `GET /result/{messageId}?process-id={processId}`.
 *
 * MU acceptance (`ao/transfer.ts`) only means the message was scheduled.
 * The token process can still reject it — most commonly insufficient
 * balance — by replying with a `Transfer-Error` message, or its handler
 * can throw, surfacing as the result's `Error` field. Neither ever shows
 * up as a tag on the sent message itself, so the gateway index alone
 * can't tell a rejected transfer from an executed one.
 *
 * Pure: no `chrome.*`/window/document dependency, injectable `fetchImpl`.
 */
export const AO_LEGACY_CU_URL = "https://cu.ao-testnet.xyz";

const RESULT_TIMEOUT_MS = 15_000;

export type AoTransferOutcome =
  | { status: "confirmed" }
  | { status: "failed"; error: string }
  /** The CU hasn't evaluated the message yet, or couldn't be reached — check again later. */
  | { status: "pending" };

export async function getTransferOutcome(
  messageId: string,
  processId: string,
  cuUrl: string = AO_LEGACY_CU_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<AoTransferOutcome> {
  const url = `${cuUrl.replace(/\/+$/, "")}/result/${messageId}?process-id=${encodeURIComponent(processId)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(RESULT_TIMEOUT_MS),
    });
  } catch {
    return { status: "pending" };
  }
  if (!response.ok) return { status: "pending" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "pending" };
  }

  const error = findTransferError(body);
  return error === null ? { status: "confirmed" } : { status: "failed", error };
}

type Tag = { name: string; value: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The result's top-level `Error` (a handler that threw), or the `Error`
 * tag of a `Transfer-Error` reply among its outgoing `Messages`.
 */
function findTransferError(body: unknown): string | null {
  if (!isRecord(body)) return null;

  const topLevel = body.Error ?? body.error;
  if (topLevel) return typeof topLevel === "string" ? topLevel : JSON.stringify(topLevel);

  const messages = body.Messages ?? body.messages;
  if (!Array.isArray(messages)) return null;

  for (const message of messages) {
    if (!isRecord(message)) continue;
    const rawTags = message.Tags ?? message.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((tag): tag is Tag => isRecord(tag) && typeof tag.name === "string" && typeof tag.value === "string")
      : [];
    const tagValue = (name: string) => tags.find((tag) => tag.name === name)?.value ?? null;

    if (tagValue("Action") === "Transfer-Error") {
      return tagValue("Error") ?? "The token process rejected the transfer.";
    }
  }
  return null;
}
