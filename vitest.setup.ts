import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

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
