import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * The background reaches unlocked keys through the keyring offscreen
 * document, which needs `chrome.offscreen`. Tests get the same in-memory
 * `Keyring` that document runs. `offscreen-keyring.*.test.ts` covers the
 * transport itself.
 */
vi.mock("./apps/extension/src/adapters/session-key-store.ts", async () => {
  const { Keyring } = await import("./packages/core/src/vault/keyring.ts");
  return { sessionKeyStore: new Keyring(), listenForKeyringConnections: () => {} };
});

/**
 * Without this, no component test in the workspace ever unmounts, so a
 * component's effect cleanup (e.g. App.tsx's `cancelled` guard around its
 * async init) never runs — the guard exists but nothing ever flips it,
 * and a later test file's jsdom teardown can race a still-pending
 * `setState` from an earlier file's leaked mount.
 */
afterEach(() => {
  cleanup();
});
