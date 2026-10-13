import { browser } from "wxt/browser";

/**
 * Closes the passkey window, first reopening the Gleam popup on the
 * window it was opened from so an unlock lands the user back in Gleam.
 * `action.openPopup` needs that window focused, and is best effort: the
 * user can always click the toolbar icon.
 */
export async function returnToPopup(windowId: number | null): Promise<void> {
  if (windowId !== null) {
    try {
      await browser.windows.update(windowId, { focused: true });
      await browser.action.openPopup({ windowId });
    } catch {
      // The window was closed, or this Chrome can't open the popup itself.
    }
  }
  window.close();
}
