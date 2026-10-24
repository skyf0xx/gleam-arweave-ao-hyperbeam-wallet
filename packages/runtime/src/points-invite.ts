import type { InviteRedeemResult, InviteUnlock, StoragePort } from "@gleam/core";
import type { SiteMessage } from "./dispatch/methods";
import { POINTS_MEMBERSHIPS_KEY } from "./handlers/points";

export interface InviteRedeemer {
  getInviteUnlock(): Promise<InviteUnlock | null>;
  redeemInvite(code: string): Promise<InviteUnlock>;
}

/**
 * Handles the site's welcome page handing over a Gleam Points invite code
 * (POINTS.md § Attribution), once `dispatchSiteMessage` has checked its
 * origin and the code's format. The server decides whether it names a
 * real wallet. The code is redeemed at once with the device key, which unlocks
 * the install (POINTS.md § Extension), and the reply carries the outcome
 * so the page can say what happened. A code arriving after a wallet already
 * joined is ignored, since the server only credits an install's first
 * wallet.
 */
export async function redeemSiteInvite(
  { code }: SiteMessage<"gleam-points:invite">,
  storage: StoragePort,
  redeemer: InviteRedeemer,
): Promise<{ ok: true; redeem: InviteRedeemResult }> {

  const memberships = await storage.get<Record<string, unknown>>(POINTS_MEMBERSHIPS_KEY);
  if (memberships && Object.keys(memberships).length > 0) {
    return { ok: true, redeem: (await redeemer.getInviteUnlock())?.result ?? "ok" };
  }

  return { ok: true, redeem: (await redeemer.redeemInvite(code)).result };
}
