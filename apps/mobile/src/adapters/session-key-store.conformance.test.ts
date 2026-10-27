import { describe, expect, it } from "vitest";
import type { WalletSummary } from "@gleam/core";
import { createRuntime } from "@gleam/runtime/src/create-runtime.ts";
import { createInMemoryPlatform, describeSessionKeyStorePort } from "@gleam/runtime/testing/index.ts";
import { createWorkerSessionKeys } from "./session-key-store";

describeSessionKeyStorePort("worker session keys", async () => ({ port: createWorkerSessionKeys() }));

describe("worker session keys", () => {
  it("holds a created wallet's key until the wallet locks", async () => {
    const sessionKeys = createWorkerSessionKeys();
    const runtime = createRuntime(createInMemoryPlatform({ sessionKeys }));
    const ui = { tier: "extension" } as const;

    const wallet = (await runtime.dispatch("createWallet", { name: "Main", password: "correct horse battery" }, ui)) as WalletSummary;
    await expect(sessionKeys.has([wallet.id])).resolves.toEqual([wallet.id]);

    await runtime.dispatch("lockWallet", undefined, ui);
    await expect(sessionKeys.has([wallet.id])).resolves.toEqual([]);
    await expect(sessionKeys.sign(wallet.id, { hash: "SHA-256", saltLength: 32 }, new Uint8Array(1))).rejects.toThrow(
      /locked/,
    );
  }, 60_000);
});
