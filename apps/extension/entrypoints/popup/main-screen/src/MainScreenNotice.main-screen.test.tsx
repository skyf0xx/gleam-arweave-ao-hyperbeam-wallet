import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Announcement, RuntimePort, WalletSummary } from "@gleam/core";
import { MainScreenNotice } from "./MainScreenNotice";

afterEach(cleanup);

const WALLET: WalletSummary = {
  id: "w1",
  address: "addr-1",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

interface Setup {
  member?: boolean;
  seatsLeft?: number | null;
  seatsSeen?: number;
  announcements?: unknown;
  dismissed?: string[];
}

function setup(options: Setup = {}) {
  const dismissed = [...(options.dismissed ?? [])];
  const send = vi.fn(async ({ type, payload }: { type: string; payload?: { id?: string } }) => {
    switch (type) {
      case "getPointsMemberships":
        return options.member === false ? {} : { w1: { address: "addr-1", inviteCode: "C", referred: false, joinedAt: 0 } };
      case "getPointsScores":
        return { wallets: [{ address: "addr-1", seatsLeft: options.seatsLeft ?? null }] };
      case "getPointsSeatsSeen":
        return options.seatsSeen === undefined ? {} : { w1: options.seatsSeen };
      case "markPointsSeatsSeen":
        return undefined;
      case "getAnnouncements":
        if (options.announcements instanceof Error) throw options.announcements;
        return options.announcements ?? [];
      case "getDismissedAnnouncements":
        return dismissed;
      case "dismissAnnouncement":
        dismissed.push(payload!.id!);
        return undefined;
      default:
        throw new Error(`Unexpected message type "${type}"`);
    }
  });
  const runtime: RuntimePort = { send: send as RuntimePort["send"], onMessage: vi.fn(() => () => {}) };
  const onOpenPoints = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MainScreenNotice runtime={runtime} wallet={WALLET} onOpenPoints={onOpenPoints} />
    </QueryClientProvider>,
  );
  return { send, onOpenPoints, view };
}

const INFO: Announcement = { id: "a", level: "info", text: "Maintenance tonight", url: "https://x.com/gleam/status/1" };
const CRITICAL: Announcement = { id: "b", level: "critical", text: "Update the extension" };

describe("MainScreenNotice", () => {
  it("renders nothing when there is nothing to show", async () => {
    const { send, view } = setup();
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "getDismissedAnnouncements", payload: undefined }));
    expect(view.container.querySelector("section")).toBeNull();
  });

  it("shows the invite notice, opens Points on tap and marks seats seen on dismiss", async () => {
    const { send, onOpenPoints } = setup({ seatsLeft: 3, seatsSeen: 2 });

    fireEvent.click(await screen.findByRole("button", { name: "You have new invites" }));
    expect(onOpenPoints).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "markPointsSeatsSeen", payload: { walletId: "w1", seats: 3 } }),
    );
  });

  it("hides the invite notice once the seat count is seen", async () => {
    const { send } = setup({ seatsLeft: 3, seatsSeen: 3 });
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "getPointsSeatsSeen", payload: undefined }));
    expect(screen.queryByText("You have new invites")).toBeNull();
  });

  it("shows the invite notice before an announcement", async () => {
    setup({ seatsLeft: 3, seatsSeen: 2, announcements: [INFO] });
    await screen.findByText("You have new invites");
    expect(screen.queryByText(INFO.text)).toBeNull();
  });

  it("opens an announcement link in a new tab with neutral styling", async () => {
    setup({ announcements: [INFO] });
    const link = await screen.findByRole("link", { name: INFO.text });
    expect(link.getAttribute("href")).toBe(INFO.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByRole("region", { name: "Notice" }).className).not.toContain("warning");
  });

  it("styles a critical announcement in warning red with an icon", async () => {
    setup({ announcements: [CRITICAL] });
    const notice = await screen.findByRole("alert");
    expect(notice.className).toContain("bg-warning-surface");
    expect(notice.querySelector("svg")).not.toBeNull();
  });

  it("skips dismissed announcements and persists a new dismissal", async () => {
    const { send } = setup({ announcements: [INFO, CRITICAL], dismissed: ["a"] });
    await screen.findByText(CRITICAL.text);
    expect(screen.queryByText(INFO.text)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "dismissAnnouncement", payload: { id: "b" } }));
    await waitFor(() => expect(screen.queryByText(CRITICAL.text)).toBeNull());
  });

  it("shows nothing when the announcements read fails", async () => {
    const { send, view } = setup({ announcements: new Error("boom") });
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "getAnnouncements", payload: undefined }));
    expect(view.container.querySelector("section")).toBeNull();
  });
});
