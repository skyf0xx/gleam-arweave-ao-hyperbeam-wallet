import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";

export interface StorageHarness {
  port: StoragePort;
  cleanup?: () => void | Promise<void>;
}

/** Lets a change the adapter delivers asynchronously arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/**
 * Atomicity covers one key's value never being seen half-written and a
 * `setMany` batch never being seen part-applied. Keys carry an area prefix because the
 * extension's storage requires one; every adapter must accept both.
 */
export function describeStoragePort(name: string, makeHarness: () => Promise<StorageHarness>): void {
  describe(`StoragePort conformance: ${name}`, () => {
    async function withPort(test: (port: StoragePort) => Promise<void>): Promise<void> {
      const { port, cleanup } = await makeHarness();
      try {
        await test(port);
      } finally {
        await cleanup?.();
      }
    }

    it("reads a missing key as null", () =>
      withPort(async (port) => {
        await expect(port.get("local:missing")).resolves.toBeNull();
      }));

    it("round-trips JSON values", () =>
      withPort(async (port) => {
        const values: unknown[] = [
          "text",
          0,
          true,
          [1, "two", { three: 3 }],
          { nested: { list: [{ a: 1 }, { b: null }], empty: {} } },
        ];
        for (const [index, value] of values.entries()) {
          await port.set(`local:value-${index}`, value);
          await expect(port.get(`local:value-${index}`)).resolves.toEqual(value);
        }
      }));

    it("replaces the whole value on a second set", () =>
      withPort(async (port) => {
        await port.set("local:k", { a: 1, b: 2 });
        await port.set("local:k", { c: 3 });

        await expect(port.get("local:k")).resolves.toEqual({ c: 3 });
      }));

    it("removes a key, and removing a missing key is not an error", () =>
      withPort(async (port) => {
        await port.set("local:k", 1);
        await port.remove("local:k");
        await port.remove("local:never-set");

        await expect(port.get("local:k")).resolves.toBeNull();
      }));

    it("keeps keys independent", () =>
      withPort(async (port) => {
        await port.set("local:a", 1);
        await port.set("local:b", 2);
        await port.remove("local:a");

        await expect(port.get("local:b")).resolves.toBe(2);
      }));

    it("keeps the local: and session: areas apart for the same name", () =>
      withPort(async (port) => {
        await port.set("local:k", "persistent");
        await port.set("session:k", "volatile");
        await port.remove("session:k");

        await expect(port.get("local:k")).resolves.toBe("persistent");
        await expect(port.get("session:k")).resolves.toBeNull();
      }));

    it("is not changed by editing an object after it was set", () =>
      withPort(async (port) => {
        const value = { list: [1] };
        await port.set("local:k", value);
        value.list.push(2);

        await expect(port.get("local:k")).resolves.toEqual({ list: [1] });
      }));

    it("never shows a reader half of a value", () =>
      withPort(async (port) => {
        const before = { generation: 0, items: Array.from({ length: 200 }, (_, i) => ({ i, g: 0 })) };
        const after = { generation: 1, items: Array.from({ length: 200 }, (_, i) => ({ i, g: 1 })) };
        await port.set("local:k", before);

        const write = port.set("local:k", after);
        const reads = await Promise.all(Array.from({ length: 5 }, () => port.get("local:k")));
        await write;

        for (const read of reads) expect([before, after]).toContainEqual(read);
        await expect(port.get("local:k")).resolves.toEqual(after);
      }));

    it("ends with one of the values when writes overlap", () =>
      withPort(async (port) => {
        await Promise.all([port.set("local:k", { w: 1, pad: [1, 2] }), port.set("local:k", { w: 2, pad: [3, 4] })]);

        const final = await port.get("local:k");
        expect([
          { w: 1, pad: [1, 2] },
          { w: 2, pad: [3, 4] },
        ]).toContainEqual(final);
      }));

    describe("setMany", () => {
      it("writes every entry, and each reads back", () =>
        withPort(async (port) => {
          await port.setMany({ "local:a": 1, "local:b": { nested: [2] }, "local:c": "three" });

          await expect(port.get("local:a")).resolves.toBe(1);
          await expect(port.get("local:b")).resolves.toEqual({ nested: [2] });
          await expect(port.get("local:c")).resolves.toBe("three");
        }));

      it("writes a batch in the session: area too", () =>
        withPort(async (port) => {
          await port.setMany({ "session:a": 1, "session:b": 2 });

          await expect(port.get("session:a")).resolves.toBe(1);
          await expect(port.get("session:b")).resolves.toBe(2);
        }));

      it("replaces existing values like set", () =>
        withPort(async (port) => {
          await port.set("local:a", { x: 1, y: 2 });
          await port.set("local:b", "old");
          await port.setMany({ "local:a": { z: 3 }, "local:b": "new" });

          await expect(port.get("local:a")).resolves.toEqual({ z: 3 });
          await expect(port.get("local:b")).resolves.toBe("new");
        }));

      it("is not changed by editing an object after it was written", () =>
        withPort(async (port) => {
          const value = { list: [1] };
          await port.setMany({ "local:k": value });
          value.list.push(2);

          await expect(port.get("local:k")).resolves.toEqual({ list: [1] });
        }));

      it("does nothing for an empty batch", () =>
        withPort(async (port) => {
          const seen: unknown[] = [];
          port.watch("local:a", (value) => seen.push(value));
          await port.set("local:a", 1);
          await vi.waitFor(() => expect(seen).toEqual([1]));

          await expect(port.setMany({})).resolves.toBeUndefined();
          await settle();

          expect(seen).toEqual([1]);
          await expect(port.get("local:a")).resolves.toBe(1);
        }));

      it("rejects keys from different areas and writes none of them", () =>
        withPort(async (port) => {
          await port.set("local:a", "kept");

          await expect(port.setMany({ "local:a": "changed", "local:b": 1, "session:c": 2 })).rejects.toThrow(Error);
          await settle();

          await expect(port.get("local:a")).resolves.toBe("kept");
          await expect(port.get("local:b")).resolves.toBeNull();
          await expect(port.get("session:c")).resolves.toBeNull();
        }));

      it("rejects a null or undefined value and writes none of the batch", () =>
        withPort(async (port) => {
          await port.set("local:a", "kept");

          await expect(port.setMany({ "local:a": "changed", "local:b": null })).rejects.toThrow(Error);
          await expect(port.setMany({ "local:a": "changed", "local:c": undefined })).rejects.toThrow(Error);
          await settle();

          await expect(port.get("local:a")).resolves.toBe("kept");
          await expect(port.get("local:b")).resolves.toBeNull();
          await expect(port.get("local:c")).resolves.toBeNull();
        }));

      it("never lets a watcher see one key new while another is still old", () =>
        withPort(async (port) => {
          await port.setMany({ "local:a": "a0", "local:b": "b0" });
          const reads: Array<Promise<[unknown, unknown]>> = [];
          const readBoth = () => Promise.all([port.get("local:a"), port.get("local:b")]);
          const notified: string[] = [];
          port.watch("local:a", (value) => {
            notified.push(`a:${String(value)}`);
            reads.push(readBoth());
          });
          port.watch("local:b", (value) => {
            notified.push(`b:${String(value)}`);
            reads.push(readBoth());
          });

          await port.setMany({ "local:a": "a1", "local:b": "b1" });
          await vi.waitFor(() => expect(notified.sort()).toEqual(["a:a1", "b:b1"]));

          for (const read of await Promise.all(reads)) expect(read).toEqual(["a1", "b1"]);
        }));

      it("never shows a reader a partly applied batch", () =>
        withPort(async (port) => {
          const before = { "local:a": { g: 0, pad: Array.from({ length: 200 }, (_, i) => i) }, "local:b": { g: 0 } };
          const after = { "local:a": { g: 1, pad: Array.from({ length: 200 }, (_, i) => i + 1000) }, "local:b": { g: 1 } };
          await port.setMany(before);
          const readBoth = () => Promise.all([port.get("local:a"), port.get("local:b")]);

          const early = readBoth();
          const write = port.setMany(after);
          const sameTick = readBoth();
          const [, a, b] = await Promise.all([write, port.get("local:a"), port.get("local:b")]);
          const queued: Array<Promise<unknown[]>> = [];
          queueMicrotask(() => queued.push(readBoth()));
          void Promise.resolve().then(() => Promise.resolve()).then(() => queued.push(readBoth()));
          await settle();
          const late = readBoth();

          for (const pair of [await early, await sameTick, [a, b], ...(await Promise.all(queued)), await late]) {
            expect([
              [before["local:a"], before["local:b"]],
              [after["local:a"], after["local:b"]],
            ]).toContainEqual(pair);
          }
          expect(await late).toEqual([after["local:a"], after["local:b"]]);
        }));

      it("keeps overlapping batches whole", () =>
        withPort(async (port) => {
          await Promise.all([
            port.setMany({ "local:a": 1, "local:b": 1 }),
            port.setMany({ "local:a": 2, "local:b": 2 }),
          ]);

          const [a, b] = await Promise.all([port.get("local:a"), port.get("local:b")]);
          expect(a).toBe(b);
        }));
    });

    describe("watch", () => {
      it("reports a set, then a removal as null", () =>
        withPort(async (port) => {
          const seen: unknown[] = [];
          port.watch("local:k", (value) => seen.push(value));

          await port.set("local:k", { n: 1 });
          await port.remove("local:k");

          await vi.waitFor(() => expect(seen).toEqual([{ n: 1 }, null]));
        }));

      it("reports only its own key", () =>
        withPort(async (port) => {
          const seen: unknown[] = [];
          port.watch("local:k", (value) => seen.push(value));

          await port.set("local:other", 1);
          await port.set("session:k", 1);
          await settle();

          expect(seen).toEqual([]);
        }));

      it("stops reporting once unsubscribed", () =>
        withPort(async (port) => {
          const seen: unknown[] = [];
          const unsubscribe = port.watch("local:k", (value) => seen.push(value));
          await port.set("local:k", 1);
          await vi.waitFor(() => expect(seen).toEqual([1]));

          unsubscribe();
          await port.set("local:k", 2);
          await settle();

          expect(seen).toEqual([1]);
        }));

      it("serves each watcher of a key", () =>
        withPort(async (port) => {
          const first: unknown[] = [];
          const second: unknown[] = [];
          port.watch("local:k", (value) => first.push(value));
          port.watch("local:k", (value) => second.push(value));

          await port.set("local:k", 1);

          await vi.waitFor(() => {
            expect(first).toEqual([1]);
            expect(second).toEqual([1]);
          });
        }));
    });
  });
}
