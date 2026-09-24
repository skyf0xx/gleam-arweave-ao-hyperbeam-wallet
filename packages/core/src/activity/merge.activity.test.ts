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

  it("keeps a local entry settled as failed even when the gateway reports it confirmed", () => {
    const local = [entry({ txId: "tx-1", timestamp: 100, status: "failed" })];
    const gateway = [entry({ txId: "tx-1", timestamp: 100, status: "confirmed" })];

    const page = mergeActivity(local, gateway, 10);

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.status).toBe("failed");
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

  it("marks a gateway AO transfer carrying Data-Protocol: ao and an Error tag as failed", () => {
    const gateway = [
      entry({
        txId: "ao-failed",
        timestamp: 100,
        status: "confirmed",
        tags: [
          { name: "Data-Protocol", value: "ao" },
          { name: "Error", value: "Insufficient Balance" },
        ],
      }),
    ];

    const page = mergeActivity([], gateway, 10);

    expect(page.entries[0]?.status).toBe("failed");
  });

  it("carries the Error tag's value onto the failed entry's error field", () => {
    const gateway = [
      entry({
        txId: "ao-failed",
        timestamp: 100,
        status: "confirmed",
        tags: [
          { name: "Data-Protocol", value: "ao" },
          { name: "Error", value: "Insufficient Balance" },
        ],
      }),
    ];

    const page = mergeActivity([], gateway, 10);

    expect(page.entries[0]?.error).toBe("Insufficient Balance");
  });

  it("keeps the local entry's error reason when it already settled as failed", () => {
    const local = [
      entry({ txId: "tx-1", timestamp: 100, status: "failed", error: "Insufficient Balance!" }),
    ];
    const gateway = [entry({ txId: "tx-1", timestamp: 100, status: "confirmed" })];

    const page = mergeActivity(local, gateway, 10);

    expect(page.entries[0]?.status).toBe("failed");
    expect(page.entries[0]?.error).toBe("Insufficient Balance!");
  });

  it("leaves a successful AO transfer (Data-Protocol: ao, no Error tag) confirmed", () => {
    const gateway = [
      entry({
        txId: "ao-ok",
        timestamp: 100,
        status: "confirmed",
        tags: [{ name: "Data-Protocol", value: "ao" }],
      }),
    ];

    const page = mergeActivity([], gateway, 10);

    expect(page.entries[0]?.status).toBe("confirmed");
  });

  it("never marks a non-AO (AR-native) entry as failed even without a Data-Protocol tag", () => {
    const gateway = [entry({ txId: "ar-tx", timestamp: 100, status: "confirmed", tags: [] })];

    const page = mergeActivity([], gateway, 10);

    expect(page.entries[0]?.status).toBe("confirmed");
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
