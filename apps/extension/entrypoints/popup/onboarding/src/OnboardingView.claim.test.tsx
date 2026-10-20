import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { INVITE_REQUIRED_MESSAGE, type PointsScores, type PointsWalletScore, type RuntimePort } from "@gleam/core";
import { OnboardingView } from "./OnboardingView";
import type { ClaimPhase } from "./ClaimStep";

vi.mock("wxt/browser", () => ({ browser: { runtime: { getManifest: () => ({ version: "1.2.3" }) } } }));

afterEach(cleanup);

const PASSWORD = "correct horse battery staple";
const WALLET = { id: "w1", name: "Opal", address: "ADDR1" };

function score(overrides: Partial<PointsWalletScore> = {}): PointsWalletScore {
  return {
    address: WALLET.address,
    inviteCode: "MYCODE22",
    referred: true,
    refereeCount: 0,
    totalAtomic: "0",
    lastDay: null,
    topPercent: null,
    rank: null,
    pointsToNextRankAtomic: null,
    foundingNumber: 184,
    originalFounder: false,
    seatsLeft: 3,
    ...overrides,
  };
}

interface Backend {
  pending?: string | null;
  scores?: PointsScores | null | Error;
  joinError?: string;
}

function setup(claim: ClaimPhase | undefined, backend: Backend = {}) {
  const { pending = null, scores = { settledAt: null, wallets: [score()] }, joinError } = backend;
  const send = vi.fn(async (message: { type: string; payload: unknown }) => {
    switch (message.type) {
      case "createWallet":
        return WALLET;
      case "downloadKeyfile":
        return { ok: true, filename: "wallet-arweave-keyfile.json" };
      case "getPointsPendingInvite":
        return pending;
      case "joinPoints":
        if (joinError) throw new Error(joinError);
        return { address: WALLET.address, inviteCode: "MYCODE22", referred: pending !== null, joinedAt: 1 };
      case "getPointsScores":
        if (scores instanceof Error) throw scores;
        return scores;
      case "markPointsRevealSeen":
      case "setPointsClaimPending":
        return undefined;
      default:
        throw new Error(`unexpected ${message.type}`);
    }
  });
  const runtime = { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort;
  const onComplete = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OnboardingView runtime={runtime} onComplete={onComplete} claim={claim} />
    </QueryClientProvider>,
  );
  return { send, onComplete };
}

async function reachClaim() {
  fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));
  fireEvent.change(screen.getByPlaceholderText("At least 12 characters"), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Your wallet is ready");
  fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
}

/**
 * TanStack's mutation observer subscribes in a passive effect, and drops the
 * per-call `onSuccess` of a mutation started before it has. A click right
 * after the button appears can beat that effect on a loaded machine, so
 * flush effects before clicking.
 */
async function clickWhenSettled(name: string) {
  const button = await screen.findByRole("button", { name });
  await act(async () => {});
  fireEvent.click(button);
}

describe("claim step", () => {
  it("completes at backup when no claim phase is set", async () => {
    const { send, onComplete } = setup(undefined);
    await reachClaim();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setPointsClaimPending" }));
  });

  it("shows the claim step when backup's back button is used", async () => {
    const { onComplete } = setup("founding");
    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));
    fireEvent.change(screen.getByPlaceholderText("At least 12 characters"), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Your wallet is ready");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Start earning Gleam Points")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("marks the claim pending as soon as the wallet exists, so closing the popup can't lose it", async () => {
    const { send } = setup("founding");
    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));
    fireEvent.change(screen.getByPlaceholderText("At least 12 characters"), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Your wallet is ready");
    expect(send).toHaveBeenCalledWith({ type: "setPointsClaimPending", payload: { walletId: "w1", pending: true } });
  });

  it("offers Gleam Points in Phase 1, with the pending code and the join note", async () => {
    const { onComplete } = setup("founding", { pending: "FRIEND42" });
    await reachClaim();
    expect(await screen.findByText("Start earning Gleam Points")).toBeTruthy();
    expect(await screen.findByText("FRIEND42")).toBeTruthy();
    expect(screen.getByText(/Joining links this wallet's address to this browser/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join Gleam Points" })).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("omits the code line when none is pending", async () => {
    setup("founding");
    await reachClaim();
    await screen.findByText("Start earning Gleam Points");
    expect(screen.queryByText(/will be applied/)).toBeNull();
  });

  it("offers Gleam Points in Phase 2, and no reveal after joining", async () => {
    const { send, onComplete } = setup("open");
    await reachClaim();
    expect(await screen.findByText("Start earning Gleam Points")).toBeTruthy();

    await clickWhenSettled("Join Gleam Points");
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith({ type: "joinPoints", payload: { walletId: "w1" } });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "getPointsScores" }));
  });

  it("Not now skips without joining", async () => {
    const { send, onComplete } = setup("founding");
    await reachClaim();
    await clickWhenSettled("Not now");
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith({ type: "setPointsClaimPending", payload: { walletId: "w1", pending: false } });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "joinPoints" }));
  });

  it("shows a join failure and stays on the step", async () => {
    const { onComplete } = setup("founding", { joinError: "Couldn't join Gleam Points: server busy." });
    await reachClaim();
    await clickWhenSettled("Join Gleam Points");
    expect(await screen.findByText("Couldn't join Gleam Points: server busy.")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("sends an invite-required refusal to the invite gate", async () => {
    const { onComplete } = setup("founding", { joinError: INVITE_REQUIRED_MESSAGE });
    await reachClaim();
    await clickWhenSettled("Join Gleam Points");
    expect(await screen.findByLabelText("Invite code")).toBeTruthy();
    expect(screen.queryByText(INVITE_REQUIRED_MESSAGE)).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("founding reveal after a claim", () => {
  async function claim() {
    await reachClaim();
    await clickWhenSettled("Join Gleam Points");
  }

  it("shows the welcome, the invites and a Share on X link with the invite link, then Done closes", async () => {
    const { onComplete, send } = setup("founding");
    await claim();
    expect(await screen.findByText("You're in")).toBeTruthy();
    expect(await screen.findByText("You have 3 invites")).toBeTruthy();
    const share = screen.getByRole("link", { name: "Share on X" });
    const post = decodeURIComponent(share.getAttribute("href")!);
    expect(post).toContain("https://x.com/intent/post?text=");
    expect(post).toContain("I have 3 invites if you want to get in early.");
    expect(post).toContain("invite.html?c=MYCODE22");
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "markPointsRevealSeen" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onComplete).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "markPointsRevealSeen", payload: { walletId: "w1" } }),
    );
  });

  it("leaves the invites slot empty when the server hasn't answered", async () => {
    const { send } = setup("founding", { scores: new Error("offline") });
    await claim();
    expect(await screen.findByRole("button", { name: "Done" })).toBeTruthy();
    expect(screen.queryByText(/You have/)).toBeNull();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "markPointsRevealSeen" }));
  });

  it("skips the reveal for a wallet without a founding number", async () => {
    const { onComplete, send } = setup("founding", {
      scores: { settledAt: null, wallets: [score({ foundingNumber: null, seatsLeft: null })] },
    });
    await claim();
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "markPointsRevealSeen" }));
  });

  it("leaves the invites slot empty when the server reports no seat count", async () => {
    setup("founding", { scores: { settledAt: null, wallets: [score({ seatsLeft: null })] } });
    await claim();
    expect(await screen.findByText("You're in")).toBeTruthy();
    expect(screen.queryByText(/You have/)).toBeNull();
    expect(decodeURIComponent(screen.getByRole("link", { name: "Share on X" }).getAttribute("href")!)).toContain(
      "Just got into @gleam_wallet and I'm now earning GLEAM.",
    );
  });
});
