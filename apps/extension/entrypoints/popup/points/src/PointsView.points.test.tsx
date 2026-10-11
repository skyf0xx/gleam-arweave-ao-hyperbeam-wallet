import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PointsMembership, PointsScores, RuntimePort, WalletSummary } from "@gleam/core";
import { PointsTokenRow } from "./PointsTokenRow";
import { PointsView } from "./PointsView";

vi.mock("wxt/browser", () => ({ browser: { runtime: { getManifest: () => ({ version: "1.2.3" }) } } }));

const POINTS_URL = "https://gleam-permaweb.vercel.app/points.html?v=1.2.3";
const GLEAM_URL = "https://gleam-permaweb.vercel.app/gleam.html?v=1.2.3";
const LINK = "https://gleam-permaweb.vercel.app/invite.html?c=MYCODE22";

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
      seatsLeft: 3,
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
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeTruthy();
  });

  it("lays out the not-joined state in order, pre-filled from the pending code", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({}),
      getPointsPendingInvite: () => "PENDING1",
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    const field = (await screen.findByLabelText(/Invite code/)) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("PENDING1"));

    const line = screen.getByText("Earn Gleam Points every day");
    const join = screen.getByRole("button", { name: "Join Gleam Points" });
    const note = screen.getByText(/Joining links this wallet's address to this browser/);
    expect(screen.queryAllByRole("link")).toEqual([]);
    const about = screen.getByRole("button", { name: "About Gleam Points" });
    fireEvent.click(about);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([POINTS_URL, GLEAM_URL]);
    expect(screen.queryByRole("button", { name: "Leave Gleam Points" })).toBeNull();
    for (const [before, after] of [[line, field], [field, join], [join, note], [note, about]] as const) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    fireEvent.click(join);
    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "joinPoints", payload: { walletId: WALLET.id, inviteCode: "PENDING1" } }),
    );
  });

  it("lays out the joined state in order: standing, invite, footer", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => SCORES,
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    expect(await screen.findByText("Top 12%")).toBeTruthy();
    expect(screen.queryByText(/OG/)).toBeNull();
    expect(screen.queryByText(/Early member/)).toBeNull();

    const standing = within(screen.getByRole("region", { name: "Standing" }));
    expect(standing.getByText(/^[\d.,]+ points$/)).toBeTruthy();
    expect(standing.getByText("Per day").nextElementSibling?.textContent).toBe("+1.00");
    expect(standing.getByText("Friends joined").nextElementSibling?.textContent).toBe("3");

    expect(screen.getByRole("heading", { name: "3 invites remaining" })).toBeTruthy();
    expect(screen.getByText("Invite friends to earn more Gleam Points.")).toBeTruthy();
    const share = screen.getByRole("link", { name: "Invite on X" });
    expect(share.getAttribute("href")).toBe(
      `https://x.com/intent/post?text=${encodeURIComponent(`Just joined @gleam_wallet and I'm now earning GLEAM. I have 3 invites if you want to get in early.\n${LINK}\n@ArweaveEco @aoTheComputer`)}`,
    );

    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Invite on X"]);
    expect(screen.queryByRole("button", { name: "Leave Gleam Points" })).toBeNull();
    const about = screen.getByRole("button", { name: "About Gleam Points" });
    expect(about.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(about);
    expect(about.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /How to earn points/ }).getAttribute("href")).toBe(POINTS_URL);
    expect(screen.getByRole("link", { name: /The future of Gleam/ }).getAttribute("href")).toBe(GLEAM_URL);
    const leave = screen.getByRole("button", { name: "Leave Gleam Points" });
    expect(screen.getByRole("link", { name: /The future of Gleam/ }).compareDocumentPosition(leave) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const sections = [
      screen.getByRole("region", { name: "Standing" }),
      screen.getByRole("region", { name: "Invite" }),
      screen.getByRole("contentinfo"),
    ];
    for (let i = 1; i < sections.length; i += 1) {
      expect(sections[i - 1]!.compareDocumentPosition(sections[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("shows the early member bonus in Standing", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ ...SCORES, wallets: [{ ...SCORES.wallets[0]!, originalFounder: true }] }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    expect(await screen.findByText("Earning 10% more as an early member")).toBeTruthy();
  });

  it("leaves the invite slots empty until the server reports them", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({
        ...SCORES,
        wallets: [{ ...SCORES.wallets[0]!, foundingNumber: null, seatsLeft: null }],
      }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    expect(await screen.findByText("Top 12%")).toBeTruthy();

    expect(screen.queryByText(/invites? remaining/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Invite friends" })).toBeTruthy();
    const href = screen.getByRole("link", { name: "Invite on X" }).getAttribute("href")!;
    expect(decodeURIComponent(href)).toContain(`Just joined @gleam_wallet and I'm now earning GLEAM.\n${LINK}`);
  });

  it("says the invites are used and offers nothing to share at zero seats", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ ...SCORES, wallets: [{ ...SCORES.wallets[0]!, seatsLeft: 0 }] }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "All your invites are used" })).toBeTruthy();
    expect(screen.getByText("You get another when a friend you invited joins Points.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Invite on X" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy invite link" })).toBeNull();
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

  it("shows a dash for rank until the wallet is ranked", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ settledAt: null, wallets: [] }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const standing = within(await screen.findByRole("region", { name: "Standing" }));
    expect(standing.getByText("Rank").nextElementSibling?.textContent).toBe("—");
  });

  it("shows rank only in the top half", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ ...SCORES, wallets: [{ ...SCORES.wallets[0]!, topPercent: 100 }] }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const standing = within(await screen.findByRole("region", { name: "Standing" }));
    await waitFor(() => expect(standing.getByText("Friends joined").nextElementSibling?.textContent).toBe("3"));
    expect(standing.getByText("Rank").nextElementSibling?.textContent).toBe("—");
    expect(screen.queryByText(/Top \d+%/)).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: "Copy invite link" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "About Gleam Points" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave Gleam Points" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "About Gleam Points" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave Gleam Points" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/can't be undone/)).toBeNull();
    expect(screen.getByRole("button", { name: "Leave Gleam Points" })).toBeTruthy();
  });
});
