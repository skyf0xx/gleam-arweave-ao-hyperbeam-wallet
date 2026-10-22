import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Collectible, RuntimePort, WalletSummary } from "@gleam/core";
import { MainScreenView } from "./MainScreenView";
import { CollectibleDetailView } from "../../collectibles/index.tsx";

afterEach(cleanup);

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

const FROG: Collectible = {
  id: "frogprocessid1234567890abcdefghijklmnopqrstuv",
  name: "Frog #1",
  ticker: "FROG",
  contentType: "image/png",
  imageUrl: "https://arweave.net/frog1",
  collectionId: "col1",
  collectionName: "Frogs",
};
const FROG2: Collectible = { ...FROG, id: "frog2", name: "Frog #2", imageUrl: "https://arweave.net/frog2" };
const DOC: Collectible = { id: "doc1", name: "A Document", ticker: "DOC", contentType: "text/plain" };

function runtimeWith(collectibles: () => Promise<Collectible[]>) {
  const send = vi.fn(async ({ type }: { type: string }) => {
    if (type === "getCollectibles") return collectibles();
    if (type === "getBalance") return "0";
    if (type === "getTokenBalances") return [];
    if (type === "getActivity") return { entries: [], cursor: null };
    if (type === "getPortfolioHistory") return { range: "7D", series: [], currentValue: 0, change: 0, periodLabel: "" };
    if (type === "getTokenPrices") return [];
    if (type === "getPointsMemberships") return {};
    if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
    throw new Error(`Unexpected message type "${type}"`);
  });
  return { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort & { send: typeof send };
}

function renderMain(runtime: RuntimePort, props: Partial<Parameters<typeof MainScreenView>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MainScreenView
        runtime={runtime}
        wallet={WALLET}
        onSend={vi.fn()}
        onSendToken={vi.fn()}
        onReceive={vi.fn()}
        onOpenWalletSwitcher={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenPoints={vi.fn()}
        onUseGleamOnSite={vi.fn()}
        onOpenCollectible={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const collectiblesCalls = (runtime: { send: ReturnType<typeof vi.fn> }) =>
  runtime.send.mock.calls.filter(([message]) => message.type === "getCollectibles").length;

describe("Collectibles tab", () => {
  it("does not fetch until the tab is opened, then shows the grid", async () => {
    const runtime = runtimeWith(async () => [FROG, FROG2, DOC]);
    renderMain(runtime);
    expect(screen.getByRole("tab", { name: "Collectibles" }).getAttribute("aria-selected")).toBe("false");
    await screen.findByText("Tokens", { selector: "[role=tab]" });
    expect(collectiblesCalls(runtime)).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: "Collectibles" }));

    expect(screen.getByRole("tab", { name: "Collectibles" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("button", { name: "Frog #1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Frogs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "A Document" })).toBeTruthy();
    expect(collectiblesCalls(runtime)).toBe(1);
  });

  it("shows skeleton tiles while loading", async () => {
    renderMain(runtimeWith(() => new Promise(() => {})), { initialTab: "collectibles" });
    await waitFor(() => expect(document.querySelectorAll(".gleam-shimmer").length).toBeGreaterThan(0));
    expect(screen.queryByText(/No collectibles yet/)).toBeNull();
  });

  it("shows the empty state when the wallet holds none", async () => {
    renderMain(runtimeWith(async () => []), { initialTab: "collectibles" });
    expect(await screen.findByText(/No collectibles yet/)).toBeTruthy();
  });

  it("offers a retry when discovery fails", async () => {
    const runtime = runtimeWith(async () => {
      throw new Error("down");
    });
    renderMain(runtime, { initialTab: "collectibles" });
    const list = (await screen.findByRole("tablist", { name: "Tokens, collectibles and activity" })).parentElement!;
    const retry = await within(list).findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(collectiblesCalls(runtime)).toBe(2));
  });

  it("opens a collectible when its tile is tapped", async () => {
    const onOpenCollectible = vi.fn();
    renderMain(runtimeWith(async () => [FROG, FROG2]), { initialTab: "collectibles", onOpenCollectible });
    fireEvent.click(await screen.findByRole("button", { name: "Frog #2" }));
    expect(onOpenCollectible).toHaveBeenCalledWith(FROG2);
  });

  it("reports tab changes so the caller can restore the tab after the detail screen", async () => {
    const onTabChange = vi.fn();
    renderMain(runtimeWith(async () => []), { onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: "Collectibles" }));
    expect(onTabChange).toHaveBeenCalledWith("collectibles");
  });

  it("falls back to the plain tile when a thumbnail fails to load", async () => {
    renderMain(runtimeWith(async () => [FROG]), { initialTab: "collectibles" });
    const img = await screen.findByAltText("Frog #1");
    fireEvent.error(img);
    expect(screen.queryByAltText("Frog #1")).toBeNull();
    expect(screen.getByTestId("collectible-placeholder")).toBeTruthy();
  });
});

describe("CollectibleDetailView", () => {
  it("shows the details, copies the process id and links to Lunar", () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CollectibleDetailView collectible={FROG} onBack={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Frog #1" })).toBeTruthy();
    expect(screen.getByText("Frogs")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View on Lunar" }).getAttribute("href")).toBe(`https://lunar.arweave.net/#/explorer/${FROG.id}/data`);
    fireEvent.click(screen.getByRole("button", { name: "Copy process ID" }));
    expect(writeText).toHaveBeenCalledWith(FROG.id);
  });

  it("goes back, and shows Send only when a handler is wired", () => {
    const onBack = vi.fn();
    const onSend = vi.fn();
    const { rerender } = render(<CollectibleDetailView collectible={DOC} onBack={onBack} />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();

    rerender(<CollectibleDetailView collectible={DOC} onBack={onBack} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith(DOC);
  });
});
