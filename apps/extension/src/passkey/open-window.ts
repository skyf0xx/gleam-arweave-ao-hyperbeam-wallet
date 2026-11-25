import { browser } from "wxt/browser";
import type { PasskeyWindowMode } from "@gleam/app/src/app-platform/types.ts";
import { openPopupWindow } from "@/src/popup-window";

/**
 * Opens the passkey page in its own window, where passkey setup runs. The
 * page reopens the popup on the window it came from once it's done.
 */
export async function openPasskeyWindow(mode: PasskeyWindowMode): Promise<void> {
  const params = new URLSearchParams({ mode });
  const current = await browser.windows.getCurrent().catch(() => null);
  if (current?.id !== undefined) params.set("return", String(current.id));
  await openPopupWindow(browser.runtime.getURL(`/passkey.html?${params.toString()}` as never));
}
