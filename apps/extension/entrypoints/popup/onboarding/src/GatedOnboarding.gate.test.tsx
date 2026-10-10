import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InviteUnlock, RuntimePort } from "@gleam/core";
import { GatedOnboarding } from "./GatedOnboarding";

vi.mock("wxt/browser", () => ({ browser: { runtime: { getManifest: () => ({ version: "1.2.3" }) } } }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Backend {
  unlock?: InviteUnlock | null;
  count?: number | null;
  redeem?: (code: string) => InviteUnlock | Promise<InviteUnlock>;
}

function setup({ unlock = null, count = 42, redeem }: Backend = {}, gateEnabled = true) {
  const send = vi.fn(async (message: { type: string; payload: unknown }) => {
    if (message.type === "getPointsInviteUnlock") return unlock;
    if (message.type === "getFoundingCount") return count;
    if (message.type === "redeemPointsInvite") return redeem!((message.payload as { code: string }).code);
    throw new Error(`unexpected ${message.type}`);
  });
  const runtime = { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GatedOnboarding runtime={runtime} onComplete={vi.fn()} gateEnabled={gateEnabled} />
    </QueryClientProvider>,
  );
  return { send };
}

const result = (code: string, r: InviteUnlock["result"]): InviteUnlock => ({ code, result: r, at: 1 });
const field = () => screen.getByLabelText("Invite code") as HTMLInputElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: /Unlock Gleam|Checking/ }));

describe("GatedOnboarding", () => {
  it("shows the gate for an install with no unlock", async () => {
    setup();
    expect(await screen.findByText("You're early.")).toBeTruthy();
    expect(await screen.findByText("42 founding members so far.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Follow @gleam_wallet for code drops" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Don't have an invite?" }));
    expect(screen.getByRole("link", { name: "Follow @gleam_wallet for code drops" })).toBeTruthy();
    expect(screen.queryByText("What are Gleam Points?")).toBeNull();
    expect(screen.getByRole("link", { name: "GLEAM" }).getAttribute("href")).toBe(
      "https://gleam-permaweb.vercel.app/future.html?v=1.2.3",
    );
  });

  it("skips the gate when the flag is off", async () => {
    const { send } = setup({}, false);
    expect(await screen.findByRole("button", { name: "Create a wallet" })).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips the gate when the install is already unlocked", async () => {
    setup({ unlock: result("GLEAM1234", "ok") });
    expect(await screen.findByRole("button", { name: "Create a wallet" })).toBeTruthy();
    expect(screen.queryByText("You're early.")).toBeNull();
  });

  it("opens onboarding if the unlock state can't be read", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    const runtime = { send, onMessage: vi.fn() } as unknown as RuntimePort;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GatedOnboarding runtime={runtime} onComplete={vi.fn()} gateEnabled />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "Create a wallet" })).toBeTruthy();
  });

  it("hides the count line when the count is unavailable", async () => {
    const { send } = setup({ count: null });
    await screen.findByText("You're early.");
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "getFoundingCount", payload: undefined }));
    expect(screen.queryByText(/founding members so far/)).toBeNull();
  });

  it("uppercases the code as it is typed", async () => {
    setup();
    await screen.findByText("You're early.");
    type("gleam 12ab");
    expect(field().value).toBe("GLEAM12AB");
  });

  it("takes the code out of a pasted invite link, dropping separators", async () => {
    setup();
    await screen.findByText("You're early.");
    type("  https://gleam-permaweb.vercel.app/invite.html?c=k7m2-qx9p ");
    expect(field().value).toBe("K7M2QX9P");
    type("gleam-drop 7");
    expect(field().value).toBe("GLEAMDROP7");
  });

  it("asks for a code inline when Unlock is tapped with the field empty", async () => {
    const redeem = vi.fn();
    setup({ redeem });
    await screen.findByText("You're early.");
    const button = screen.getByRole("button", { name: "Unlock Gleam" });
    expect(button.className).not.toContain("bg-foreground");
    expect(button.hasAttribute("disabled")).toBe(false);
    submit();
    expect(await screen.findByText("Enter your invite code.")).toBeTruthy();
    expect(redeem).not.toHaveBeenCalled();
    type("K7M2QX9P");
    expect(screen.queryByText("Enter your invite code.")).toBeNull();
    expect(screen.getByRole("button", { name: "Unlock Gleam" }).className).toContain("bg-foreground");
  });

  it("checks the code, then plays You're in and moves on to Welcome", async () => {
    setup({ redeem: (code) => result(code, "ok") });
    await screen.findByText("You're early.");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    type("GLEAMDROP7");
    submit();
    expect(await screen.findByText("You're in.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(await screen.findByRole("button", { name: "Create a wallet" })).toBeTruthy();
  });

  it("shows Checking while the server answers", async () => {
    let finish!: (value: InviteUnlock) => void;
    setup({ redeem: () => new Promise((resolve) => (finish = resolve)) });
    await screen.findByText("You're early.");
    type("GLEAMDROP7");
    submit();
    expect(await screen.findByRole("button", { name: "Checking…" })).toBeTruthy();
    await act(async () => finish(result("GLEAMDROP7", "unknown")));
  });

  it("makes Ask primary and uses the already-full post when the code is full", async () => {
    setup({ redeem: (code) => result(code, "full") });
    await screen.findByText("You're early.");
    type("GLEAMDROP7");
    submit();
    expect(await screen.findByText("That code is full. Its seats have all been taken.")).toBeTruthy();
    const ask = screen.getByRole("link", { name: "Ask for an invite on X" });
    expect(ask.className).toContain("bg-foreground");
    expect(decodeURIComponent(ask.getAttribute("href")!)).toContain("it was already full");
    expect(field().value).toBe("GLEAMDROP7");
  });

  it("keeps Ask secondary with the regular post when no code is full", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Don't have an invite?" }));
    const ask = screen.getByRole("link", { name: "Ask for an invite on X" });
    expect(ask.className).not.toContain("bg-foreground");
    expect(decodeURIComponent(ask.getAttribute("href")!)).toContain("Looking for a @gleam_wallet invite");
  });

  it("says an unknown code wasn't found", async () => {
    setup({ redeem: (code) => result(code, "unknown") });
    await screen.findByText("You're early.");
    type("NOPENOPE1");
    submit();
    expect(await screen.findByText("We couldn't find that code. Check it and try again.")).toBeTruthy();
  });

  it("stays locked when the invite server can't be reached", async () => {
    setup({ redeem: (code) => result(code, "offline") });
    await screen.findByText("You're early.");
    type("GLEAMDROP7");
    submit();
    expect(await screen.findByText("Gleam can't reach the invite server. Try again in a moment.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create a wallet" })).toBeNull();
  });

  it("opens on a stored full verdict with the code filled in", async () => {
    setup({ unlock: result("FULLCODE1", "full") });
    expect(await screen.findByText("That code is full. Its seats have all been taken.")).toBeTruthy();
    expect(field().value).toBe("FULLCODE1");
  });

  it("retries a stored offline attempt once on open", async () => {
    const redeem = vi.fn((code: string) => result(code, "ok"));
    setup({ unlock: result("GLEAMDROP7", "offline"), redeem });
    expect(await screen.findByText("You're in.")).toBeTruthy();
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(redeem).toHaveBeenCalledWith("GLEAMDROP7");
  });
});
