import { describe, expect, it, vi } from "vitest";
import type { WalletSummary } from "@gleam/core";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import { ApprovalDeclinedError } from "./handlers/approval";
import { dispatchSiteMessage } from "./dispatch/site";
import { signSiteAttestation, type SiteAttestationDeps } from "./points-attest";
import { SITE_ORIGIN } from "./site-pages";

vi.mock("wxt/browser", () => ({ browser: {} }));

const ATTESTATION = {
  release: "1.4.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
  model: "claude-opus-5-5",
  challenge: "q7Xh2mB9kLp4Wz0RtY6uVa",
  answers: [
    { file: "packages/core/src/vault/encryption.ts", symbol: "decrypt", line: 120, check: "Refuses a ciphertext whose tag doesn't verify." },
    { file: "apps/extension/src/handlers/provider-params.ts", symbol: "readTransaction", line: 212, check: "Rejects a transaction with an unknown format." },
    { file: "apps/extension/src/handlers/approval.ts", symbol: "ApprovalHandler.resolveApproval", line: 300, check: "Ignores a resolution for an expired request." },
  ],
  result: "pass",
  report: "# Scan\n\nRead the vault.\n",
};
const MESSAGE = { type: "gleam-points:attest", attestation: ATTESTATION };

const WALLET = { id: "w1", address: "addr-1", name: "Main", method: "jwk" } as WalletSummary;
const PAID: SiteAttestResponse = { ok: true, attestationId: "a".repeat(64), points: "1", paid: true, paidPlacesLeft: 3 };

/** What the background does with an external message: the site dispatcher, then the attestation handler. */
function acceptSiteAttestation(message: unknown, origin: string | undefined, deps: SiteAttestationDeps) {
  return dispatchSiteMessage(message, origin, {
    "gleam-points:invite": async () => {
      throw new Error("not an attestation");
    },
    "gleam-points:attest": (request) => signSiteAttestation(request, deps),
  });
}

function deps(overrides: Partial<SiteAttestationDeps> = {}) {
  return {
    activeWallet: vi.fn(async () => WALLET),
    requestScanAttestation: vi.fn(async () => PAID),
    ...overrides,
  } satisfies SiteAttestationDeps;
}

describe("acceptSiteAttestation", () => {
  it("opens the approval for the active wallet and replies with the server's verdict", async () => {
    const d = deps();

    expect(await acceptSiteAttestation(MESSAGE, SITE_ORIGIN, d)).toEqual(PAID);
    expect(d.requestScanAttestation).toHaveBeenCalledWith({
      origin: SITE_ORIGIN,
      walletId: "w1",
      address: "addr-1",
      attestation: ATTESTATION,
    });
  });

  it.each([
    ["a dApp origin", "https://evil.example"],
    ["a look-alike origin", "https://gleamwallet.app.evil.example"],
    ["the site over http", "http://gleamwallet.app"],
    ["no origin", undefined],
  ])("refuses %s without opening anything", async (_label, origin) => {
    const d = deps();

    expect(await acceptSiteAttestation(MESSAGE, origin, d)).toMatchObject({ ok: false, code: "refused" });
    expect(d.activeWallet).not.toHaveBeenCalled();
    expect(d.requestScanAttestation).not.toHaveBeenCalled();
  });

  it.each([
    ["an extra key", { ...MESSAGE, walletId: "w2" }],
    ["no attestation", { type: "gleam-points:attest" }],
    ["an inherited attestation", Object.create(MESSAGE) as unknown],
  ])("refuses a message with %s", async (_label, message) => {
    const d = deps();

    expect(await acceptSiteAttestation(message, SITE_ORIGIN, d)).toMatchObject({ ok: false, code: "refused" });
    expect(d.requestScanAttestation).not.toHaveBeenCalled();
  });

  it.each([
    ["an array", [MESSAGE]],
    ["a string", JSON.stringify(MESSAGE)],
    ["another type", { ...MESSAGE, type: "gleam-points:sign" }],
  ])("gives a message with %s, which has no site type, the generic refusal", async (_label, message) => {
    const d = deps();

    expect(await acceptSiteAttestation(message, SITE_ORIGIN, d)).toEqual({ ok: false });
    expect(d.requestScanAttestation).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { ...ATTESTATION, points: 100 }],
    ["two answers", { ...ATTESTATION, answers: ATTESTATION.answers.slice(0, 2) }],
    ["a bidi control in the report", { ...ATTESTATION, report: "Looks fine.‮" }],
    ["a pre-release", { ...ATTESTATION, release: "1.4.0-rc.1" }],
  ])("refuses an attestation with %s before any window opens", async (_label, attestation) => {
    const d = deps();

    expect(await acceptSiteAttestation({ ...MESSAGE, attestation }, SITE_ORIGIN, d)).toMatchObject({
      ok: false,
      code: "invalid_attestation",
      error: expect.stringContaining("pnpm scan finish"),
    });
    expect(d.requestScanAttestation).not.toHaveBeenCalled();
  });

  it("says when Gleam has no wallet, or the wallet can't sign for points", async () => {
    expect(await acceptSiteAttestation(MESSAGE, SITE_ORIGIN, deps({ activeWallet: async () => null }))).toMatchObject({
      code: "no_wallet",
    });
    const ethereum = { ...WALLET, method: "ethereum" } as WalletSummary;
    expect(await acceptSiteAttestation(MESSAGE, SITE_ORIGIN, deps({ activeWallet: async () => ethereum }))).toMatchObject({
      code: "unsupported_wallet",
    });
  });

  it("maps a rejection, a timeout and a signing failure to their codes", async () => {
    const reply = (error: Error) =>
      acceptSiteAttestation(MESSAGE, SITE_ORIGIN, deps({ requestScanAttestation: async () => Promise.reject(error) }));

    expect(await reply(new ApprovalDeclinedError("The request was rejected.", false))).toMatchObject({ code: "rejected" });
    expect(await reply(new ApprovalDeclinedError("Approval request timed out.", true))).toMatchObject({ code: "timed_out" });
    expect(await reply(new Error("Wallet is locked."))).toEqual({
      ok: false,
      code: "signing_failed",
      error: "Gleam couldn't sign the attestation: Wallet is locked. Try again from the link.",
    });
  });
});
