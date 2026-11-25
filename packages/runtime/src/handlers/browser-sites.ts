import { isPlainRecord } from "@gleam/core";
import type { StoragePort } from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { updateStored } from "../storage-update";
import { stringList } from "../guards";
import { webOrigin } from "./site-wallet";

/**
 * Background-side implementation of the dApp browser's saved and recent
 * site lists. Both hold bare origins (`https://host`), so a saved site opens
 * the site, not the page the user was on.
 *
 * Storage schema this handler owns:
 * - `local:browserSavedSites` — `string[]`, most recently saved first.
 * - `local:browserRecentSites` — `string[]`, most recently opened first,
 *   at most `MAX_RECENT_SITES`.
 * - `local:browserSiteIcons` — `Record<origin, data URL>`, a saved site's
 *   icon as the page had it when saved, so the start screen draws it
 *   without asking the site. Not backed up: a restored site shows a letter.
 * - `local:browserHistory` — `BrowserVisit[]`, the pages opened, newest
 *   first, at most `MAX_HISTORY`. Full URLs, so it stays on this device:
 *   never backed up, and cleared with the recent sites.
 *
 * Browsing data: wiped with the vault (`wallet-lifecycle.ts`'s reset).
 */
export const BROWSER_SAVED_SITES_KEY = "local:browserSavedSites";
export const BROWSER_RECENT_SITES_KEY = "local:browserRecentSites";
export const BROWSER_SITE_ICONS_KEY = "local:browserSiteIcons";
export const BROWSER_HISTORY_KEY = "local:browserHistory";
export const MAX_RECENT_SITES = 10;
export const MAX_HISTORY = 300;
/** Longer URLs (a page carrying data in its query) aren't kept in history. */
export const MAX_HISTORY_URL_LENGTH = 2_048;
export const MAX_TITLE_LENGTH = 200;
/** The longest icon data URL kept, about 64 KB of image. */
export const MAX_SITE_ICON_LENGTH = 90_000;

export interface BrowserVisit {
  url: string;
  /** The page's own `<title>`, untrusted; empty when it had none. */
  title: string;
  /** Milliseconds since the epoch. */
  at: number;
}

export interface BrowserSites {
  saved: string[];
  recent: string[];
  /** By origin; only saved sites have one. */
  icons: Record<string, string>;
  history: BrowserVisit[];
}

/** Raster and SVG images only; an `<img>` never runs an SVG's script. */
const SITE_ICON = /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isValidSiteIcon(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SITE_ICON_LENGTH && SITE_ICON.test(value);
}

/** The origin of an http(s) URL, or throws. */
function requireWebOrigin(url: string): string {
  const origin = webOrigin(url);
  if (origin === null) throw new Error(userErrorMessage("enterWebAddress"));
  return origin;
}

export function isValidBrowserVisit(value: unknown): value is BrowserVisit {
  if (typeof value !== "object" || value === null) return false;
  const visit = value as Record<string, unknown>;
  return (
    typeof visit.url === "string" &&
    visit.url.length <= MAX_HISTORY_URL_LENGTH &&
    typeof visit.title === "string" &&
    visit.title.length <= MAX_TITLE_LENGTH &&
    typeof visit.at === "number" &&
    Number.isFinite(visit.at)
  );
}

function visits(raw: unknown): BrowserVisit[] {
  return Array.isArray(raw) ? raw.filter(isValidBrowserVisit) : [];
}

/** Control and format characters out (a bidi override could reorder the row), whitespace folded, length capped. */
function cleanTitle(title: unknown, url: string): string {
  if (typeof title !== "string") return "";
  const clean = title.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
  // A page with no <title> reports its URL on Android.
  return clean === url || /^https?:\/\//i.test(clean) ? "" : clean;
}

function icons(raw: unknown): Record<string, string> {
  if (!isPlainRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => isValidSiteIcon(entry[1])));
}

export class BrowserSitesHandler {
  constructor(
    private readonly storage: StoragePort,
    private readonly now: () => number = Date.now,
  ) {}

  private async load(key: string): Promise<string[]> {
    return stringList(await this.storage.get<unknown>(key));
  }

  async listBrowserSites(): Promise<BrowserSites> {
    const [saved, recent, storedIcons, storedHistory] = await Promise.all([
      this.load(BROWSER_SAVED_SITES_KEY),
      this.load(BROWSER_RECENT_SITES_KEY),
      this.storage.get<unknown>(BROWSER_SITE_ICONS_KEY),
      this.storage.get<unknown>(BROWSER_HISTORY_KEY),
    ]);
    // A site removed on another device and merged back out leaves its icon behind.
    const all = icons(storedIcons);
    return {
      saved,
      recent,
      icons: Object.fromEntries(saved.flatMap((origin) => (all[origin] ? [[origin, all[origin]]] : []))),
      history: visits(storedHistory),
    };
  }

  /** An `icon` that isn't a small image data URL is dropped, and the site is saved without one. */
  async saveBrowserSite(req: { url: string; icon?: string }): Promise<void> {
    const origin = requireWebOrigin(req.url);
    await updateStored(this.storage, BROWSER_SAVED_SITES_KEY, (raw) => [
      origin,
      ...stringList(raw).filter((entry) => entry !== origin),
    ]);
    const icon = req.icon;
    if (isValidSiteIcon(icon)) {
      await updateStored(this.storage, BROWSER_SITE_ICONS_KEY, (raw) => ({ ...icons(raw), [origin]: icon }));
    }
  }

  async removeBrowserSite(req: { origin: string }): Promise<void> {
    await updateStored(this.storage, BROWSER_SAVED_SITES_KEY, (raw) => {
      const saved = stringList(raw);
      const next = saved.filter((entry) => entry !== req.origin);
      return next.length !== saved.length ? next : undefined;
    });
    await updateStored(this.storage, BROWSER_SITE_ICONS_KEY, (raw) => {
      const all = icons(raw);
      if (!(req.origin in all)) return undefined;
      return Object.fromEntries(Object.entries(all).filter(([origin]) => origin !== req.origin));
    });
  }

  /**
   * Records a page the user stayed on: its origin in the recent sites and
   * the page in history. The same page again straight after (a reload, a
   * title that arrived late) updates the newest visit instead of adding one.
   */
  async recordRecentSite(req: { url: string; title?: string }): Promise<void> {
    const origin = requireWebOrigin(req.url);
    await updateStored(this.storage, BROWSER_RECENT_SITES_KEY, (raw) =>
      [origin, ...stringList(raw).filter((entry) => entry !== origin)].slice(0, MAX_RECENT_SITES),
    );
    if (req.url.length > MAX_HISTORY_URL_LENGTH) return;
    const visit: BrowserVisit = { url: req.url, title: cleanTitle(req.title, req.url), at: this.now() };
    await updateStored(this.storage, BROWSER_HISTORY_KEY, (raw) => {
      const history = visits(raw);
      const [newest, ...rest] = history;
      if (newest?.url === visit.url) return [{ ...visit, title: visit.title || newest.title }, ...rest];
      return [visit, ...history].slice(0, MAX_HISTORY);
    });
  }

  /** Clears the recent sites and the page history together. */
  async clearRecentSites(): Promise<void> {
    await this.storage.remove(BROWSER_RECENT_SITES_KEY);
    await this.storage.remove(BROWSER_HISTORY_KEY);
  }
}
