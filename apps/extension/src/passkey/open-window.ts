import { browser } from "wxt/browser";
import type { PasskeyWindowMode } from "@gleam/app/src/app-platform/types.ts";


const PASSKEY_WINDOW_WIDTH = 390;
const PASSKEY_WINDOW_HEIGHT = 640;

/**
 * Opens the passkey page in its own window, where passkey setup runs. The
 * page reopens the popup on the window it came from once it's done.
 */
export async function openPasskeyWindow(mode: PasskeyWindowMode): Promise<void> {
  const params = new URLSearchParams({ mode });
  const current = await browser.windows.getCurrent().catch(() => null);
  if (current?.id !== undefined) params.set("return", String(current.id));
  await browser.windows.create({
    url: browser.runtime.getURL(`/passkey.html?${params.toString()}` as never),
    type: "popup",
    width: PASSKEY_WINDOW_WIDTH,
    height: PASSKEY_WINDOW_HEIGHT,
    focused: true,
  });
}
