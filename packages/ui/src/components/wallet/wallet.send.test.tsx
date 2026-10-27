import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { AddressDisplay } from "./AddressDisplay";
import { BalanceDisplay } from "./BalanceDisplay";
import { TokenRow } from "./TokenRow";
import { ActivityRow } from "./ActivityRow";
import { EmptyState } from "./EmptyState";
import { QrCode } from "./QrCode";

afterEach(() => {
  cleanup();
});

describe("AddressDisplay", () => {
  it("renders the full, untruncated address", () => {
    const address = "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx";
    render(<AddressDisplay address={address} onCopy={() => {}} />);
    expect(screen.getByRole("button").textContent).toBe(address);
  });

  it("calls onCopy and shows the copied affordance", () => {
    const onCopy = vi.fn();
    render(<AddressDisplay address="addr123" onCopy={onCopy} />);

    fireEvent.click(screen.getByRole("button", { name: /^Copy address/ }));

    expect(onCopy).toHaveBeenCalledOnce();
    expect(screen.getByText("Copied to clipboard")).toBeTruthy();
  });
});

describe("BalanceDisplay", () => {
  it("renders the pre-formatted amount label verbatim, no reformatting", () => {
    render(<BalanceDisplay amountLabel="128.4204 AR" />);
    expect(screen.getByText("128.4204 AR")).toBeTruthy();
  });

  it("renders a skeleton instead of the amount while loading", () => {
    render(<BalanceDisplay amountLabel="128.4204 AR" loading />);
    expect(screen.queryByText("128.4204 AR")).toBeNull();
  });
});

describe("TokenRow", () => {
  it("renders name and amount", () => {
    render(
      <TokenRow
        glyph={{ label: "AR", tone: 1 }}
        name="Arweave"
        amount="128.4204"
        value="$1,438.09"
      />,
    );
    expect(screen.getByText("Arweave")).toBeTruthy();
    expect(screen.getByText("128.4204")).toBeTruthy();
  });

  it("shows the full amount on hover and to screen readers when the amount is shortened", () => {
    render(<TokenRow glyph={{ label: "GP" }} name="Gleam Points" amount="1.2K points" amountFull="1,234 points" />);
    const short = screen.getByText("1.2K points");
    expect(short.getAttribute("aria-hidden")).toBe("true");
    expect(short.parentElement?.getAttribute("title")).toBe("1,234 points");
    expect(screen.getByText("1,234 points").className).toContain("sr-only");
  });

  it("keeps the existing value visible (dimmed, not hidden) while loading", () => {
    render(
      <TokenRow
        glyph={{ label: "AR", tone: 1 }}
        name="Arweave"
        amount="128.4204"
        value="$1,438.09"
        loading
      />,
    );
    expect(screen.getByText("128.4204")).toBeTruthy();
    expect(screen.getByText("$1,438.09")).toBeTruthy();
  });
});

describe("ActivityRow", () => {
  it("renders a pending indicator only when pending", () => {
    const { rerender } = render(
      <ActivityRow activityType="send" title="Sent · Kx7p…2mNw" subtitle="Pending confirmation" amountLabel="-4.50 AR" pending />,
    );
    expect(screen.getByRole("progressbar")).toBeTruthy();

    rerender(
      <ActivityRow activityType="send" title="Sent · Kx7p…2mNw" subtitle="1d ago" amountLabel="-4.50 AR" />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a collectible's thumbnail in place of the amount", () => {
    render(
      <ActivityRow
        activityType="send"
        title="Sent · Beam #1"
        subtitle="1d ago"
        amountLabel="-4.50 AR"
        collectible={{ name: "Beam #1", imageUrl: "https://arweave.net/asset" }}
      />,
    );
    expect(screen.getByText("Sent · Beam #1")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Beam #1" }).getAttribute("src")).toBe("https://arweave.net/asset");
    expect(screen.queryByText("-4.50 AR")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("renders the given message", () => {
    render(<EmptyState message="No activity yet. Once you send or receive, it'll show up here." />);
    expect(
      screen.getByText("No activity yet. Once you send or receive, it'll show up here."),
    ).toBeTruthy();
  });
});

describe("QrCode", () => {
  it("renders an accessible label carrying the address value", () => {
    render(<QrCode value="addr123" />);
    expect(screen.getByRole("img", { name: /addr123/ })).toBeTruthy();
  });
});
