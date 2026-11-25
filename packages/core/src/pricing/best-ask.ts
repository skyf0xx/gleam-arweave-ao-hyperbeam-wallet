import { trimTrailingSlashes } from "../models/network";
import { isPlainRecord, isRecord } from "../models/guards";
import { isArweaveId } from "../models/arweave-id";
import { atomicString } from "../models/balance";
/**
 * Spot price of an AO token from its own swap orderbook, the way Bazar
 * shows "Current unit price": the lowest open ask in the token process's
 * live HyperBEAM state, in AR per whole token. It is a listing, not a
 * trade, so it is only ever shown, never used for anything a signature
 * depends on.
 *
 * The state's `orders` field is a link (`ao:<id>`) to a message whose
 * fields are one link per order, and each order is its own message. A
 * message's scalar fields come back as response headers on a `HEAD`, but
 * an order's `status` header is the HTTP status of that response, so the
 * real status is read from `/status` for the few orders that matter.
 */
const STATE_DEVICES = new Set(["carrier@1.0", "name-token@1.0", "token@1.0"]);
const UINT = /^(?:0|[1-9]\d*)$/;
const MAX_DENOMINATION = 255;
const READ_TIMEOUT_MS = 10_000;

/**
 * More open orders than this means the cheapest one can't be found
 * without an unbounded crawl, so the token goes unpriced.
 */
const MAX_ORDERS = 150;

/**
 * A listing below this (0.1 AR in Winston) can't set a price: a dust lot
 * for any amount is free to post, and is how a junk token fakes a value.
 */
export const MIN_ASK_WINSTON = 100_000_000_000n;
const WINSTON_PER_AR = 1_000_000_000_000;

export interface BestAsk {
  /** AR per whole token. */
  arPerToken: number;
}

interface Order {
  id: string;
  asking: bigint;
  quantity: bigint;
  /** Present when the order arrived inline, where its status is a real field, not an HTTP status. */
  status?: string;
}

function headerFields(response: Response): Record<string, string> {
  const fields: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    try {
      fields[decodeURIComponent(name)] = value;
    } catch {
      fields[name] = value;
    }
  });
  return fields;
}

/** A `json@1.0` reply carries the message as its body, anything else as headers. */
async function readMessage(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Record<string, unknown>> {
  const head = await fetchImpl(url, { method: "HEAD", signal });
  if (!head.ok) throw new Error(`HTTP ${head.status}`);
  if (head.headers.get("codec-device")?.toLowerCase() !== "json@1.0") return headerFields(head);

  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as unknown;
  if (!isPlainRecord(body)) throw new Error("Unexpected message body.");
  return body;
}

function link(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("ao:")) return null;
  const id = value.slice(3);
  return isArweaveId(id) ? id : null;
}

function atomic(value: unknown): bigint | null {
  const text = atomicString(value, UINT);
  return text === null ? null : BigInt(text);
}

async function readOrder(
  orderKey: string,
  value: unknown,
  base: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Order | null> {
  const id = link(value);
  const message = id ? await readMessage(`${base}/${id}~message@1.0`, fetchImpl, signal) : value;
  if (!isRecord(message)) return null;
  const fields = message;
  const asking = atomic(fields.asking);
  const quantity = atomic(fields.quantity);
  // The key and the order's own id must agree, or the entry is not the order it claims to be.
  if (fields["order-id"] !== orderKey || asking === null || quantity === null || asking < 1n || quantity < 1n) return null;
  return { id: id ?? orderKey, asking, quantity, ...(id === null && typeof fields.status === "string" ? { status: fields.status } : {}) };
}

async function readStatus(base: string, orderId: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<string | null> {
  const response = await fetchImpl(`${base}/${orderId}~message@1.0/status`, { signal });
  return response.ok ? (await response.text()).trim() : null;
}

/**
 * Winston per whole token, rounded up like Bazar so the shown price never
 * sits below what a buyer pays.
 */
function winstonPerToken({ asking, quantity }: Order, denomination: number): bigint {
  return (asking * 10n ** BigInt(denomination) + quantity - 1n) / quantity;
}

/**
 * The best open ask of `processId` on `nodeUrl`, or `null` when it can't be
 * known: the node doesn't serve the process, it isn't a swap-capable token,
 * nothing is listed above the dust floor, or any read fails. Never throws.
 * The process id comes from the caller's own token list, never from a ticker.
 */
export async function readBestAsk(processId: string, nodeUrl: string, fetchImpl: typeof fetch = fetch): Promise<BestAsk | null> {
  if (!isArweaveId(processId)) return null;
  const base = trimTrailingSlashes(nodeUrl);
  const signal = AbortSignal.timeout(READ_TIMEOUT_MS);

  try {
    const state = await readMessage(`${base}/${processId}~process@1.0/compute&max-age=60`, fetchImpl, signal);
    const device = state["execution-device"] ?? state.device;
    if (typeof device !== "string" || !STATE_DEVICES.has(device)) return null;

    const denomination = state.denomination === undefined ? 0 : Number(state.denomination);
    if (!Number.isInteger(denomination) || denomination < 0 || denomination > MAX_DENOMINATION) return null;

    const ordersId = link(state.orders);
    const table = ordersId
      ? await readMessage(`${base}/${ordersId}~message@1.0`, fetchImpl, signal)
      : isRecord(state.orders)
        ? state.orders
        : null;
    if (!table) return null;

    const entries = Object.entries(table).filter(([key]) => isArweaveId(key));
    if (entries.length > MAX_ORDERS) return null;

    const orders = (await Promise.all(entries.map(([key, value]) => readOrder(key, value, base, fetchImpl, signal).catch(() => null))))
      .filter((order): order is Order => order !== null && order.asking >= MIN_ASK_WINSTON)
      .sort((a, b) => {
        const diff = winstonPerToken(a, denomination) - winstonPerToken(b, denomination);
        return diff < 0n ? -1 : diff > 0n ? 1 : 0;
      });

    for (const order of orders) {
      if ((order.status ?? (await readStatus(base, order.id, fetchImpl, signal))) !== "open") continue;
      const price = Number(winstonPerToken(order, denomination)) / WINSTON_PER_AR;
      return Number.isFinite(price) && price > 0 ? { arPerToken: price } : null;
    }
    return null;
  } catch {
    return null;
  }
}
