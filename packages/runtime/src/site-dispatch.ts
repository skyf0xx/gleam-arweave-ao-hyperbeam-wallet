import type { StoragePort, WalletSummary } from "@gleam/core";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import { dispatchSiteMessage } from "./dispatch/site";
import type { ApprovalHandler } from "./handlers/approval";
import type { PointsHandler } from "./handlers/points";
import { redeemSiteInvite } from "./points-invite";
import { signSiteAttestation, siteAttestStatus } from "./points-attest";

interface SiteDispatchDeps {
  storage: StoragePort;
  points: Pick<PointsHandler, "getInviteUnlock" | "redeemInvite" | "getMemberships">;
  approval: Pick<ApprovalHandler, "requestScanAttestation">;
  activeWallet: () => Promise<WalletSummary | null>;
  dev: boolean;
}

/** Answers the messages the Gleam site's pages send, each through its own handler. */
export function createSiteDispatch({ storage, points, approval, activeWallet, dev }: SiteDispatchDeps) {
  return function dispatchSite(message: unknown, caller: CallerContext | null): Promise<unknown> {
    return dispatchSiteMessage(message, caller, {
      "gleam-points:invite": (invite) => redeemSiteInvite(invite, storage, points).catch(() => ({ ok: false })),
      "gleam-points:attest": (request) =>
        signSiteAttestation(request, {
          activeWallet,
          requestScanAttestation: (req) => approval.requestScanAttestation(req),
        }).catch((error: unknown): SiteAttestResponse => {
          console.error("Couldn't handle a scan attestation from the site.", error);
          return { ok: false, code: "signing_failed", error: "Gleam couldn't open the attestation. Open the link again." };
        }),
      "gleam-points:attest-status": () =>
        siteAttestStatus({
          activeWallet,
          isMember: async (walletId) => (await points.getMemberships())[walletId] !== undefined,
          // The check only labels the page's button; Sign still runs the real one and says what failed.
        }).catch(() => ({ ok: true })),
    }, dev);
  };
}
