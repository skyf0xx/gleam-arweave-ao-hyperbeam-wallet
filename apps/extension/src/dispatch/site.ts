import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { DEV_SITE_HOSTS, SITE_ORIGIN } from "../site-pages";
import { SITE_MESSAGES, readSiteMessage, type SiteMessage, type SiteMessageType } from "./methods";

/** Whether Chrome's `sender.origin` for an external message is the Gleam site. */
export function isSiteOrigin(origin: string | undefined, dev: boolean = import.meta.env.DEV): boolean {
  if (origin === SITE_ORIGIN) return true;
  if (!dev || origin === undefined) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.origin === origin && DEV_SITE_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

export type SiteHandlers = { [T in SiteMessageType]: (message: SiteMessage<T>) => Promise<unknown> };

/** The reply to a message whose `type` isn't in `SITE_MESSAGES`. */
export const UNKNOWN_SITE_MESSAGE = { ok: false } as const;

/**
 * The one entry point for `runtime.onMessageExternal`. A message reaches
 * its handler only if `caller` is a `site` caller whose origin is the
 * site's (`isSiteOrigin`) and it matches its `SITE_MESSAGES` schema;
 * otherwise it gets that type's `refused` reply. An unknown `type` is
 * answered before the caller is looked at.
 */
export async function dispatchSiteMessage(
  message: unknown,
  caller: CallerContext | null,
  handlers: SiteHandlers,
): Promise<unknown> {
  const type = typeof message === "object" && message !== null ? (message as { type?: unknown }).type : undefined;
  if (typeof type !== "string" || !Object.hasOwn(SITE_MESSAGES, type)) return UNKNOWN_SITE_MESSAGE;
  const siteType = type as SiteMessageType;
  if (caller?.tier !== "site" || !isSiteOrigin(caller.origin)) return SITE_MESSAGES[siteType].refused;
  const parsed = readSiteMessage(siteType, message);
  if (!parsed) return SITE_MESSAGES[siteType].refused;
  return (handlers[siteType] as (message: SiteMessage<SiteMessageType>) => Promise<unknown>)(parsed);
}
