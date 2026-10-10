import { browser } from "wxt/browser";
import type { BadgePort } from "@gleam/core";

/**
 * Implements `BadgePort` over `browser.action`. The dot is a badge with a
 * single bullet in the beam's purple: an empty text hides the badge.
 */
export const actionBadge: BadgePort = {
  async setDot(visible) {
    await browser.action.setBadgeText({ text: visible ? "•" : "" });
    if (visible) await browser.action.setBadgeBackgroundColor({ color: "#8b12ff" });
  },
};
