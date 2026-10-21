import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PointsMembership, PointsScores, RuntimePort, WalletSummary } from "@gleam/core";
import { PointsTokenRow } from "./PointsTokenRow";
import { PointsView } from "./PointsView";

vi.mock("wxt/browser", () => ({ browser: { runtime: { getManifest: () => ({ version: "1.2.3" }) } } }));

const POINTS_URL = "https://gleamwallet.app/points.html?v=1.2.3";
const GLEAM_URL = "https://gleamwallet.app/gleam.html?v=1.2.3";
const LINK = "https://gleamwallet.app/invite.html?c=MYCODE22";
const SCAN_URL = "https://gleamwallet.app/scan.html?v=1.2.3";

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

const LEDGER_WALLET: WalletSummary = { ...WALLET, method: "ledger", device: { kind: "ledger" } };
/** Modeled but never produced; it has no Arweave key to prove ownership with. */
const ETHEREUM_WALLET: WalletSummary = { ...WALLET, method: "ethereum" };

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
      rank: 5,
      pointsToNextRankAtomic: "1801000000000",
      foundingNumber: 7,
      originalFounder: false,
      seatsLeft: 3,
    },
  ],
};

function fakeRuntime(handlers: Record<string, (payload: unknown) => unknown>): RuntimePort & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
      // Most tests don't care about the review section's figures.
      const handler = handlers[type] ?? (type === "getScanStats" ? () => null : undefined);
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

  it("offers a hardware wallet Sign up too", async () => {
    const runtime = fakeRuntime({ ...BALANCES, getPointsMemberships: () => ({}) });

    renderWithQuery(<PointsTokenRow runtime={runtime} wallet={LEDGER_WALLET} onOpen={vi.fn()} />);
    expect(await screen.findByText("Sign up")).toBeTruthy();
  });

  it("says Points is unavailable for a wallet that can't join", async () => {
    const runtime = fakeRuntime({ ...BALANCES, getPointsMemberships: () => ({}) });

    renderWithQuery(<PointsTokenRow runtime={runtime} wallet={ETHEREUM_WALLET} onOpen={vi.fn()} />);
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Sign up")).toBeNull();
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

  it("shortens a large total and keeps the full number on hover", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.parse(SETTLED_AT) });
    const wallet = { ...SCORES.wallets[0]!, totalAtomic: (194_180n * BigInt(ONE_POINT)).toString() };
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ ...SCORES, wallets: [wallet] }),
    });

    renderWithQuery(<PointsTokenRow runtime={runtime} wallet={WALLET} onOpen={vi.fn()} />);

    const short = await screen.findByText("194.1K points");
    expect(short.parentElement?.getAttribute("title")).toBe("194,180 points");
    expect(screen.getByText("194,180 points").className).toContain("sr-only");
  });
});

describe("PointsView", () => {
  it("offers a member a review with the paid places left", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => SCORES,
      getScanStats: () => ({ total: 7, paidPlacesLeft: 93, rewardAtomic: "12500000000000" }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const review = within(await screen.findByRole("region", { name: "Review" }));
    expect(review.getByRole("heading", { name: "Review a release" })).toBeTruthy();
    const link = review.getByRole("link", { name: /Start a review/ });
    expect(link.getAttribute("href")).toBe(`${SCAN_URL}#review`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(await review.findByText("93 of 100 paid places left")).toBeTruthy();
    expect(review.getByText("+12.50 GLEAM per review")).toBeTruthy();
  });

  it("keeps the review link once the paid places are taken", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => SCORES,
      getScanStats: () => ({ total: 131, paidPlacesLeft: 0, rewardAtomic: "12500000000000" }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const review = within(await screen.findByRole("region", { name: "Review" }));
    expect(await review.findByText(/Paid places for this release are taken/)).toBeTruthy();
    expect(review.getByRole("link", { name: /Start a review/ })).toBeTruthy();
    expect(review.queryByText(/per review/)).toBeNull();
  });

  it("drops the places line when the stats can't be read", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => SCORES,
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const review = within(await screen.findByRole("region", { name: "Review" }));
    await waitFor(() => expect(runtime.send).toHaveBeenCalledWith({ type: "getScanStats", payload: undefined }));
    expect(review.queryByText(/paid places/)).toBeNull();
    expect(review.queryByText(/per review/)).toBeNull();
  });

  it("hides the review section until the wallet has joined", async () => {
    const runtime = fakeRuntime({ ...BALANCES, getPointsMemberships: () => ({}), getPointsPendingInvite: () => null });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Join Gleam Points" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Review" })).toBeNull();
    expect(runtime.send).not.toHaveBeenCalledWith({ type: "getScanStats", payload: undefined });
  });

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

  it("lets a hardware wallet join and points to the approval window while its device signs", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({}),
      getPointsPendingInvite: () => null,
      joinPoints: () => new Promise(() => {}),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={LEDGER_WALLET} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Join Gleam Points" }));

    expect((await screen.findByRole("status")).textContent).toBe("Approve on your device in the window that opened.");
    expect(runtime.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "joinPoints", payload: expect.objectContaining({ walletId: LEDGER_WALLET.id }) }),
    );
  });

  it("disables joining for a wallet that can't join and says why", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({}),
      getPointsPendingInvite: () => null,
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={ETHEREUM_WALLET} onBack={vi.fn()} />);

    const button = await screen.findByRole("button", { name: "Join Gleam Points" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This wallet can't join Gleam Points. Switch to a keyfile wallet.")).toBeTruthy();
    fireEvent.click(button);
    expect(runtime.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "joinPoints" }));
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
    expect(screen.getByRole("heading", { name: "Ways to earn" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Invite" })).getByText("+10% of each friend's daily points")).toBeTruthy();
    const share = screen.getByRole("link", { name: "Invite on X" });
    expect(share.getAttribute("href")).toBe(
      `https://x.com/intent/post?text=${encodeURIComponent(`Just joined @gleam_wallet and I'm now earning GLEAM. I have 3 invites if you want to get in early.\n${LINK}\n@ArweaveEco @aoTheComputer`)}`,
    );

    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Invite on X", "Start a review↗"]);
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

  it("offers to reconnect a wallet the server lists under another install", async () => {
    let wallets: PointsScores["wallets"] = [];
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ settledAt: null, wallets }),
      joinPoints: () => {
        wallets = SCORES.wallets;
        return MEMBERSHIP;
      },
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const notice = within(await screen.findByRole("region", { name: "Reconnect" }));
    expect(notice.getByRole("heading", { name: "Linked to another browser" })).toBeTruthy();
    expect(screen.getByText("Rank").nextElementSibling?.textContent).toBe("—");
    expect(screen.queryByRole("heading", { name: "Ways to earn" })).toBeNull();
    fireEvent.click(notice.getByRole("button", { name: "Reconnect this browser" }));

    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "joinPoints", payload: { walletId: WALLET.id } }),
    );
    expect(await screen.findByRole("heading", { name: "Ways to earn" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Reconnect" })).toBeNull();
  });

  it("shows why a reconnect failed", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ settledAt: null, wallets: [] }),
      joinPoints: () => {
        throw new Error("Couldn't join Gleam Points: HTTP 503");
      },
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect this browser" }));

    expect(await screen.findByText("Couldn't join Gleam Points: HTTP 503")).toBeTruthy();
  });

  it("doesn't offer a reconnect before the scores load", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => new Promise(() => {}),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const standing = within(await screen.findByRole("region", { name: "Standing" }));
    expect(standing.getByText("Rank").nextElementSibling?.textContent).toBe("—");
    expect(screen.queryByRole("region", { name: "Reconnect" })).toBeNull();
  });

  it("shows rank in the bottom half too", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({ ...SCORES, wallets: [{ ...SCORES.wallets[0]!, topPercent: 100 }] }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const standing = within(await screen.findByRole("region", { name: "Standing" }));
    await waitFor(() => expect(standing.getByText("Rank").nextElementSibling?.textContent).toBe("Top 100%"));
  });

  it("says Unranked, with why, until a snapshot credits the wallet", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({
        ...SCORES,
        wallets: [{ ...SCORES.wallets[0]!, rank: null, topPercent: null, pointsToNextRankAtomic: null }],
      }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const unranked = await screen.findByText("Unranked");
    expect(unranked.getAttribute("title")).toMatch(/daily snapshot/);
    expect(screen.queryByText(/Your rank is/)).toBeNull();
  });

  it("shows the private rank and the points needed to pass the next one", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => SCORES,
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    expect(await screen.findByText("Your rank is #5. 1.80 points to pass the next one.")).toBeTruthy();
  });

  it("shows #1 for the leader, even as the only ranked wallet", async () => {
    const runtime = fakeRuntime({
      ...BALANCES,
      getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
      getPointsScores: () => ({
        ...SCORES,
        wallets: [{ ...SCORES.wallets[0]!, rank: 1, topPercent: 100, pointsToNextRankAtomic: null }],
      }),
    });

    renderWithQuery(<PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />);

    const standing = within(await screen.findByRole("region", { name: "Standing" }));
    await waitFor(() => expect(standing.getByText("Rank").nextElementSibling?.textContent).toBe("#1"));
    expect(screen.queryByText(/Your rank is/)).toBeNull();
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

    expect(writeText).toHaveBeenCalledWith("https://gleamwallet.app/invite.html?c=MYCODE22");
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
