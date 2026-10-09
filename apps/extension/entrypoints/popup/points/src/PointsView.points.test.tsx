import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PointsMembership, PointsScores, RuntimePort, WalletSummary } from "@gleam/core";
import { PointsTokenRow } from "./PointsTokenRow";
import { PointsView } from "./PointsView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx1234",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

const ONE_POINT = "1000000000000";
const SETTLED_AT = "2026-10-08T00:05:00.000Z";

const MEMBERSHIP: PointsMembership = {
  address: WALLET.address,
  inviteCode: "MYCODE22",
  referred: false,
  joinedAt: Date.parse("2026-10-01T00:00:00Z"),
};

const SCORES: PointsScores = {
  settledAt: SETTLED_AT,
  wallets: [
    {
      address: WALLET.address,
      inviteCode: "MYCODE22",
      referred: false,
      refereeCount: 3,
      totalAtomic: (5n * BigInt(ONE_POINT)).toString(),
      lastDay: { holdingAtomic: ONE_POINT, refereeBonusAtomic: "0", founderBonusAtomic: "0", referrerBonusAtomic: "0" },
      topPercent: 12,
      foundingNumber: 7,
      originalFounder: false,
    },
  ],
};

function fakeRuntime(handlers: Record<string, (payload: unknown) => unknown>): RuntimePort & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
      const handler = handlers[type];
      if (!handler) throw new Error(`Unexpected message type "${type}"`);
      return handler(payload);
    }),
    onMessage: vi.fn(() => () => {}),
  } as unknown as RuntimePort & { send: ReturnType<typeof vi.fn> };
}

const BALANCES = {
  getBalance: () => ONE_POINT,
  getTokenBalances: () => [],
};

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("PointsTokenRow", () => {
  it("asks a wallet that hasn't joined to sign up, and opens the Points screen", async () => {
    const onOpen = vi.fn();
    const runtime = fakeRuntime({ ...BALANCES, getPointsMemberships: () => ({}) });

    renderWithQuery(<PointsTokenRow runtime={runtime} wallet={WALLET} onOpen={onOpen} />);
    expect(await screen.findByText("Sign up")).toBeTruthy();
    expect(screen.queryByText("GP")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Gleam Points/ }));

    expect(onOpen).toHaveBeenCalled();
  });

  it("shows a joined wallet's settled total and no USD value", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.parse(SETTLED_AT) });
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => SCORES,
    });

    renderWithQuery(<PointsTokenRow runtime={runtime} wallet={WALLET} onOpen={vi.fn()} />);

    expect(await screen.findByText("5.00 points")).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});

describe("PointsView", () => {
  it("joins with a typed invite code, then shows the wallet's standing", async () => {
    let memberships: Record<string, PointsMembership> = {};
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => memberships,
      getPointsScores: () => SCORES,
      joinPoints: () => {
        memberships = { [WALLET.id]: MEMBERSHIP };
        return MEMBERSHIP;
      },
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Invite code/), { target: { value: " friend42 " } });
    fireEvent.click(screen.getByRole("button", { name: "Join Gleam Points" }));

    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "joinPoints", payload: { walletId: WALLET.id, inviteCode: "friend42" } }),
    );
    expect(await screen.findByText("Top 12%")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("https://gleam-permaweb.vercel.app/invite.html?c=MYCODE22")).toBeTruthy();
  });

  it("shows why a join failed", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({}),
      joinPoints: () => {
        throw new Error("That invite code isn't valid.");
      },
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Join Gleam Points" }));

    expect(await screen.findByText("That invite code isn't valid.")).toBeTruthy();
  });

  it("says when the rank isn't in yet", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ settledAt: null, wallets: [] }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    expect(await screen.findByText("Your rank appears after the next daily snapshot")).toBeTruthy();
  });

  it("copies the invite link", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => SCORES,
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("https://gleam-permaweb.vercel.app/invite.html?c=MYCODE22");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("leaves after confirming, then offers to join again", async () => {
    let memberships: Record<string, PointsMembership> = { [WALLET.id]: MEMBERSHIP };
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => memberships,
      getPointsScores: () => SCORES,
      leavePoints: () => {
        memberships = {};
      },
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave Gleam Points" }));
    expect(screen.getByText(/can't be undone/)).toBeTruthy();
    expect(runtime.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "leavePoints" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "leavePoints", payload: { walletId: WALLET.id } }),
    );
    expect(await screen.findByRole("button", { name: "Join Gleam Points" })).toBeTruthy();
  });

  it("backs out of leaving with Cancel", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => SCORES,
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave Gleam Points" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/can't be undone/)).toBeNull();
    expect(screen.getByRole("button", { name: "Leave Gleam Points" })).toBeTruthy();
  });
});
