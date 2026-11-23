import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";
import { ANNOUNCEMENTS_DISMISSED_KEY, AnnouncementsHandler, availableUpdate, parseAnnouncements, type AnnouncementTarget } from "./announcements";

function createFakeStorage(initial: Record<string, unknown> = {}): StoragePort & { store: Map<string, unknown> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch: () => () => {},
  } as unknown as StoragePort & { store: Map<string, unknown> };
}

const OK = { id: "a", level: "info", text: "Hello" };
const TARGET: AnnouncementTarget = { shell: "extension", version: "1.38.0" };

describe("parseAnnouncements", () => {
  it("keeps valid entries, with or without a title or link", () => {
    expect(
      parseAnnouncements([
        OK,
        { id: "b", level: "critical", text: "Update now", url: "https://gleamwallet.app/update.html" },
        { id: "c", level: "info", title: "News", text: "Thread", url: "https://x.com/gleam/status/1" },
      ], TARGET),
    ).toEqual([
      OK,
      { id: "b", level: "critical", text: "Update now", url: "https://gleamwallet.app/update.html" },
      { id: "c", level: "info", title: "News", text: "Thread", url: "https://x.com/gleam/status/1" },
    ]);
  });

  it("drops entries whose link is off the allowlist, not https, or tricks the host", () => {
    const bad = [
      "https://evil.example/x",
      "http://x.com/a",
      "https://x.com.evil.example/a",
      "https://user:pw@x.com/a",
      "https://evil.example/@x.com",
      "javascript:alert(1)",
      "not a url",
      42,
    ];
    const entries = bad.map((url, i) => ({ id: `u${i}`, level: "info", text: "t", url }));
    expect(parseAnnouncements([...entries, OK], TARGET)).toEqual([OK]);
  });

  it("drops malformed entries and duplicate ids", () => {
    expect(
      parseAnnouncements([
        null,
        "str",
        { id: "", level: "info", text: "t" },
        { id: "x", level: "warn", text: "t" },
        { id: "y", level: "info", text: "  " },
        { id: "z", level: "info" },
        { id: "t1", level: "info", title: "", text: "t" },
        { id: "t2", level: "info", title: 7, text: "t" },
        { id: 1, level: "info", text: "t" },
        OK,
        { ...OK, text: "dup" },
      ], TARGET),
    ).toEqual([OK]);
  });

  it("shows a targeted entry only on the named platforms below the given version", () => {
    const notice = { id: "update-1.39.0", level: "critical", text: "Update", platforms: ["android"], below: "1.39.0" };
    expect(parseAnnouncements([notice], { shell: "android", version: "1.38.9" })).toEqual([{ id: "update-1.39.0", level: "critical", text: "Update" }]);
    expect(parseAnnouncements([notice], { shell: "android", version: "1.9.99" })).toHaveLength(1);
    expect(parseAnnouncements([notice], { shell: "android", version: "1.39.0" })).toEqual([]);
    expect(parseAnnouncements([notice], { shell: "android", version: "2.0.0" })).toEqual([]);
    expect(parseAnnouncements([notice], { shell: "ios", version: "1.38.0" })).toEqual([]);
    expect(parseAnnouncements([notice], { shell: "web", version: "1.38.0" })).toEqual([]);
    expect(parseAnnouncements([{ ...notice, platforms: undefined }], { shell: "extension", version: "1.38.0" })).toHaveLength(1);
    expect(parseAnnouncements([{ ...notice, below: undefined }], { shell: "android", version: "9.0.0" })).toHaveLength(1);
  });

  it("drops an entry whose targeting is malformed, and hides one from a version it can't read", () => {
    const bad = [{ platforms: [] }, { platforms: "android" }, { platforms: ["extension", "linux"] }, { below: "1.39" }, { below: "v1.39.0" }, { below: 139 }];
    expect(parseAnnouncements([...bad.map((t, i) => ({ id: `b${i}`, level: "info", text: "t", ...t })), OK], TARGET)).toEqual([OK]);
    expect(parseAnnouncements([{ ...OK, below: "1.39.0" }], { shell: "extension", version: "0.0.0-test" })).toEqual([]);
  });

  it("returns nothing for a file that isn't an array", () => {
    expect(parseAnnouncements({ id: "a" }, TARGET)).toEqual([]);
    expect(parseAnnouncements(null, TARGET)).toEqual([]);
  });
});

describe("AnnouncementsHandler", () => {
  it("fetches and validates the file with a credential-free GET", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([OK, { id: "bad" }])));
    const handler = new AnnouncementsHandler({ target: () => TARGET, storage: createFakeStorage(), url: "https://site.example/a.json", fetchImpl });

    expect(await handler.fetchAnnouncements()).toEqual([OK]);
    expect(fetchImpl).toHaveBeenCalledWith("https://site.example/a.json", expect.objectContaining({ credentials: "omit" }));
  });

  it("returns an empty list on an HTTP error, bad JSON or a network failure", async () => {
    const storage = createFakeStorage();
    for (const fetchImpl of [
      vi.fn(async () => new Response("nope", { status: 404 })),
      vi.fn(async () => new Response("{not json")),
      vi.fn(async () => {
        throw new Error("offline");
      }),
    ]) {
      const handler = new AnnouncementsHandler({ storage, target: () => TARGET, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(await handler.fetchAnnouncements()).toEqual([]);
    }
  });

  it("persists dismissed ids without duplicating them", async () => {
    const storage = createFakeStorage();
    const handler = new AnnouncementsHandler({ storage, target: () => TARGET });

    await handler.dismiss({ id: "a" });
    await handler.dismiss({ id: "b" });
    await handler.dismiss({ id: "a" });

    expect(await handler.getDismissed()).toEqual(["a", "b"]);
    expect(storage.store.get(ANNOUNCEMENTS_DISMISSED_KEY)).toEqual(["a", "b"]);
  });

  it("keeps both ids when two dismissals run at once", async () => {
    const handler = new AnnouncementsHandler({ storage: createFakeStorage(), target: () => TARGET });

    await Promise.all([handler.dismiss({ id: "a" }), handler.dismiss({ id: "b" })]);

    expect((await handler.getDismissed()).sort()).toEqual(["a", "b"]);
  });

  it("ignores a corrupt stored value", async () => {
    const handler = new AnnouncementsHandler({ target: () => TARGET, storage: createFakeStorage({ [ANNOUNCEMENTS_DISMISSED_KEY]: "oops" }) });
    expect(await handler.getDismissed()).toEqual([]);
  });
});

describe("availableUpdate", () => {
  const android = (version: string): AnnouncementTarget => ({ shell: "android", version });

  it("names a newer release for the install's own shell", () => {
    expect(availableUpdate({ android: "1.54.0" }, android("1.53.3"))).toBe("1.54.0");
    expect(availableUpdate({ android: "2.0.0" }, android("1.99.99"))).toBe("2.0.0");
  });

  it("stays quiet when current, ahead, unlisted or unreadable", () => {
    expect(availableUpdate({ android: "1.54.0" }, android("1.54.0"))).toBeNull();
    expect(availableUpdate({ android: "1.54.0" }, android("1.55.0"))).toBeNull();
    expect(availableUpdate({ android: "1.54.0" }, { shell: "extension", version: "1.0.0" })).toBeNull();
    expect(availableUpdate({ android: "1.54.0" }, { shell: "web", version: "1.0.0" })).toBeNull();
    expect(availableUpdate({ android: "1.54" }, android("1.0.0"))).toBeNull();
    expect(availableUpdate({ android: "1.54.0" }, android("dev"))).toBeNull();
    expect(availableUpdate([], android("1.0.0"))).toBeNull();
    expect(availableUpdate(null, android("1.0.0"))).toBeNull();
  });

  it("reads the site file with a credential-free GET, and any failure is no update", async () => {
    const storage = createFakeStorage();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ android: "1.54.0" })));
    const handler = new AnnouncementsHandler({ storage, target: () => android("1.53.3"), latestUrl: "https://site.example/latest.json", fetchImpl });
    expect(await handler.fetchAvailableUpdate()).toBe("1.54.0");
    expect(fetchImpl).toHaveBeenCalledWith("https://site.example/latest.json", expect.objectContaining({ credentials: "omit" }));

    const failing = new AnnouncementsHandler({ storage, target: () => android("1.53.3"), fetchImpl: vi.fn(async () => new Response("", { status: 404 })) });
    expect(await failing.fetchAvailableUpdate()).toBeNull();
    const offline = new AnnouncementsHandler({ storage, target: () => android("1.53.3"), fetchImpl: vi.fn(async () => { throw new Error("offline"); }) });
    expect(await offline.fetchAvailableUpdate()).toBeNull();
  });
});
