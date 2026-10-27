import type { InviteUnlock, WalletState } from "@gleam/core";
import { SITE_ORIGIN } from "@gleam/core/src/models/site-origin.ts";
import { isValidInviteCode } from "@gleam/core/src/points/index.ts";
import type { ParsedAttestation } from "@gleam/core/src/scan/attestation.ts";
import { decodeAttestationPayload } from "@gleam/core/src/scan/payload.ts";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { SITE_ATTEST_MESSAGE_TYPE, type SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import type { Runtime } from "@gleam/runtime";

/**
 * The only origin a Points link may come from. It is the subdomain the app
 * claims for universal links and App Links, and nothing else: the main
 * site's own pages have to keep opening in the browser.
 */
export const POINTS_LINK_ORIGIN = "https://open.gleamwallet.app";

/** Far above the longest valid attestation link, so an oversized one is refused before it's decoded. */
const MAX_LINK_LENGTH = 64 * 1024;

export type PointsLink = { kind: "invite"; code: string } | { kind: "attest"; attestation: ParsedAttestation };

/**
 * What became of a link:
 * - `dropped`: not a Points link, or a malformed one.
 * - `invite`: the invite went to the runtime; the install was already
 *   past the Founding gate, so no screen changes.
 * - `gate`: the invite went to the runtime while the install was still
 *   behind the gate, which now has a new verdict to show.
 * - `attest`: the attestation went to the approval sheet.
 * - `held`: the wallet is locked; the attestation waits for the unlock.
 */
export type PointsLinkOutcome = "dropped" | "invite" | "gate" | "attest" | "held";

/**
 * A link the OS opened the app with, as one of the two Points flows, or
 * null. Everything about it is untrusted: anyone can write such a link
 * and get it tapped. So the origin, path and parameters must match
 * exactly, and the payload goes through the same checks the site's
 * messages get on desktop.
 */
export function parsePointsLink(url: unknown): PointsLink | null {
  if (typeof url !== "string" || url.length > MAX_LINK_LENGTH) return null;
  let link: URL;
  try {
    link = new URL(url);
  } catch {
    return null;
  }
  if (link.origin !== POINTS_LINK_ORIGIN || link.username !== "" || link.password !== "") return null;

  if (link.pathname === "/invite") {
    const keys = [...link.searchParams.keys()];
    if (link.hash !== "" || keys.length !== 1 || keys[0] !== "code") return null;
    const code = link.searchParams.get("code") ?? "";
    return isValidInviteCode(code) ? { kind: "invite", code } : null;
  }
  if (link.pathname === "/attest") {
    if (link.search !== "") return null;
    const decoded = decodeAttestationPayload(link.hash.slice(1));
    return decoded.ok ? { kind: "attest", attestation: decoded.attestation } : null;
  }
  return null;
}

/**
 * A link stands in for the site's page: it reaches the same `SITE_MESSAGES`
 * handlers, schemas and approval as the site's messages do in the
 * extension. Only `open` builds these messages, and only the two kinds
 * `parsePointsLink` returns, so no page and no other message type gets the
 * `site` tier in the app.
 */
const POINTS_SITE: CallerContext = { tier: "site", origin: SITE_ORIGIN };
const WALLET_UI: CallerContext = { tier: "extension" };

function isUnlocked(state: WalletState): boolean {
  return state.session !== null && state.session.unlockedWalletIds.length > 0;
}

/**
 * The refusals that come before the approval sheet opens, so nothing on
 * screen says why the link did nothing. Every other failure (a rejection,
 * a timeout, the points API's verdict) is shown by the sheet itself.
 * Desktop words them on `attest.html`; `busy` names the sheet, not a window.
 */
const SILENT_REFUSALS: Readonly<Record<string, string | null>> = {
  no_wallet: null,
  unsupported_wallet: null,
  busy: "Gleam is already showing an attestation to sign. Finish or close it, then open the link again.",
};

function noticeFor(reply: unknown): string | null {
  const failure = reply as Partial<Extract<SiteAttestResponse, { ok: false }>> | null;
  if (failure?.ok !== false || typeof failure.code !== "string" || !Object.hasOwn(SILENT_REFUSALS, failure.code)) return null;
  return SILENT_REFUSALS[failure.code] ?? (typeof failure.error === "string" && failure.error !== "" ? failure.error : null);
}

export interface PointsLinks {
  open(url: unknown): Promise<PointsLinkOutcome>;
  /** Every `getState` the wallet UI reads, so a held attestation starts once it shows the wallet unlocked. */
  stateSeen(state: WalletState): void;
}

/**
 * Runs Points links in the runtime worker. An invite is redeemed at once,
 * locked or not, as the site's invite message is on desktop: it needs only
 * the install's device key, and the Founding gate it unlocks comes before
 * any wallet exists. An attestation needs an unlocked wallet, and the app
 * dismisses any sheet while the lock screen is up, so one that arrives
 * while locked waits for the unlock. Only the latest waits, and only in
 * memory: if the app is killed, the link is tapped again. `notify` gets a
 * sentence for an attestation that was refused before the sheet opened,
 * including one that was held; the link was opened from outside the app, so
 * nothing else would say why nothing happened.
 */
export function createPointsLinks(runtime: Pick<Runtime, "dispatch" | "dispatchSite">, notify: (notice: string) => void = () => {}): PointsLinks {
  let held: ParsedAttestation | null = null;

  const attest = (attestation: ParsedAttestation) => {
    runtime
      .dispatchSite({ type: SITE_ATTEST_MESSAGE_TYPE, attestation }, POINTS_SITE)
      .then((reply) => {
        const notice = noticeFor(reply);
        if (notice !== null) notify(notice);
      })
      .catch((error: unknown) => console.error("Couldn't handle the attestation link.", error));
  };

  return {
    async open(url) {
      const link = parsePointsLink(url);
      if (!link) return "dropped";

      if (link.kind === "invite") {
        const before = (await runtime.dispatch("getPointsInviteUnlock", undefined, WALLET_UI)) as InviteUnlock | null;
        await runtime.dispatchSite({ type: "gleam-points:invite", code: link.code }, POINTS_SITE);
        return before?.result === "ok" ? "invite" : "gate";
      }

      const state = (await runtime.dispatch("getState", undefined, WALLET_UI)) as WalletState;
      if (state.wallets.length > 0 && !isUnlocked(state)) {
        held = link.attestation;
        return "held";
      }
      held = null;
      attest(link.attestation);
      return "attest";
    },
    stateSeen(state) {
      if (held === null) return;
      if (state.wallets.length === 0) {
        held = null;
        return;
      }
      if (!isUnlocked(state)) return;
      const attestation = held;
      held = null;
      attest(attestation);
    },
  };
}
