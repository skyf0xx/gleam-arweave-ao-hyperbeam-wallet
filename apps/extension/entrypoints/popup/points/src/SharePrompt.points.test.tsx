import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PointsMembership, PointsScores, PointsWalletScore, RuntimePort, WalletSummary } from "@gleam/core";
import { PointsView } from "./PointsView";
import { pickSharePrompt } from "./SharePrompt";

vi.mock("wxt/browser", () => ({ browser: { runtime: { getManifest: () => ({ version: "1.2.3" }) } } }));

const LINK = "https://gleam-permaweb.vercel.app/invite.html?c=MYCODE22";

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

const intent = (post: string) => `https://x.com/intent/post?text=${encodeURIComponent(post)}`;

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

describe("SharePrompt", () => {
  it("announces a new invite, posts it with the link, and records the count as seen", async () => {
    const runtime = setup({ seatsSeen: { [WALLET.id]: 2 } });

    const prompt = within(await screen.findByRole("region", { name: "Share prompt" }));
    expect(prompt.getByText("Someone you invited joined. You have another invite.")).toBeTruthy();
    expect(prompt.getByRole("link", { name: "Share on X" }).getAttribute("href")).toBe(
      intent(`Someone I invited just joined @gleam_wallet, so I got another invite. Who wants it?\n${LINK}\n@ArweaveEco @aoTheComputer`),
    );
    expect(prompt.getByRole("button", { name: "Copy link" })).toBeTruthy();
    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "markPointsSeatsSeen", payload: { walletId: WALLET.id, seats: 3 } }),
    );
    expect(screen.getByRole("region", { name: "Share prompt" })).toBeTruthy();
    expect(runtime.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "markPointsShareSeen" }));
  });

  it("copies the invite link and dismisses", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    setup({ seatsSeen: { [WALLET.id]: 2 } });

    const prompt = within(await screen.findByRole("region", { name: "Share prompt" }));
    fireEvent.click(prompt.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    fireEvent.click(prompt.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("region", { name: "Share prompt" })).toBeNull();
  });

  it("shows the last-seat post without a link or Copy link, and marks it seen when shared", async () => {
    const runtime = setup({ score: { seatsLeft: 1 }, seatsSeen: { [WALLET.id]: 1 } });

    const prompt = within(await screen.findByRole("region", { name: "Share prompt" }));
    const share = prompt.getByRole("link", { name: "Share on X" });
    expect(share.getAttribute("href")).toBe(
      intent("I've got one @gleam_wallet invite left. Reply if you want it and I'll send it over.\n@ArweaveEco @aoTheComputer"),
    );
    expect(prompt.queryByRole("button", { name: "Copy link" })).toBeNull();
    fireEvent.click(share);

    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "markPointsShareSeen", payload: { walletId: WALLET.id, prompt: "lastSeat" } }),
    );
  });

  it("offers the join post once for a wallet that never saw the reveal, and marks it seen on dismiss", async () => {
    const runtime = setup({ revealSeen: [] });

    const prompt = within(await screen.findByRole("region", { name: "Share prompt" }));
    expect(prompt.getByText("You joined as OG #184.")).toBeTruthy();
    expect(prompt.getByRole("link", { name: "Share on X" }).getAttribute("href")).toBe(
      intent(`Just got into @gleam_wallet, a new wallet for AO. I have 3 invites if you want to get in early.\n${LINK}\n@ArweaveEco @aoTheComputer`),
    );
    fireEvent.click(prompt.getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(runtime.send).toHaveBeenCalledWith({ type: "markPointsShareSeen", payload: { walletId: WALLET.id, prompt: "joined" } }),
    );
    expect(screen.queryByRole("region", { name: "Share prompt" })).toBeNull();
  });

  it("shows one prompt at a time, the new invite first", async () => {
    setup({ score: { seatsLeft: 1 }, seatsSeen: { [WALLET.id]: 0 }, revealSeen: [] });

    await screen.findByRole("region", { name: "Share prompt" });
    expect(screen.getAllByRole("region", { name: "Share prompt" })).toHaveLength(1);
    expect(screen.getByText("Someone you invited joined. You have another invite.")).toBeTruthy();
  });

  it("shows nothing once every prompt has been seen", async () => {
    const runtime = setup({ shareSeen: { [WALLET.id]: ["lastSeat", "joined"] }, score: { seatsLeft: 1 }, seatsSeen: { [WALLET.id]: 1 }, revealSeen: [] });

    await screen.findByText("Top 12%");
    await waitFor(() => expect(runtime.send).toHaveBeenCalledWith(expect.objectContaining({ type: "getPointsRevealSeen" })));
    expect(screen.queryByRole("region", { name: "Share prompt" })).toBeNull();
  });

  it("shows nothing when seats are not limited", async () => {
    setup({ score: { seatsLeft: null }, revealSeen: [] });

    await screen.findByText("Top 12%");
    expect(screen.queryByRole("region", { name: "Share prompt" })).toBeNull();
  });
});
