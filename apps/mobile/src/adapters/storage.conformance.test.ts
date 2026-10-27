// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { describeStoragePort } from "@gleam/runtime/testing/index.ts";
import { STORE_REQUEST, type SqliteStore } from "./sqlite-channel";
import { createSqliteStore, serveSqliteStore, type SqliteDb } from "./sqlite-store";
import { connectSqliteStore, MobileStoragePort } from "./storage";

/** The plugin's connection, played by Node's own SQLite. */
function nodeSqliteDb(db = new DatabaseSync(":memory:")): SqliteDb {
  return {
    execute: async (sql) => db.exec(sql),
    query: async (sql, values = []) => ({ values: db.prepare(sql).all(...(values as string[])) }),
    executeSet: async (set) => {
      db.exec("BEGIN");
      try {
        for (const { statement, values = [] } of set) db.prepare(statement!).run(...(values as string[]));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** The worker and the UI thread, joined the way the app joins them. */
function overChannel(store: SqliteStore): { store: SqliteStore; close: () => void } {
  const worker = new EventTarget();
  const ports: MessagePort[] = [];
  serveSqliteStore(worker as Worker, store);
  const remote = connectSqliteStore({
    postMessage: (message, transfer) => {
      ports.push(...(transfer as MessagePort[]));
      worker.dispatchEvent(new MessageEvent("message", { data: message }));
    },
  });
  return { store: remote, close: () => ports.forEach((port) => port.close()) };
}

describeStoragePort("MobileStoragePort", async () => {
  const { store, close } = overChannel(createSqliteStore(async () => nodeSqliteDb()));
  return { port: new MobileStoragePort(store), cleanup: close };
});

describe("MobileStoragePort", () => {
  it("keeps local: keys across a restart and forgets session: keys", async () => {
    const db = nodeSqliteDb();
    const first = new MobileStoragePort(createSqliteStore(async () => db));
    await first.setMany({ "local:a": { n: 1 }, "local:b": [2] });
    await first.set("session:unlocked", true);

    const second = new MobileStoragePort(createSqliteStore(async () => db));
    await expect(second.get("local:a")).resolves.toEqual({ n: 1 });
    await expect(second.get("local:b")).resolves.toEqual([2]);
    await expect(second.get("session:unlocked")).resolves.toBeNull();
  });

  it("never sends a session: key to the database", async () => {
    const store = createSqliteStore(async () => nodeSqliteDb());
    const write = vi.spyOn(store, "write");
    const port = new MobileStoragePort(store);

    await port.set("session:key", { secret: 1 });
    await port.setMany({ "session:a": 1, "session:b": 2 });
    await port.remove("session:key");

    expect(write).not.toHaveBeenCalled();
  });

  it("changes nothing when the database refuses a write, and keeps writing after", async () => {
    const store = createSqliteStore(async () => nodeSqliteDb());
    const port = new MobileStoragePort(store);
    await port.set("local:a", "kept");
    const seen: unknown[] = [];
    port.watch("local:a", (value) => seen.push(value));
    vi.spyOn(store, "write").mockRejectedValueOnce(new Error("disk full"));

    await expect(port.setMany({ "local:a": "changed", "local:b": 1 })).rejects.toThrow("disk full");
    await expect(port.get("local:a")).resolves.toBe("kept");
    await expect(port.get("local:b")).resolves.toBeNull();
    expect(seen).toEqual([]);

    await port.set("local:a", "later");
    await expect(port.get("local:a")).resolves.toBe("later");
  });

  it("refuses to load a row that isn't JSON rather than reading it as missing", async () => {
    const db = new DatabaseSync(":memory:");
    const store = createSqliteStore(async () => nodeSqliteDb(db));
    await store.write([["local:good", "1"]], []);
    db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run("local:vault", "{not json");

    const port = new MobileStoragePort(store);
    await expect(port.get("local:good")).rejects.toThrow(/"local:vault" is damaged/);
    await expect(port.set("local:vault", { fresh: true })).rejects.toThrow(/damaged/);
    expect(db.prepare("SELECT value FROM kv WHERE key = ?").get("local:vault")).toEqual({ value: "{not json" });
  });

  it("tries the database again after a failed open", async () => {
    const db = nodeSqliteDb();
    const openDb = vi.fn<() => Promise<SqliteDb>>().mockRejectedValueOnce(new Error("bridge not ready")).mockResolvedValue(db);
    const port = new MobileStoragePort(createSqliteStore(openDb));

    await expect(port.get("local:a")).rejects.toThrow("bridge not ready");
    await port.set("local:a", 1);
    await expect(port.get("local:a")).resolves.toBe(1);
  });

  it("rolls back the whole batch when a statement in it fails", async () => {
    const db = new DatabaseSync(":memory:");
    const store = createSqliteStore(async () => nodeSqliteDb(db));
    await store.write([["local:a", '"kept"']], []);
    // Fails the insert of local:c, the batch's second row.
    db.exec(`CREATE TRIGGER refuse BEFORE INSERT ON kv WHEN NEW.key = 'local:c' BEGIN SELECT RAISE(ABORT, 'refused'); END`);

    const port = new MobileStoragePort(store);
    await expect(port.setMany({ "local:a": "changed", "local:c": 1 })).rejects.toThrow(/refused/);
    await expect(port.get("local:a")).resolves.toBe("kept");

    const restarted = new MobileStoragePort(store);
    await expect(restarted.get("local:a")).resolves.toBe("kept");
    await expect(restarted.get("local:c")).resolves.toBeNull();
  });

  it("keeps a committed write when a watcher throws", async () => {
    const port = new MobileStoragePort(createSqliteStore(async () => nodeSqliteDb()));
    const seen: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    port.watch("local:a", () => {
      throw new Error("watcher bug");
    });
    port.watch("local:a", (value) => seen.push(value));

    await expect(port.set("local:a", 1)).resolves.toBeUndefined();
    expect(seen).toEqual([1]);
  });

  it("rejects a key without a local: or session: area", async () => {
    const port = new MobileStoragePort(createSqliteStore(async () => nodeSqliteDb()));
    await expect(port.get("wallets")).rejects.toThrow(/must start with/);
    await expect(port.set("sync:k", 1)).rejects.toThrow(/must start with/);
  });
});

describe("serveSqliteStore", () => {
  it("serves only the first request carrying a port, and ignores other messages", () => {
    const worker = new EventTarget();
    const store = createSqliteStore(async () => nodeSqliteDb());
    serveSqliteStore(worker as Worker, store);
    const first = new MessageChannel();
    const second = new MessageChannel();
    const ports = [first.port1, first.port2, second.port1, second.port2];
    const startFirst = vi.spyOn(first.port2, "start");
    const startSecond = vi.spyOn(second.port2, "start");

    worker.dispatchEvent(new MessageEvent("message", { data: { type: STORE_REQUEST } }));
    worker.dispatchEvent(new MessageEvent("message", { data: { type: "other", port: first.port2 } }));
    expect(startFirst).not.toHaveBeenCalled();

    worker.dispatchEvent(new MessageEvent("message", { data: { type: STORE_REQUEST, port: first.port2 } }));
    worker.dispatchEvent(new MessageEvent("message", { data: { type: STORE_REQUEST, port: second.port2 } }));
    expect(startFirst).toHaveBeenCalled();
    expect(startSecond).not.toHaveBeenCalled();
    ports.forEach((port) => port.close());
  });
});
