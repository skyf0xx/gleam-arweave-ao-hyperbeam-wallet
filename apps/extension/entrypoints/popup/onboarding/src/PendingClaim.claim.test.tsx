import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PointsMembership, RuntimePort, WalletSummary } from "@gleam/core";
import { PendingClaim } from "./PendingClaim";

vi.mock("wxt/browser", () => ({ browser: { runtime: { getManifest: () => ({ version: "1.2.3" }) } } }));

afterEach(cleanup);

const WALLET = { id: "w1", name: "Opal", address: "ADDR1" } as WalletSummary;
const MEMBERSHIP: PointsMembership = { address: "ADDR1", inviteCode: "MYCODE22", referred: false, joinedAt: 1 };

function setup({ pending = ["w1"], memberships = {} }: { pending?: string[]; memberships?: Record<string, PointsMembership> }) {
  let pendingNow = pending;
  let membershipsNow = memberships;
  const send = vi.fn(async (message: { type: string; payload: unknown }) => {
    switch (message.type) {
      case "getPointsClaimPending":
        return pendingNow;
      case "getPointsMemberships":
        return membershipsNow;
      case "getPointsPendingInvite":
        return null;
      case "setPointsClaimPending":
        pendingNow = [];
        return undefined;
      case "joinPoints":
        membershipsNow = { w1: MEMBERSHIP };
        pendingNow = [];
        return MEMBERSHIP;
      default:
        throw new Error(`unexpected ${message.type}`);
    }
  });
  const runtime = { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PendingClaim runtime={runtime} wallet={WALLET}>
        <div>home</div>
      </PendingClaim>
    </QueryClientProvider>,
  );
  return { send };
}

describe("PendingClaim", () => {
  it("brings back a claim step the popup closed on", async () => {
    setup({});
    expect(await screen.findByText("Start earning Gleam Points")).toBeTruthy();
    expect(screen.queryByText("home")).toBeNull();
  });

  it("goes away for good on Not now", async () => {
    const { send } = setup({});
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(await screen.findByText("home")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: "setPointsClaimPending", payload: { walletId: "w1", pending: false } });
  });

  it("hands over to the home screen once the wallet joins", async () => {
    const { send } = setup({});
    fireEvent.click(await screen.findByRole("button", { name: "Join Gleam Points" }));
    expect(await screen.findByText("home")).toBeTruthy();
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "joinPoints", payload: { walletId: "w1" } }));
  });

  it("shows the home screen when nothing is pending", async () => {
    setup({ pending: [] });
    expect(await screen.findByText("home")).toBeTruthy();
  });

  it("shows the home screen for a wallet that already joined", async () => {
    setup({ memberships: { w1: MEMBERSHIP } });
    expect(await screen.findByText("home")).toBeTruthy();
  });
});
