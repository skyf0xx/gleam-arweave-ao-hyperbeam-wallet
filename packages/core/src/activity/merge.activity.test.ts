import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../models/activity";
import { isFirstSeenRecipient, mergeActivity } from "./merge";

function entry(overrides: Partial<ActivityEntry> & Pick<ActivityEntry, "txId" | "timestamp">): ActivityEntry {
  return {
    type: "send",
    status: "confirmed",
    address: "someAddress",
    amount: "100",
    tags: [],
    ...overrides,
  };
}

describe("mergeActivity", () => {
  it("unions entries present in only one source", () => {
    const local = [entry({ txId: "local-1", timestamp: 100 })];
    const gateway = [entry({ txId: "gateway-1", timestamp: 200 })];

    const page = mergeActivity(local, gateway, 10);

    expect(page.entries.map((e) => e.txId)).toEqual(["gateway-1", "local-1"]);
  });

  it("dedupes by txId, preferring the gateway entry's status", () => {
    const local = [entry({ txId: "tx-1", timestamp: 100, status: "pending" })];
    const gateway = [entry({ txId: "tx-1", timestamp: 100, status: "confirmed" })];

    const page = mergeActivity(local, gateway, 10);

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.status).toBe("confirmed");
  });

  it("keeps a local-only pending entry the gateway hasn't indexed yet", () => {
    const local = [entry({ txId: "still-pending", timestamp: 300, status: "pending" })];
    const gateway: ActivityEntry[] = [];

    const page = mergeActivity(local, gateway, 10);

    expect(page.entries[0]?.status).toBe("pending");
  });

  it("sorts most-recent-first", () => {
    const local = [
      entry({ txId: "a", timestamp: 1 }),
      entry({ txId: "b", timestamp: 300 }),
      entry({ txId: "c", timestamp: 150 }),
    ];

    const page = mergeActivity(local, [], 10);

    expect(page.entries.map((e) => e.txId)).toEqual(["b", "c", "a"]);
  });

  it("caps at most-recent-N and sets a cursor when truncated", () => {
    const local = [
      entry({ txId: "a", timestamp: 1 }),
      entry({ txId: "b", timestamp: 2 }),
      entry({ txId: "c", timestamp: 3 }),
    ];

    const page = mergeActivity(local, [], 2);

    expect(page.entries).toHaveLength(2);
    expect(page.entries.map((e) => e.txId)).toEqual(["c", "b"]);
    expect(page.cursor).toBe("b");
  });

  it("sets cursor to null when nothing was truncated", () => {
    const local = [entry({ txId: "a", timestamp: 1 })];
    const page = mergeActivity(local, [], 10);
    expect(page.cursor).toBeNull();
  });

  it("returns an empty page for two empty sources", () => {
    const page = mergeActivity([], [], 10);
    expect(page.entries).toEqual([]);
    expect(page.cursor).toBeNull();
  });
});

describe("isFirstSeenRecipient", () => {
  it("returns true when no entry in either source addresses the recipient", () => {
    const result = isFirstSeenRecipient("newAddr", [], []);
    expect(result).toBe(true);
  });

  it("returns false when the local log has a prior entry to that address", () => {
    const local = [entry({ txId: "tx-1", timestamp: 1, address: "knownAddr" })];
    expect(isFirstSeenRecipient("knownAddr", local, [])).toBe(false);
  });

  it("returns false when only the gateway history has a prior entry to that address", () => {
    const gateway = [entry({ txId: "tx-1", timestamp: 1, address: "knownAddr" })];
    expect(isFirstSeenRecipient("knownAddr", [], gateway)).toBe(false);
  });

  it("treats a pending local send-in-flight to the address as 'seen'", () => {
    const local = [entry({ txId: "tx-1", timestamp: 1, address: "inFlight", status: "pending" })];
    expect(isFirstSeenRecipient("inFlight", local, [])).toBe(false);
  });
});
