import type { StoragePort } from "@gleam/core";
import { isValidInviteCode } from "@gleam/core/src/points/index.ts";
import { POINTS_MEMBERSHIPS_KEY, POINTS_PENDING_INVITE_KEY } from "./handlers/points";
import { SITE_URL } from "./site-pages";

export const SITE_ORIGIN = new URL(SITE_URL).origin;

/**
 * Handles a `runtime.onMessageExternal` message from the site's
 * welcome page carrying a Gleam Points invite code (POINTS.md §
 * Attribution). Only the site's own origin is trusted, and only the code's
 * format is checked here: the server decides whether it names a real
 * wallet. A code arriving after a wallet already joined is ignored, since
 * the server only credits an install's first wallet.
 */
export async function acceptSiteInvite(
  message: unknown,
  senderOrigin: string | undefined,
  storage: StoragePort,
): Promise<{ ok: boolean }> {
  if (senderOrigin !== SITE_ORIGIN) return { ok: false };
  if (message === null || typeof message !== "object") return { ok: false };
  const { type, code } = message as Record<string, unknown>;
  if (type !== "gleam-points:invite" || typeof code !== "string" || !isValidInviteCode(code)) return { ok: false };

  const memberships = await storage.get<Record<string, unknown>>(POINTS_MEMBERSHIPS_KEY);
  if (memberships && Object.keys(memberships).length > 0) return { ok: true };

  await storage.set(POINTS_PENDING_INVITE_KEY, code);
  return { ok: true };
}
