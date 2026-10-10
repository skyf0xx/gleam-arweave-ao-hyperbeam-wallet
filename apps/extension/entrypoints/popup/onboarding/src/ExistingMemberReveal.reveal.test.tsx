import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PointsMembership, PointsScores, RuntimePort, WalletSummary } from "@gleam/core";
import { ExistingMemberReveal } from "./ExistingMemberReveal";

afterEach(cleanup);

const WALLET = { id: "w1", name: "Opal", address: "ADDR1" } as WalletSummary;
const MEMBERSHIP: PointsMembership = { address: "ADDR1", inviteCode: "MYCODE22", referred: false, joinedAt: 1 };

function scores(foundingNumber: number | null, seatsLeft: number | null = 3): PointsScores {
  return {
    settledAt: null,
    wallets: [
      {
        address: "ADDR1",
        inviteCode: "MYCODE22",
        referred: false,
        refereeCount: 0,
        totalAtomic: "0",
        lastDay: null,
        topPercent: null,
        foundingNumber,
        originalFounder: true,
        seatsLeft,
      },
    ],
  };
}

function setup(
  backend: { memberships?: Record<string, PointsMembership>; seen?: string[]; scores?: PointsScores | Error },
  enabled = true,
) {
  const { memberships = { w1: MEMBERSHIP }, seen = [], scores: scoresResult = scores(12) } = backend;
  const send = vi.fn(async (message: { type: string }) => {
    switch (message.type) {
      case "getPointsMemberships":
        return memberships;
      case "getPointsRevealSeen":
        return seen;
      case "getPointsScores":
        if (scoresResult instanceof Error) throw scoresResult;
        return scoresResult;
      case "markPointsRevealSeen":
        return undefined;
      default:
        throw new Error(`unexpected ${message.type}`);
    }
  });
  const runtime = { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExistingMemberReveal runtime={runtime} wallet={WALLET} enabled={enabled}>
        <div>home</div>
      </ExistingMemberReveal>
    </QueryClientProvider>,
  );
  return { send };
}

describe("ExistingMemberReveal", () => {
  it("shows an existing member the reveal, and marks it seen only on Done", async () => {
    const { send } = setup({});
    expect(await screen.findByText("You're in")).toBeTruthy();
    expect(screen.getByText("You have 3 invites")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Share on X" })).toBeTruthy();
    expect(screen.queryByText("home")).toBeNull();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "markPointsRevealSeen" }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("home")).toBeTruthy();
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "markPointsRevealSeen", payload: { walletId: "w1" } }),
    );
  });

  it("does not show it again for a wallet already marked seen", async () => {
    const { send } = setup({ seen: ["w1"] });
    expect(await screen.findByText("home")).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith({ type: "getPointsScores", payload: undefined });
  });

  it("does not show it when the server has no founding number for the wallet", async () => {
    const { send } = setup({ scores: scores(null, null) });
    expect(await screen.findByText("home")).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "markPointsRevealSeen" }));
  });

  it("does not show it to a wallet that has not joined", async () => {
    setup({ memberships: {} });
    expect(await screen.findByText("home")).toBeTruthy();
  });

  it("opens the home when the standing can't be read", async () => {
    setup({ scores: new Error("offline") });
    expect(await screen.findByText("home")).toBeTruthy();
  });

  it("is off outside Phase 1", async () => {
    const { send } = setup({}, false);
    expect(await screen.findByText("home")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
});
