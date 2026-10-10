import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";
import { ANNOUNCEMENTS_DISMISSED_KEY, AnnouncementsHandler, parseAnnouncements } from "./announcements";

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

describe("parseAnnouncements", () => {
  it("keeps valid entries, with or without a link", () => {
    expect(
      parseAnnouncements([
        OK,
        { id: "b", level: "critical", text: "Update now", url: "https://gleam-permaweb.vercel.app/update.html" },
        { id: "c", level: "info", text: "Thread", url: "https://x.com/gleam/status/1" },
      ]),
    ).toEqual([
      OK,
      { id: "b", level: "critical", text: "Update now", url: "https://gleam-permaweb.vercel.app/update.html" },
      { id: "c", level: "info", text: "Thread", url: "https://x.com/gleam/status/1" },
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
    expect(parseAnnouncements([...entries, OK])).toEqual([OK]);
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
        { id: 1, level: "info", text: "t" },
        OK,
        { ...OK, text: "dup" },
      ]),
    ).toEqual([OK]);
  });

  it("returns nothing for a file that isn't an array", () => {
    expect(parseAnnouncements({ id: "a" })).toEqual([]);
    expect(parseAnnouncements(null)).toEqual([]);
  });
});

describe("AnnouncementsHandler", () => {
  it("fetches and validates the file with a credential-free GET", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([OK, { id: "bad" }])));
    const handler = new AnnouncementsHandler({ storage: createFakeStorage(), url: "https://site.example/a.json", fetchImpl });

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
      const handler = new AnnouncementsHandler({ storage, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(await handler.fetchAnnouncements()).toEqual([]);
    }
  });

  it("persists dismissed ids without duplicating them", async () => {
    const storage = createFakeStorage();
    const handler = new AnnouncementsHandler({ storage });

    await handler.dismiss({ id: "a" });
    await handler.dismiss({ id: "b" });
    await handler.dismiss({ id: "a" });

    expect(await handler.getDismissed()).toEqual(["a", "b"]);
    expect(storage.store.get(ANNOUNCEMENTS_DISMISSED_KEY)).toEqual(["a", "b"]);
  });

  it("ignores a corrupt stored value", async () => {
    const handler = new AnnouncementsHandler({ storage: createFakeStorage({ [ANNOUNCEMENTS_DISMISSED_KEY]: "oops" }) });
    expect(await handler.getDismissed()).toEqual([]);
  });
});
