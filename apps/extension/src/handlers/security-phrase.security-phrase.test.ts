import { describe, expect, it } from "vitest";
import type { StoragePort } from "@gleam/core";
import { SecurityPhraseHandler } from "./security-phrase";

function memoryStorage(): StoragePort & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
    watch: () => () => {},
  } as StoragePort & { data: Map<string, unknown> };
}

describe("SecurityPhraseHandler", () => {
  it("has no phrase until one is set", async () => {
    expect(await new SecurityPhraseHandler(memoryStorage()).get()).toBeNull();
  });

  it("stores the trimmed phrase and reads it back", async () => {
    const handler = new SecurityPhraseHandler(memoryStorage());
    await handler.set({ word: " willow " });
    expect(await handler.get()).toEqual({ word: "willow" });
  });

  it("rejects an invalid phrase without overwriting the current one", async () => {
    const handler = new SecurityPhraseHandler(memoryStorage());
    await handler.set({ word: "willow" });
    await expect(handler.set({ word: "-willow" })).rejects.toThrow(/Pick a word/);
    expect(await handler.get()).toEqual({ word: "willow" });
  });

  it("reads a tampered stored value as no phrase", async () => {
    const storage = memoryStorage();
    storage.data.set("local:securityPhrase", { word: "<img src=x>" });
    expect(await new SecurityPhraseHandler(storage).get()).toBeNull();
  });
});
