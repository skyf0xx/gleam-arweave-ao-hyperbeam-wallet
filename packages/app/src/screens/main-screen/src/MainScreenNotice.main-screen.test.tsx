import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeAppPlatform, renderWithPlatform as render, type FakeAppPlatformOverrides } from "../../../app-platform/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Announcement, ReviewMoment, RuntimePort, WalletSummary } from "@gleam/core";
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
  review?: ReviewMoment | null;
}

function setup(options: Setup = {}, platformOverrides: FakeAppPlatformOverrides = {}) {
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
      case "getReviewPrompt":
        return options.review ?? null;
      case "finishReviewPrompt":
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
    fakeAppPlatform(platformOverrides),
  );
  return { send, onOpenPoints, view };
}

const INFO: Announcement = {
  id: "a",
  level: "info",
  title: "Heads up",
  text: "Maintenance tonight",
  url: "https://x.com/gleam/status/1",
};
const CRITICAL: Announcement = { id: "b", level: "critical", text: "Update the extension" };

describe("MainScreenNotice", () => {
  it("renders nothing when there is nothing to show", async () => {
    const { send, view } = setup();
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "getDismissedAnnouncements", payload: undefined }));
    expect(view.container.querySelector("section")).toBeNull();
  });

  it("shows the invite notice, opens Points on tap and marks seats seen on dismiss", async () => {
    const { send, onOpenPoints } = setup({ seatsLeft: 3, seatsSeen: 2 });

    fireEvent.click(await screen.findByRole("button", { name: /You have new invites/ }));
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
    const link = await screen.findByRole("link", { name: /Heads up\s*Maintenance tonight/ });
    expect(link.getAttribute("href")).toBe(INFO.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByRole("region", { name: "Notice" }).className).not.toContain("warning");
  });

  it("shows the text alone when an announcement has no title", async () => {
    setup({ announcements: [CRITICAL] });
    expect((await screen.findByText(CRITICAL.text)).parentElement?.className).toContain("text-foreground");
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

  it("asks for a review after a good moment, with feedback beside it", async () => {
    const request = vi.fn(async () => {});
    const { send } = setup(
      { review: { kind: "hardware", device: "Ledger" }, announcements: [INFO] },
      { storeReview: { opensPage: true, request } },
    );

    expect(await screen.findByText("Enjoying Gleam?")).toBeTruthy();
    expect(screen.getByText("Leave a review to help others discover us.")).toBeTruthy();
    expect(screen.queryByText(INFO.text)).toBeNull();
    const feedback = screen.getByRole("link", { name: "Send us feedback" });
    expect(feedback.getAttribute("href")).toBe("https://gleamwallet.app/feedback.html?v=1.2.3");
    const review = screen.getByRole("button", { name: /Leave a review/ });
    expect(review.textContent).toContain("↗");

    fireEvent.click(review);
    expect(request).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "finishReviewPrompt", payload: undefined }));
    expect(await screen.findByText(INFO.text)).toBeTruthy();
  });

  it("answers the ask even when the review request fails, and marks no page on the phone", async () => {
    const request = vi.fn().mockRejectedValue(new Error("no prompt"));
    const { send } = setup({ review: { kind: "send" } }, { storeReview: { opensPage: false, request } });
    const review = await screen.findByRole("button", { name: /Leave a review/ });
    expect(review.textContent).not.toContain("↗");

    fireEvent.click(review);
    expect(request).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "finishReviewPrompt", payload: undefined }));
    await waitFor(() => expect(screen.queryByText("Enjoying Gleam?")).toBeNull());
  });

  it("retires the review prompt on dismiss", async () => {
    const { send } = setup({ review: { kind: "send" } });
    await screen.findByText("Enjoying Gleam?");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "finishReviewPrompt", payload: undefined }));
    await waitFor(() => expect(screen.queryByText("Enjoying Gleam?")).toBeNull());
  });

  it("shows nothing when the announcements read fails", async () => {
    const { send, view } = setup({ announcements: new Error("boom") });
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "getAnnouncements", payload: undefined }));
    expect(view.container.querySelector("section")).toBeNull();
  });
});
