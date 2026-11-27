import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RuntimePort, TokenBalance } from "@gleam/core";
import { TokenInfoPanel } from "./TokenInfoPanel";

afterEach(cleanup);

const TOKEN: TokenBalance = {
  address: "W".repeat(43),
  processId: "T".repeat(43),
  ticker: "GTST",
  denomination: 12,
  name: "Gleam Test Token",
  quantity: "0",
};

function renderPanel(token: TokenBalance | null, send: RuntimePort["send"] = vi.fn() as unknown as RuntimePort["send"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const runtime: RuntimePort = { send, onMessage: vi.fn(() => () => {}) };
  render(
    <QueryClientProvider client={queryClient}>
      <TokenInfoPanel runtime={runtime} token={token} priceDisplay={undefined} />
    </QueryClientProvider>,
  );
  return send;
}

describe("TokenInfoPanel", () => {
  it("shows the description, then the total supply under the decimals, scaled and grouped", () => {
    const send = renderPanel({ ...TOKEN, totalSupply: "10000000000000000", description: "A test token." });

    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    expect(terms.slice(0, 2)).toEqual(["Decimals", "Total supply"]);
    expect(screen.getByText("10,000")).toBeTruthy();
    const description = screen.getByText("A test token.");
    expect(description.compareDocumentPosition(screen.getByText("Decimals")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves both out when the token publishes neither", () => {
    renderPanel(TOKEN);

    expect(screen.queryByText("Total supply")).toBeNull();
    expect(screen.queryByRole("paragraph")).toBeNull();
  });

  it("leaves the supply out when the decimals can't be trusted to scale it", () => {
    renderPanel({ ...TOKEN, totalSupply: "10000000000000000", available: false });

    expect(screen.queryByText("Total supply")).toBeNull();
  });

  it("reads AR's supply from the runtime", async () => {
    const send = renderPanel(null, vi.fn(async () => "65561299541769737381") as unknown as RuntimePort["send"]);

    expect(await screen.findByText("65,561,299.5417")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: "getArTotalSupply", payload: undefined });
  });
});
