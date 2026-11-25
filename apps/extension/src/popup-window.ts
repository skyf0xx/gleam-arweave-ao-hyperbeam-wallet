import { browser } from "wxt/browser";

const POPUP_WINDOW_WIDTH = 390;
const POPUP_WINDOW_HEIGHT = 640;

/** Opens `url` in a focused popup window of the size every Gleam window uses. */
export function openPopupWindow(url: string) {
  return browser.windows.create({
    url,
    type: "popup",
    width: POPUP_WINDOW_WIDTH,
    height: POPUP_WINDOW_HEIGHT,
    focused: true,
  });
}
