import { afterEach, describe, expect, it, vi } from "vitest";
import { STORE_REVIEWS_URL } from "@gleam/core";

vi.mock("wxt/browser", () => ({ browser: { runtime: { getManifest: () => ({ version: "1.0.0" }) } } }));
vi.mock("@/src/hardware/open-connect", () => ({ openConnectPage: vi.fn() }));
vi.mock("@/src/passkey/open-window", () => ({ openPasskeyWindow: vi.fn() }));
vi.mock("./runtime", () => ({ runtimePort: {} }));

import { createExtensionAppPlatform } from "./app-platform";

afterEach(() => vi.unstubAllGlobals());

describe("extension storeReview", () => {
  it("opens the Chrome Web Store reviews page in a new tab, synchronously with the click", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const { storeReview } = createExtensionAppPlatform("popup");
    expect(storeReview.opensPage).toBe(true);
    void storeReview.request();
    expect(open).toHaveBeenCalledWith(STORE_REVIEWS_URL, "_blank", "noreferrer");
  });
});
