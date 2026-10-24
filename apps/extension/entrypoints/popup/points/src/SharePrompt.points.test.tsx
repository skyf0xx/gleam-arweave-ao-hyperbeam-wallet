import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithPlatform as render } from "@/src/app-platform/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PointsMembership, PointsScores, PointsWalletScore, RuntimePort, WalletSummary } from "@gleam/core";
import { PointsView } from "./PointsView";
import { pickSharePrompt } from "./SharePrompt";

const LINK = "https://gleamwallet.app/invite.html?c=MYCODE22";

afterEach(cleanup);

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

const MEMBERSHIP: PointsMembership = { address: WALLET.address, inviteCode: "MYCODE22", referred: false, joinedAt: 1 };

function scoreWith(overrides: Partial<PointsWalletScore>): PointsWalletScore {
  return {
    address: WALLET.address,
    inviteCode: "MYCODE22",
    referred: false,
    refereeCount: 0,
    totalAtomic: "0",
    lastDay: null,
    topPercent: 12,
    rank: 5,
    pointsToNextRankAtomic: null,
    foundingNumber: 184,
    originalFounder: false,
    seatsLeft: 3,
    ...overrides,
  };
}

interface Options {
  score?: Partial<PointsWalletScore>;
  shareSeen?: Record<string, string[]>;
  seatsSeen?: Record<string, number>;
  revealSeen?: string[];
}

function setup(options: Options = {}) {
  const scores: PointsScores = { settledAt: null, wallets: [scoreWith(options.score ?? {})] };
  const handlers: Record<string, (payload: unknown) => unknown> = {
    getBalance: () => "0",
    getTokenBalances: () => [],
    getPointsMemberships: () => ({ [WALLET.id]: MEMBERSHIP }),
    getPointsScores: () => scores,
    getPointsShareSeen: () => options.shareSeen ?? {},
    getPointsSeatsSeen: () => options.seatsSeen ?? { [WALLET.id]: 3 },
    getPointsRevealSeen: () => options.revealSeen ?? [WALLET.id],
    markPointsSeatsSeen: () => undefined,
    markPointsShareSeen: () => undefined,
  };
  const runtime = {
    send: vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
      const handler = handlers[type];
      if (!handler) throw new Error(`Unexpected message type "${type}"`);
      return handler(payload);
    }),
    onMessage: vi.fn(() => () => {}),
  } as unknown as RuntimePort & { send: ReturnType<typeof vi.fn> };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PointsView runtime={runtime} wallet={WALLET} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
  return runtime;
}

describe("pickSharePrompt", () => {
  const base = { score: scoreWith({}), shareSeen: [], seatsSeen: 3, revealSeen: true };

  it("prefers a new invite, then the last seat, then the join moment", () => {
    const all = { ...base, score: scoreWith({ seatsLeft: 1 }), seatsSeen: 0, revealSeen: false };
    expect(pickSharePrompt(all)).toBe("gainedSeat");
    expect(pickSharePrompt({ ...all, seatsSeen: 1 })).toBe("lastSeat");
    expect(pickSharePrompt({ ...all, seatsSeen: 1, shareSeen: ["lastSeat"] })).toBe("joined");
    expect(pickSharePrompt({ ...all, seatsSeen: 1, shareSeen: ["lastSeat", "joined"] })).toBeNull();
  });

  it("shows nothing when seats are not limited or nothing is new", () => {
    expect(pickSharePrompt({ ...base, score: scoreWith({ seatsLeft: null }) })).toBeNull();
    expect(pickSharePrompt(base)).toBeNull();
  });

  it("skips the join moment after the founding reveal, and for wallets without a number", () => {
    expect(pickSharePrompt({ ...base, revealSeen: false })).toBe("joined");
    expect(pickSharePrompt({ ...base, revealSeen: true })).toBeNull();
    expect(pickSharePrompt({ ...base, revealSeen: false, score: scoreWith({ foundingNumber: null }) })).toBeNull();
  });

  it("does not treat a missing seat record as a new invite", () => {
    expect(pickSharePrompt({ ...base, seatsSeen: undefined })).toBeNull();
  });
});

describe("share prompts on the Points screen", () => {
  const invite = () => within(screen.getByRole("region", { name: "Invite" }));

  it("announces a new invite in the invite status and records the count as seen", async () => {
    const runtime = setup({ seatsSeen: { [WALLET.id]: 2 } });

    expect(await screen.findByText("A friend joined. You got more invites.")).toBeTruthy();
    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "markPointsSeatsSeen", payload: { walletId: WALLET.id, seats: 3 } }),
    );
    expect(invite().getByText("A friend joined. You got more invites.")).toBeTruthy();
    expect(runtime.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "markPointsShareSeen" }));
  });

  it("marks the last seat seen once the link is copied", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const runtime = setup({ score: { seatsLeft: 1 }, seatsSeen: { [WALLET.id]: 1 } });

    expect(await screen.findByText("Your last invite")).toBeTruthy();
    fireEvent.click(invite().getByRole("button", { name: "Copy invite link" }));

    expect(writeText).toHaveBeenCalledWith(LINK);
    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "markPointsShareSeen", payload: { walletId: WALLET.id, prompt: "lastSeat" } }),
    );
  });

  it("offers the join prompt once for a wallet that never saw the reveal, and marks it seen when copied", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
    const runtime = setup({ revealSeen: [] });

    expect(await screen.findByText("You're in and earning Gleam Points.")).toBeTruthy();
    fireEvent.click(invite().getByRole("button", { name: "Copy invite link" }));

    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "markPointsShareSeen", payload: { walletId: WALLET.id, prompt: "joined" } }),
    );
  });

  it("shows one prompt at a time, the new invite first", async () => {
    setup({ score: { seatsLeft: 1 }, seatsSeen: { [WALLET.id]: 0 }, revealSeen: [] });

    expect(await screen.findByText("A friend joined. You got more invites.")).toBeTruthy();
  });

  it("falls back to the invite count once every prompt has been seen", async () => {
    const runtime = setup({ shareSeen: { [WALLET.id]: ["lastSeat", "joined"] }, score: { seatsLeft: 1 }, seatsSeen: { [WALLET.id]: 1 }, revealSeen: [] });

    await screen.findByText("Top 12%");
    await waitFor(() => expect(runtime.send).toHaveBeenCalledWith(expect.objectContaining({ type: "getPointsRevealSeen" })));
    expect(invite().getByText("1 invite remaining")).toBeTruthy();
  });

  it("shows no prompt when seats are not limited", async () => {
    setup({ score: { seatsLeft: null }, revealSeen: [] });

    await screen.findByText("Top 12%");
    expect(invite().queryByText(/invites? remaining/)).toBeNull();
  });
});
