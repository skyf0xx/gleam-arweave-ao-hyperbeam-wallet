import { trimTrailingSlashes } from "../models/network";
import { PROCESS_ID, tagMap, type Tag } from "./asset-scan";

/**
 * Permaweb Names: a name is a `carrier@1.0` process (a supply-1 asset on
 * `arweave-scheduler@1.0`) that this namespace's path manifest maps the
 * name to. The manifest, not the process's own `name` tag, is what makes
 * a carrier the name: anyone can spawn a carrier tagged `name=alice`.
 */
export const PERMAWEB_NAMESPACE_ID = "fQXYPE9MAcfI1wV2CwJ3sJIhgT9btBOlYFOKFDGhAs0";

/** The namespace's labels: lowercase, digits, `-`, and `_` for undername-style names. */
const NAME_LABEL = /^[a-z0-9_-]{1,75}$/;
const DID_PREFIX = "uri-did-ar-";
const LIVE_ORDER_STATUSES: ReadonlySet<string> = new Set(["open", "reserved"]);

export interface CarrierHolding {
  /** `listed`: the holder escrowed it into an open sale order, so it can't be sent. */
  status: "held" | "listed";
  /** The id the name points to, when the state names one. */
  target?: string;
}

/** The label a name carrier's spawn tags claim, or null when the tags aren't a name carrier's. */
export function nameCarrierLabel(tags: Tag[]): string | null {
  const t = tagMap(tags);
  if (t.device !== "process@1.0" || t["execution-device"] !== "carrier@1.0") return null;
  if (t.ticker !== "NAME" || t["total-supply"] !== "1" || t.denomination !== "0") return null;
  const label = t.name ?? "";
  return NAME_LABEL.test(label) ? label : null;
}

/**
 * HyperBEAM nodes return state keys lowercased, with `_` as `-`, and some
 * wrap an address as `uri-did-ar-<address><suffix>`. Both sides are
 * folded the same way before comparing: finding another address that
 * folds to the same 43 characters is out of reach.
 */
function foldAccount(key: string): string {
  const bare = key.startsWith(DID_PREFIX) ? key.slice(DID_PREFIX.length) : key;
  return bare.slice(0, 43).toLowerCase().split("_").join("-");
}

function sameAccount(key: unknown, address: string): boolean {
  return typeof key === "string" && key.length >= 43 && foldAccount(key) === foldAccount(address);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOne(value: unknown): boolean {
  return value === 1 || value === "1";
}

/** What `address` has of the carrier whose `/now` state this is, or null when it has nothing. */
export function readCarrierHolding(state: unknown, address: string): CarrierHolding | null {
  if (!isRecord(state) || state["execution-device"] !== "carrier@1.0") return null;
  const target = carrierTarget(state.value);
  const withTarget = target === undefined ? {} : { target };
  const balances = isRecord(state.balances) ? state.balances : {};
  const held = Object.entries(balances).some(([key, quantity]) => sameAccount(key, address) && isOne(quantity));
  if (held) return { status: "held", ...withTarget };
  const orders = isRecord(state.orders) ? Object.values(state.orders) : [];
  const listed = orders.some(
    (order) =>
      isRecord(order) &&
      sameAccount(order.creator, address) &&
      isOne(order.quantity) &&
      typeof order.status === "string" &&
      LIVE_ORDER_STATUSES.has(order.status),
  );
  return listed ? { status: "listed", ...withTarget } : null;
}

function carrierTarget(value: unknown): string | undefined {
  const target = isRecord(value) ? value.target : value;
  return typeof target === "string" && PROCESS_ID.test(target) ? target : undefined;
}

/**
 * The carrier's current state, from the first of `hosts` that returns it
 * as JSON. Throws when none does, so a caller can tell an outage from
 * "not held".
 */
export async function readCarrierState(processId: string, hosts: readonly string[], fetchImpl: typeof fetch): Promise<unknown> {
  let lastError: unknown = new Error("no host to read the carrier from");
  for (const host of hosts) {
    try {
      const response = await fetchImpl(
        `${trimTrailingSlashes(host)}/${processId}~process@1.0/now?require-codec=json%401.0&accept-bundle=true`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const state: unknown = await response.json();
      if (isRecord(state)) return state;
      throw new Error("unreadable state");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Whether the namespace maps `label` to `processId`. A gateway resolving
 * `/<namespace>/<label>` answers with the entry's tags, and the last step
 * of its `hashpath` header is the process the path resolved to. Two hosts
 * must resolve it to the same process, so one lying gateway can't put a
 * name on a carrier the namespace doesn't give it. A host that can't
 * resolve the path proves nothing, so the next one is asked.
 */
export async function isNamespaceEntry(
  label: string,
  processId: string,
  hosts: readonly string[],
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (!NAME_LABEL.test(label) || !PROCESS_ID.test(processId)) return false;
  let confirmations = 0;
  for (const host of hosts) {
    try {
      const response = await fetchImpl(`${trimTrailingSlashes(host)}/${PERMAWEB_NAMESPACE_ID}/${label}`, { method: "HEAD" });
      if (!response.ok) continue;
      if (hashpathTarget(response.headers.get("hashpath")) === processId && ++confirmations >= 2) return true;
    } catch {
      // Ask the next host.
    }
  }
  return false;
}

/** `ao:<base>/ao:<step>.<id>` → `<id>`. */
export function hashpathTarget(hashpath: string | null): string | undefined {
  if (!hashpath) return undefined;
  const last = hashpath.slice(hashpath.lastIndexOf("/") + 1);
  const id = last.slice(last.lastIndexOf(".") + 1).replace(/^ao:/, "");
  return PROCESS_ID.test(id) ? id : undefined;
}
