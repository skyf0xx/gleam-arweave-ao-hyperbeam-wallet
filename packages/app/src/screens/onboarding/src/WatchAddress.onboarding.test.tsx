import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "../../../app-platform/testing";
import { OnboardingView } from "./OnboardingView";

afterEach(cleanup);

const ADDRESS = "a".repeat(43);

function fakeRuntime(send = vi.fn()): RuntimePort {
  return { send, onMessage: vi.fn(() => () => {}) };
}

function openWatch() {
  fireEvent.click(screen.getByRole("button", { name: "I already have a wallet" }));
  fireEvent.click(screen.getByRole("button", { name: /Watch an address/ }));
}

describe("OnboardingView: watch an address", () => {
  it("adds a pasted address with no password and finishes", async () => {
    const send = vi.fn().mockResolvedValueOnce({ id: "w1", method: "watch" });
    const onComplete = vi.fn();
    render(<OnboardingView runtime={fakeRuntime(send)} onComplete={onComplete} claim="open" />);

    openWatch();
    fireEvent.change(screen.getByPlaceholderText("Paste an address"), { target: { value: ` ${ADDRESS} ` } });
    fireEvent.change(screen.getByPlaceholderText("Watched wallet"), { target: { value: "Cold" } });
    fireEvent.click(screen.getByRole("button", { name: "Watch address" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "addWatchWallet", payload: { address: ADDRESS, name: "Cold" } });
    expect(screen.queryByPlaceholderText(/password/i)).toBeNull();
  });

  it.each([["too short", "a".repeat(42)], ["bad characters", `${"a".repeat(42)}=`]])(
    "refuses an address that is %s without asking the background",
    (_name, address) => {
      const send = vi.fn();
      render(<OnboardingView runtime={fakeRuntime(send)} onComplete={vi.fn()} />);

      openWatch();
      fireEvent.change(screen.getByPlaceholderText("Paste an address"), { target: { value: address } });
      fireEvent.click(screen.getByRole("button", { name: "Watch address" }));

      expect(screen.getByRole("alert").textContent).toContain("isn't an Arweave address");
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("shows the background's refusal inline", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('This address is already in Gleam as "Main".'));
    render(<OnboardingView runtime={fakeRuntime(send)} onComplete={vi.fn()} mode="add-wallet" />);

    fireEvent.click(screen.getByRole("button", { name: /Watch an address/ }));
    fireEvent.change(screen.getByPlaceholderText("Paste an address"), { target: { value: ADDRESS } });
    fireEvent.click(screen.getByRole("button", { name: "Watch address" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already in Gleam"));
  });

  it("offers a scan only where the platform has a scanner, and fills the field from it", async () => {
    render(<OnboardingView runtime={fakeRuntime()} onComplete={vi.fn()} />);
    openWatch();
    expect(screen.queryByRole("button", { name: "Scan QR code" })).toBeNull();
    cleanup();

    render(
      <OnboardingView runtime={fakeRuntime()} onComplete={vi.fn()} />,
      fakeAppPlatform({ capabilities: { qrScanner: true }, qrScanner: { scan: async () => `ar://${ADDRESS}` } }),
    );
    openWatch();
    fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));

    await waitFor(() => expect((screen.getByPlaceholderText("Paste an address") as HTMLInputElement).value).toBe(ADDRESS));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("returns to the add-wallet list in add-wallet mode", () => {
    render(<OnboardingView runtime={fakeRuntime()} onComplete={vi.fn()} mode="add-wallet" />);

    fireEvent.click(screen.getByRole("button", { name: /Watch an address/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Add a wallet")).toBeTruthy();
  });
});
