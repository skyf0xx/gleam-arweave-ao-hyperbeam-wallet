import type { Announcement, StoragePort } from "@gleam/core";
import { SITE_URL } from "../site-pages";

export const ANNOUNCEMENTS_URL = new URL("announcements.json", SITE_URL).toString();
/** Ids of announcements the user has dismissed, as `string[]`. */
export const ANNOUNCEMENTS_DISMISSED_KEY = "local:announcements:dismissed";

/**
 * Hosts an announcement may link to. The file is served from the site's
 * deploy, so a bad entry must not be able to send users somewhere
 * arbitrary: anything else is dropped, entry and all.
 */
export const ANNOUNCEMENT_LINK_HOSTS: readonly string[] = [new URL(SITE_URL).hostname, "x.com"];

function allowedUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.username === "" && url.password === "" && ANNOUNCEMENT_LINK_HOSTS.includes(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Keeps the well-formed entries; a file that isn't an array yields none. */
export function parseAnnouncements(raw: unknown): Announcement[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Announcement[] = [];
  for (const entry of raw as unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const { id, level, text, url } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    if (level !== "info" && level !== "critical") continue;
    if (typeof text !== "string" || text.trim() === "") continue;
    if (url === undefined) {
      seen.add(id);
      out.push({ id, level, text });
      continue;
    }
    const safe = allowedUrl(url);
    if (safe === null) continue;
    seen.add(id);
    out.push({ id, level, text, url: safe });
  }
  return out;
}

export interface AnnouncementsHandlerDeps {
  storage: StoragePort;
  url?: string;
  fetchImpl?: typeof fetch;
}

export class AnnouncementsHandler {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: AnnouncementsHandlerDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /**
   * A plain GET of a static file; any failure reads as "no announcements".
   * The site serves `Access-Control-Allow-Origin: *`, so this needs no host
   * permission: adding one would make Chrome disable the extension on
   * update until each user re-approves it.
   */
  async fetchAnnouncements(): Promise<Announcement[]> {
    try {
      const response = await this.fetchImpl(this.deps.url ?? ANNOUNCEMENTS_URL, {
        credentials: "omit",
        cache: "no-cache",
      });
      if (!response.ok) return [];
      return parseAnnouncements(await response.json());
    } catch {
      return [];
    }
  }

  async getDismissed(): Promise<string[]> {
    const stored = await this.deps.storage.get<unknown>(ANNOUNCEMENTS_DISMISSED_KEY);
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  }

  async dismiss(req: { id: string }): Promise<void> {
    const dismissed = await this.getDismissed();
    if (dismissed.includes(req.id)) return;
    await this.deps.storage.set(ANNOUNCEMENTS_DISMISSED_KEY, [...dismissed, req.id]);
  }
}
