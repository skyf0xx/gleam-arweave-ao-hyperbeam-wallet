import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Collectible, RuntimePort, WalletSummary } from "@gleam/core";
import { MainScreenView } from "./MainScreenView";
import { CollectibleDetailView } from "../../collectibles/index.tsx";
import { resetCollectiblesGalleryForTests } from "../../collectibles/src/CollectiblesGallery";

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
        onAddToken={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const collectiblesCalls = (runtime: { send: ReturnType<typeof vi.fn> }) =>
  runtime.send.mock.calls.filter(([message]) => message.type === "getCollectibles").length;

describe("Collectibles tab", () => {
  beforeEach(resetCollectiblesGalleryForTests);

  it("does not fetch until the tab is opened, then shows the gallery", async () => {
    const runtime = runtimeWith(async () => [FROG, FROG2, DOC]);
    renderMain(runtime);
    expect(screen.getByRole("tab", { name: "Collectibles" }).getAttribute("aria-selected")).toBe("false");
    await screen.findByText("Tokens", { selector: "[role=tab]" });
    expect(collectiblesCalls(runtime)).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: "Collectibles" }));

    expect(screen.getByRole("tab", { name: "Collectibles" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("button", { name: "Frog #1" })).toBeTruthy();
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("aria-label"))).toEqual(["Frog #1", "Frog #2", "A Document"]);
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

  it("shows no error, empty state or retry button when discovery fails", async () => {
    const runtime = runtimeWith(async () => {
      throw new Error("down");
    });
    renderMain(runtime, { initialTab: "collectibles" });
    await waitFor(() => expect(document.querySelectorAll(".gleam-shimmer").length).toBeGreaterThan(0));
    expect(screen.queryByText(/No collectibles yet/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows the picked thumbnail large and opens it when the large piece is tapped", async () => {
    const onOpenCollectible = vi.fn();
    renderMain(runtimeWith(async () => [FROG, FROG2]), { initialTab: "collectibles", onOpenCollectible });
    fireEvent.click(await screen.findByRole("option", { name: "Frog #2" }));
    expect(screen.getByRole("option", { name: "Frog #2" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Frog #2" }));
    expect(onOpenCollectible).toHaveBeenCalledWith(FROG2);
  });

  it("steps with the arrow keys and swipes on the large piece", async () => {
    renderMain(runtimeWith(async () => [FROG, FROG2, DOC]), { initialTab: "collectibles" });
    await screen.findByRole("button", { name: "Frog #1" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByRole("button", { name: "Frog #2" })).toBeTruthy();
    // jsdom lays nothing out, so the stage is given a width and scrolled by hand: each piece is 300px plus the 16px gap.
    const stage = screen.getByTestId("collectibles-stage");
    Object.defineProperty(stage, "clientWidth", { value: 300, configurable: true });
    fireEvent.pointerDown(stage);
    stage.scrollLeft = 2 * 316;
    fireEvent.scroll(stage);
    expect(await screen.findByRole("button", { name: "A Document" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Frog #2" })).toBeNull();
    stage.scrollLeft = 316 + 40;
    fireEvent.scroll(stage);
    expect(await screen.findByRole("button", { name: "Frog #2" })).toBeTruthy();
  });

  it("reports tab changes so the caller can restore the tab after the detail screen", async () => {
    const onTabChange = vi.fn();
    renderMain(runtimeWith(async () => []), { onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: "Collectibles" }));
    expect(onTabChange).toHaveBeenCalledWith("collectibles");
  });

  it("comes back from the detail screen with the list docked, not at the top", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderMain(runtimeWith(async () => [FROG]), { initialTab: "collectibles" });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    scrollTo.mockRestore();
  });

  it("keeps a thumbnail pulsing rather than showing the file icon after one failed load", async () => {
    renderMain(runtimeWith(async () => [FROG]), { initialTab: "collectibles" });
    const tileImages = () => screen.getAllByTestId("collectible-tile").flatMap((tile) => Array.from(tile.querySelectorAll("img")));
    await waitFor(() => expect(tileImages().length).toBeGreaterThan(0));
    for (const img of tileImages()) fireEvent.error(img);
    await waitFor(() => expect(tileImages()).toHaveLength(0));
    expect(screen.queryByTestId("collectible-placeholder")).toBeNull();
    for (const tile of screen.getAllByTestId("collectible-tile")) expect(tile.className).toContain("gleam-shimmer");
  });
});

describe("CollectibleDetailView", () => {
  it("shows the details and links to Lunar, with no separate process id row", () => {
    render(<CollectibleDetailView collectible={FROG} onBack={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Frog #1" })).toBeTruthy();
    expect(screen.getByText("Frogs")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View on Lunar" }).getAttribute("href")).toBe(`https://lunar.arweave.net/#/explorer/${FROG.id}/data`);
    expect(screen.queryByText("Process ID")).toBeNull();
  });

  it("shows the description, and labels a collectible without a preview by its kind", () => {
    render(<CollectibleDetailView collectible={{ ...DOC, description: "A short note." }} onBack={vi.fn()} />);
    expect(screen.getByText("A short note.")).toBeTruthy();
    expect(screen.getByTestId("collectible-placeholder").textContent).toBe("Document");
  });

  it("clamps a long description and toggles it with more and Show less", () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
    const client = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
    try {
      render(<CollectibleDetailView collectible={{ ...DOC, description: "A long story." }} onBack={vi.fn()} />);
      expect(screen.getByText("A long story.").className).toContain("line-clamp-3");
      fireEvent.click(screen.getByRole("button", { name: "more" }));
      expect(screen.getByText("A long story.").className).not.toContain("line-clamp-3");
      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      expect(screen.getByText("A long story.").className).toContain("line-clamp-3");
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it("offers no toggle when the description fits", () => {
    render(<CollectibleDetailView collectible={{ ...DOC, description: "Short." }} onBack={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "more" })).toBeNull();
  });

  it("plays a video collectible", () => {
    const clip: Collectible = { id: "clip1", name: "Clip", ticker: "ASSET", contentType: "video/mp4", videoUrl: "https://arweave.net/clip1" };
    const { container } = render(<CollectibleDetailView collectible={clip} onBack={vi.fn()} />);
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("https://arweave.net/clip1");
    expect(video.autoplay).toBe(true);
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
  const NAME: Collectible = {
    id: "N".repeat(43),
    name: "@zy",
    ticker: "NAME",
    permawebName: { label: "zy", target: "T".repeat(43) },
  };

  it("shows a name as type, with what it points to and a link to its site", () => {
    render(<CollectibleDetailView collectible={NAME} gatewayUrl="https://arweave.net" onBack={vi.fn()} onSend={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "@zy" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "@zy" }).textContent).toContain("@zy");
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Points to")).toBeTruthy();
    expect(screen.getByText("T".repeat(43))).toBeTruthy();
    expect(screen.getByRole("link", { name: "zy.arweave.net" }).getAttribute("href")).toBe("https://zy.arweave.net");
    expect(screen.getByRole("link", { name: "View on Lunar" }).getAttribute("href")).toBe(`https://lunar.arweave.net/#/explorer/${"T".repeat(43)}`);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("links a name to Lunar until the gateway is known", () => {
    render(<CollectibleDetailView collectible={NAME} onBack={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "zy.arweave.net" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "View on Lunar" })[0]!.getAttribute("href")).toBe(`https://lunar.arweave.net/#/explorer/${NAME.id}/data`);
  });

  it("marks a listed name and offers no Send", () => {
    const listed = { ...NAME, permawebName: { label: "zy", listed: true as const } };
    render(<CollectibleDetailView collectible={listed} gatewayUrl="https://arweave.net" onBack={vi.fn()} onSend={vi.fn()} />);
    expect(screen.getByText("Name · Listed for sale")).toBeTruthy();
    expect(screen.queryByText("Points to")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });
});
