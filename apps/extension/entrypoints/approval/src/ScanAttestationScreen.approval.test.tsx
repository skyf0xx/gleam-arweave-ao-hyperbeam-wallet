import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApprovalRequest, RuntimePort, ScanAttestationApprovalPreview, WalletState } from "@gleam/core";
import type { ApprovalShown } from "@gleam/messaging/src/protocol.ts";
import { ApprovalRoot } from "./ApprovalRoot";

vi.mock("wxt/browser", () => ({ browser: { runtime: { getManifest: () => ({ version: "1.4.0" }) } } }));

/** Each flow crosses several async hops; the default 1s is too tight when the whole suite runs at once. */
const SLOW = { timeout: 10_000 };

const PREVIEW: ScanAttestationApprovalPreview = {
  kind: "scanAttestation",
  walletId: "wallet-1",
  address: "addr-1",
  attestationId: "ab".repeat(32),
  message: `gleam-points:attest:v1:1.4.0:${"ab".repeat(32)}`,
  release: "1.4.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
  model: "claude-opus-5-5",
  challenge: "q7Xh2mB9kLp4Wz0RtY6uVa",
  result: "pass",
  answers: [
    { file: "packages/core/src/vault/encryption.ts", symbol: "decrypt", line: 120, check: "Refuses a ciphertext whose tag doesn't verify." },
    { file: "apps/extension/src/handlers/provider-params.ts", symbol: "readTransaction", line: 212, check: "Rejects a transaction with an unknown format." },
    { file: "apps/extension/src/handlers/approval.ts", symbol: "ApprovalHandler.resolveApproval", line: 300, check: "Ignores a resolution for an expired request." },
  ],
  report: '# Coverage\n\n<img src=x onerror="alert(1)"> **bold** [link](https://evil.example)',
};

const REQUEST: ApprovalRequest = {
  requestId: "req-attest",
  origin: "https://gleamwallet.app",
  kind: "scanAttestation",
  createdAt: 0,
  preview: PREVIEW,
};

const STATE: WalletState = {
  wallets: [
    { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, backupConfirmedAt: null },
  ],
  activeWalletId: "wallet-1",
  session: { unlockedAt: 0, lastActivityAt: 0, autoLockTimeout: "never", unlockedWalletIds: ["wallet-1"] },
};

function runtimeWith(handlers: Record<string, (payload: unknown) => unknown>, state: WalletState = STATE) {
  const send = vi.fn(async (message: { type: string; payload: unknown }) => {
    if (message.type === "getApproval") return REQUEST;
    if (message.type === "getState") return state;
    if (message.type === "getThemePreference") return { theme: "light" };
    if (message.type === "getSecurityPhrase") return null;
    const handler = handlers[message.type];
    if (!handler) throw new Error(`unexpected message ${message.type}`);
    return handler(message.payload);
  });
  const runtime: RuntimePort = { send: send as never, onMessage: vi.fn(() => () => {}) };
  return { runtime, send };
}

const member = {
  getPointsMemberships: () => ({ "wallet-1": { address: "addr-1", inviteCode: "ME", referred: false, joinedAt: 0 } }),
  checkScanAttestation: () => ({ ok: true }),
};

describe("ApprovalRoot: scan attestation", { timeout: 30_000 }, () => {
  it("shows every field, and the report as plain text, never as HTML or markdown", async () => {
    const { runtime } = runtimeWith(member);
    const { container } = render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    await screen.findByText("Sign scan attestation", {}, SLOW);
    expect(screen.getByText(/signs no transaction and moves no funds/)).toBeTruthy();
    expect(screen.getByText("v1.4.0")).toBeTruthy();
    expect(screen.getByText("claude-opus-5-5")).toBeTruthy();
    expect(screen.getByText(PREVIEW.commit)).toBeTruthy();
    expect(screen.getByText("addr-1")).toBeTruthy();
    expect(screen.getByText("Pass: the agent filed nothing")).toBeTruthy();
    for (const answer of PREVIEW.answers) expect(screen.getByText(answer.check)).toBeTruthy();
    expect(screen.getByTestId("attestation-report").textContent).toBe(PREVIEW.report);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector('a[href="https://evil.example"]')).toBeNull();
  });

  it("tells a hardware wallet its device signs a proof that is never posted", async () => {
    const keystone = { ...STATE, wallets: [{ ...STATE.wallets[0]!, method: "keystone" as const }] };
    const { runtime } = runtimeWith(member, keystone);
    render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    await screen.findByText(/0 AR proof of ownership that is never posted/, {}, SLOW);
  });

  it("asks to unlock the wallet the attestation was opened for, not the active one", async () => {
    const second = { ...STATE.wallets[0]!, id: "wallet-2", address: "addr-2", name: "Second" };
    // wallet-1 is pinned and unlocked; the user has since switched to a locked wallet-2.
    const switched: WalletState = { ...STATE, wallets: [...STATE.wallets, second], activeWalletId: "wallet-2" };
    render(<ApprovalRoot requestId="req-attest" runtime={runtimeWith(member, switched).runtime} />);
    await screen.findByText("Sign scan attestation", {}, SLOW);
    expect(screen.getByText("Main")).toBeTruthy();
  });

  it("shows the unlock screen when the pinned wallet is locked, even if the active one isn't", async () => {
    const second = { ...STATE.wallets[0]!, id: "wallet-2", address: "addr-2", name: "Second" };
    const pinnedLocked: WalletState = {
      wallets: [...STATE.wallets, second],
      activeWalletId: "wallet-2",
      session: { ...STATE.session!, unlockedWalletIds: ["wallet-2"] },
    };
    render(<ApprovalRoot requestId="req-attest" runtime={runtimeWith(member, pinnedLocked).runtime} />);
    await screen.findByText(/Unlock to review gleamwallet\.app's request/, {}, SLOW);
    expect(screen.queryByText("Sign scan attestation")).toBeNull();
  });

  it("signs, then shows the points earned and stays open", async () => {
    const shown: ApprovalShown = {
      shown: "scanAttestation",
      result: { ok: true, attestationId: PREVIEW.attestationId, points: "12500000000000", paid: true, unpaidReason: null, paidPlacesLeft: 4 },
    };
    const { runtime, send } = runtimeWith({ ...member, resolveApproval: () => shown });
    render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign" }, SLOW));

    await screen.findByText("+12.50 points", {}, SLOW);
    expect(send).toHaveBeenCalledWith({ type: "resolveApproval", payload: { requestId: "req-attest", approved: true } });
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("checks the attestation first, and a failed check asks for no signature and says what to do", async () => {
    const error = "The scan's challenge expired after 24 hours. To start over, ask your agent to run `pnpm scan start` and finish a new scan.";
    const resolveApproval = vi.fn();
    const { runtime, send } = runtimeWith({
      ...member,
      checkScanAttestation: () => ({ ok: false, error }),
      resolveApproval,
    });
    render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign" }, SLOW));

    expect((await screen.findByRole("alert", {}, SLOW)).textContent).toBe(error);
    expect(send).toHaveBeenCalledWith({ type: "checkScanAttestation", payload: { requestId: "req-attest" } });
    expect(resolveApproval).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's refusal as one sentence", async () => {
    const shown: ApprovalShown = {
      shown: "scanAttestation",
      result: { ok: false, code: "already_attested", error: "This wallet already attested v1.4.0." },
    };
    const { runtime } = runtimeWith({ ...member, resolveApproval: () => shown });
    render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign" }, SLOW));

    expect((await screen.findByRole("alert", {}, SLOW)).textContent).toBe("This wallet already attested v1.4.0.");
  });

  it("says when a scan was recorded after the paid places were taken", async () => {
    const shown: ApprovalShown = {
      shown: "scanAttestation",
      result: { ok: true, attestationId: PREVIEW.attestationId, points: "0", paid: false, unpaidReason: "places_taken", paidPlacesLeft: 0 },
    };
    const { runtime } = runtimeWith({ ...member, resolveApproval: () => shown });
    render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign" }, SLOW));

    await screen.findByText(/paid places were already taken/, {}, SLOW);
  });

  it("says when a scan earned nothing because no snapshot day exists yet", async () => {
    const shown: ApprovalShown = {
      shown: "scanAttestation",
      result: { ok: true, attestationId: PREVIEW.attestationId, points: "0", paid: false, unpaidReason: "no_snapshot", paidPlacesLeft: 7 },
    };
    const { runtime } = runtimeWith({ ...member, resolveApproval: () => shown });
    render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign" }, SLOW));

    await screen.findByText(/snapshot hasn't run yet/, {}, SLOW);
  });

  it("a wallet outside Gleam Points is offered the join first, then the attestation", async () => {
    let joined = false;
    const { runtime, send } = runtimeWith({
      getPointsMemberships: () => (joined ? member.getPointsMemberships() : {}),
      getPointsPendingInvite: () => null,
      joinPoints: () => {
        joined = true;
        return { address: "addr-1", inviteCode: "ME", referred: false, joinedAt: 0 };
      },
    });
    render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    await screen.findByText(/isn't in Gleam Points yet/, {}, SLOW);
    expect(screen.queryByText("Sign scan attestation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Join Gleam Points" }));

    await screen.findByText("Sign scan attestation", {}, SLOW);
    expect(send).toHaveBeenCalledWith({ type: "joinPoints", payload: { walletId: "wallet-1" } });
  });

  it("cancelling the join rejects the request", async () => {
    const { runtime, send } = runtimeWith({
      getPointsMemberships: () => ({}),
      getPointsPendingInvite: () => null,
      resolveApproval: () => undefined,
    });
    render(<ApprovalRoot requestId="req-attest" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }, SLOW));

    await waitFor(
      () => expect(send).toHaveBeenCalledWith({ type: "resolveApproval", payload: { requestId: "req-attest", approved: false } }),
      SLOW,
    );
  });
});
