import { browser } from "wxt/browser";
import type { BadgePort } from "@gleam/core";
import type { LockIndicatorPort } from "@gleam/runtime/src/platform.ts";

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

/** Implements `LockIndicatorPort` by swapping the toolbar icon for its locked variant. */
export const actionLockIcon: LockIndicatorPort = {
  async setLocked(locked) {
    const suffix = locked ? "-locked" : "";
    await browser.action.setIcon({
      path: {
        16: `/icon/16${suffix}.png`,
        32: `/icon/32${suffix}.png`,
        48: `/icon/48${suffix}.png`,
        128: `/icon/128${suffix}.png`,
      },
    });
  },
};
