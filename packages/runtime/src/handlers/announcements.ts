import { z } from "zod";
import { isPlainRecord } from "@gleam/core";
import type { Announcement, StoragePort } from "@gleam/core";
import { SITE_URL } from "@gleam/core/src/models/site-origin.ts";
import { updateStored } from "../storage-update";
import { stringList } from "../guards";

export const ANNOUNCEMENTS_URL = new URL("announcements.json", SITE_URL).toString();
/** The newest release per shell that doesn't update itself, as `{ "android": "1.54.0" }`. */
export const LATEST_URL = new URL("latest.json", SITE_URL).toString();
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

/** Where the wallet runs: the shell an entry's `platforms` can name. */
export type AnnouncementShell = "extension" | "android" | "ios";

/** The install reading the file. `web` is the mobile app's browser preview, which no `platforms` list names. */
export interface AnnouncementTarget {
  shell: AnnouncementShell | "web";
  version: string;
}

const SHELLS = ["extension", "android", "ios"] as const satisfies readonly AnnouncementShell[];

function parseVersion(raw: unknown): [number, number, number] | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(raw);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isBelow(version: [number, number, number], bound: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i]! !== bound[i]!) return version[i]! < bound[i]!;
  }
  return false;
}

const nonBlank = z.string().refine((text) => text.trim() !== "");

/** A malformed `platforms` or `below` drops the entry. */
const versionSchema = z.string().transform((version, ctx) => {
  const parsed = parseVersion(version);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "not a version" });
    return z.NEVER;
  }
  return parsed;
});

/** An entry's `url` passes only when it is a link `allowedUrl` accepts. */
const linkSchema = z.unknown().transform((raw, ctx) => {
  const safe = allowedUrl(raw);
  if (safe === null) {
    ctx.addIssue({ code: "custom", message: "link not allowed" });
    return z.NEVER;
  }
  return safe;
});

const announcementEntrySchema = z.object({
  id: z.string().min(1),
  level: z.enum(["info", "critical"]),
  title: nonBlank.optional(),
  text: nonBlank,
  url: linkSchema.optional(),
  platforms: z.array(z.enum(SHELLS)).min(1).optional(),
  below: versionSchema.optional(),
});

/**
 * Keeps the well-formed entries meant for `target`; a file that isn't an
 * array yields none. An entry's optional `platforms` and `below` let it
 * show on this install: an update notice names the platforms that don't
 * update themselves and the version that fixes things, so installs
 * already on it never see it.
 */
export function parseAnnouncements(raw: unknown, target: AnnouncementTarget): Announcement[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Announcement[] = [];
  for (const entry of raw as unknown[]) {
    const parsed = announcementEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const { id, level, title, text, url, platforms, below } = parsed.data;
    if (seen.has(id)) continue;
    if (platforms !== undefined && !platforms.includes(target.shell as AnnouncementShell)) continue;
    if (below !== undefined) {
      const current = parseVersion(target.version);
      // A version that can't be read can't be shown to be older.
      if (current === null || !isBelow(current, below)) continue;
    }
    seen.add(id);
    out.push({ id, level, ...(title === undefined ? {} : { title }), text, ...(url === undefined ? {} : { url }) });
  }
  return out;
}

/**
 * The newer version this install should move to, or null. Only a shell
 * the file names gets one, so Chrome and TestFlight, which update on their
 * own, stay quiet by being left out of it.
 */
export function availableUpdate(raw: unknown, target: AnnouncementTarget): string | null {
  if (!isPlainRecord(raw) || target.shell === "web") return null;
  const latest = raw[target.shell];
  const bound = parseVersion(latest);
  const current = parseVersion(target.version);
  return bound !== null && current !== null && isBelow(current, bound) ? (latest as string) : null;
}

export interface AnnouncementsHandlerDeps {
  storage: StoragePort;
  /** Read per fetch, not at startup, when the shell may not be ready to say. */
  target: () => AnnouncementTarget;
  url?: string;
  latestUrl?: string;
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
      return parseAnnouncements(await response.json(), this.deps.target());
    } catch {
      return [];
    }
  }

  /** Same plain GET as the announcements; any failure reads as "no update". */
  async fetchAvailableUpdate(): Promise<string | null> {
    try {
      const response = await this.fetchImpl(this.deps.latestUrl ?? LATEST_URL, {
        credentials: "omit",
        cache: "no-cache",
      });
      if (!response.ok) return null;
      return availableUpdate(await response.json(), this.deps.target());
    } catch {
      return null;
    }
  }

  async getDismissed(): Promise<string[]> {
    return dismissedIds(await this.deps.storage.get<unknown>(ANNOUNCEMENTS_DISMISSED_KEY));
  }

  async dismiss(req: { id: string }): Promise<void> {
    await updateStored(this.deps.storage, ANNOUNCEMENTS_DISMISSED_KEY, (stored) => {
      const dismissed = dismissedIds(stored);
      return dismissed.includes(req.id) ? undefined : [...dismissed, req.id];
    });
  }
}

const dismissedIds = stringList;
