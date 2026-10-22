import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DisplaySettings, RuntimePort } from "@gleam/core";
import { DisplayCurrencyView } from "./DisplayCurrencyView";

afterEach(cleanup);

const SETTINGS: DisplaySettings = { currency: "USD", showChart: true, headline: "total", balancesHidden: false };

function renderPicker() {
  const send = vi.fn(async ({ type }: { type: string }) => {
    if (type === "getDisplaySettings") return SETTINGS;
    if (type === "setDisplaySettings") return undefined;
    throw new Error(`Unexpected message type "${type}"`);
  });
  const onBack = vi.fn();
  const runtime: RuntimePort = { send: send as RuntimePort["send"], onMessage: vi.fn(() => () => {}) };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DisplayCurrencyView runtime={runtime} onBack={onBack} />
    </QueryClientProvider>,
  );
  return { send, onBack };
}

describe("DisplayCurrencyView", () => {
  it("lists AO and AR ahead of the fiat currencies and marks the current one", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getByRole("radio", { name: /USD/ }).getAttribute("aria-checked")).toBe("true"));
    const codes = screen.getAllByRole("radio").map((option) => option.firstElementChild?.textContent);
    expect(codes.slice(0, 3)).toEqual(["AO", "AR", "USD"]);
  });

  it("filters by code or name", async () => {
    renderPicker();

    fireEvent.change(screen.getByLabelText("Search currencies"), { target: { value: "shilling" } });

    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /KES/ })).toBeTruthy();
  });

  it("saves the chosen currency and goes back", async () => {
    const { send, onBack } = renderPicker();
    await waitFor(() => expect(screen.getByRole("radio", { name: /USD/ }).getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(screen.getByRole("radio", { name: /^AR\s*Arweave/ }));

    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith({ type: "setDisplaySettings", payload: { ...SETTINGS, currency: "AR" } });
  });
});
