import { describe, expect, it } from "vitest";
import type { ActivityEntry, StoragePort, Wallet } from "@gleam/core";
import { REVIEW_PROMPT_DONE_KEY, ReviewPromptHandler, SETTLED_AFTER_MS } from "./review-prompt";

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

const NOW = 1_000_000_000_000;
const OPENED = NOW - 1_000;

function wallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: "w1",
    address: "addr-1",
    name: "One",
    method: "jwk",
    publicKey: "pub",
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    encryptedKeyfile: null,
    backupConfirmedAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    txId: "tx",
    type: "send",
    status: "confirmed",
    address: "addr-2",
    amount: "1",
    tags: [],
    timestamp: OPENED - 10_000,
    ...overrides,
  };
}

function handler(initial: Record<string, unknown>) {
  const storage = createFakeStorage(initial);
  return { storage, prompt: new ReviewPromptHandler({ storage, now: () => NOW }) };
}

describe("ReviewPromptHandler", () => {
  it("has nothing to ask about before a good moment", async () => {
    const { prompt } = handler({ "local:wallets": [wallet()], "local:activityLog:addr-1": [entry({ status: "pending" })] });
    expect(await prompt.get({ since: OPENED })).toBeNull();
  });

  it("asks after a confirmed send", async () => {
    expect(
      await handler({ "local:wallets": [wallet()], "local:activityLog:addr-1": [entry()] }).prompt.get({ since: OPENED }),
    ).toEqual({ kind: "send" });
  });

  it("waits for the next visit when the send was made in this one", async () => {
    const { prompt } = handler({ "local:wallets": [wallet()], "local:activityLog:addr-1": [entry({ timestamp: OPENED + 1 })] });
    expect(await prompt.get({ since: OPENED })).toBeNull();
  });

  it("asks after a hardware wallet connected before this visit", async () => {
    const ledger = wallet({ method: "ledger", createdAt: OPENED - 5_000 });
    expect(await handler({ "local:wallets": [ledger] }).prompt.get({ since: OPENED })).toEqual({
      kind: "hardware",
      device: "Ledger",
    });
    const justAdded = wallet({ method: "keystone", createdAt: OPENED + 1 });
    expect(await handler({ "local:wallets": [justAdded] }).prompt.get({ since: OPENED })).toBeNull();
  });

  it("asks a quiet user after two weeks", async () => {
    const old = wallet({ createdAt: NOW - SETTLED_AFTER_MS });
    expect(await handler({ "local:wallets": [old] }).prompt.get({ since: OPENED })).toEqual({ kind: "settled" });
  });

  it("never asks again once finished", async () => {
    const { prompt, storage } = handler({ "local:wallets": [wallet()], "local:activityLog:addr-1": [entry()] });
    await prompt.finish();
    expect(storage.store.get(REVIEW_PROMPT_DONE_KEY)).toBe(true);
    expect(await prompt.get({ since: OPENED })).toBeNull();
  });
});
