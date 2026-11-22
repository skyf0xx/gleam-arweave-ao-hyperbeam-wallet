import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CollectibleThumbnail, resetCollectibleImageCacheForTests } from "./CollectibleThumbnail";
import { fakeCaches } from "./image-cache.testing";

afterEach(cleanup);

describe("CollectibleThumbnail", () => {
  it("draws a name as type and loads no media", () => {
    const { container } = render(<CollectibleThumbnail name="@zy" nameLabel="zy" imageUrl="https://arweave.net/abc" />);
    expect(screen.getByRole("img", { name: "@zy" }).textContent).toBe("@@zy");
    expect(container.querySelector("img, video")).toBeNull();
  });

  it("hides a decorative name tile from assistive tech", () => {
    const { container } = render(<CollectibleThumbnail name="@zy" nameLabel="zy" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
  });

  it("loads the image through a lazy, referrer-less <img>", () => {
    render(<CollectibleThumbnail name="Frog" imageUrl="https://arweave.net/abc" />);
    const img = screen.getByAltText("Frog");
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://arweave.net/abc");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("leaves the alt text empty when decorative", () => {
    const { container } = render(<CollectibleThumbnail name={"\u202EgorF"} imageUrl="https://arweave.net/abc" decorative />);
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("loads a video muted and inline, showing only its first frame unless asked to play", () => {
    const { container, rerender } = render(<CollectibleThumbnail name="Clip" videoUrl="https://arweave.net/vid" />);
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("https://arweave.net/vid");
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.getAttribute("preload")).toBe("metadata");
    expect(video.autoplay).toBe(false);
    expect(video.loop).toBe(false);
    expect(video.hasAttribute("controls")).toBe(false);
    rerender(<CollectibleThumbnail name="Clip" videoUrl="https://arweave.net/vid" play />);
    expect(container.querySelector("video")!.autoplay).toBe(true);
    expect(container.querySelector("video")!.loop).toBe(true);
  });

  it("does not loop a video when the system asks for reduced motion", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      const { container } = render(<CollectibleThumbnail name="Clip" videoUrl="https://arweave.net/vid" play />);
      expect(container.querySelector("video")!.autoplay).toBe(false);
      expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prefers the image when both are given", () => {
    const { container } = render(<CollectibleThumbnail name="Both" imageUrl="https://arweave.net/abc" videoUrl="https://arweave.net/vid" />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://arweave.net/abc");
  });

  it("stops pulsing once the video's first frame loads", () => {
    const { container } = render(<CollectibleThumbnail name="Clip" videoUrl="https://arweave.net/vid" />);
    const tile = screen.getByTestId("collectible-tile");
    expect(tile.className).toContain("gleam-shimmer");
    fireEvent.loadedData(container.querySelector("video")!);
    expect(tile.className).not.toContain("gleam-shimmer");
  });

  it("labels the plain tile when given a kind", () => {
    render(<CollectibleThumbnail name="Site" kindLabel="Web page" />);
    expect(screen.getByTestId("collectible-placeholder").textContent).toBe("Web page");
  });

  it("picks the icon by kind, and the plain file without one", () => {
    const iconOf = (kind?: "document" | "audio" | "web" | "file") => {
      const { container, unmount } = render(<CollectibleThumbnail name="X" kind={kind} />);
      const icon = container.querySelector("svg")!.getAttribute("data-kind");
      unmount();
      return icon;
    };
    expect(iconOf("document")).toBe("document");
    expect(iconOf("audio")).toBe("audio");
    expect(iconOf("web")).toBe("web");
    expect(iconOf("file")).toBe("file");
    expect(iconOf()).toBe("file");
  });

  it("shows the plain tile when there is no image", () => {
    render(<CollectibleThumbnail name="Doc" />);
    expect(screen.getByTestId("collectible-placeholder")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("pulses until the image loads", () => {
    render(<CollectibleThumbnail name="Frog" imageUrl="https://arweave.net/abc" />);
    const tile = screen.getByTestId("collectible-tile");
    expect(tile.className).toContain("gleam-shimmer");
    fireEvent.load(screen.getByAltText("Frog"));
    expect(tile.className).not.toContain("gleam-shimmer");
  });

  it("keeps pulsing and retries a failed load before showing the file icon", () => {
    vi.useFakeTimers();
    try {
      render(<CollectibleThumbnail name="Frog" imageUrl="https://arweave.net/broken" />);
      for (const delay of [1500, 4000, 10_000]) {
        fireEvent.error(screen.getByAltText("Frog"));
        expect(screen.queryByTestId("collectible-placeholder")).toBeNull();
        expect(screen.getByTestId("collectible-tile").className).toContain("gleam-shimmer");
        act(() => vi.advanceTimersByTime(delay));
      }
      fireEvent.error(screen.getByAltText("Frog"));
      expect(screen.queryByAltText("Frog")).toBeNull();
      expect(screen.getByTestId("collectible-placeholder")).toBeTruthy();
      expect(screen.getByTestId("collectible-tile").className).not.toContain("gleam-shimmer");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries at once when the browser comes back online", () => {
    render(<CollectibleThumbnail name="Frog" imageUrl="https://arweave.net/flaky" />);
    fireEvent.error(screen.getByAltText("Frog"));
    expect(screen.queryByAltText("Frog")).toBeNull();
    act(() => void window.dispatchEvent(new Event("online")));
    fireEvent.load(screen.getByAltText("Frog"));
    expect(screen.getByTestId("collectible-tile").className).not.toContain("gleam-shimmer");
  });
});

describe("CollectibleThumbnail image cache", () => {
  const TX = "4eTBOaxZSSyGbpKlHyilxNKhXbocuZdiMBYIORjS4f0";
  let objectUrls = 0;

  beforeEach(() => {
    objectUrls = 0;
    resetCollectibleImageCacheForTests();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:nft-${++objectUrls}`, revokeObjectURL: () => {} }));
  });

  afterEach(() => vi.unstubAllGlobals());

  function respond(type: string, body = "img") {
    return vi.fn(async () => new Response(body, { headers: { "content-type": type } }));
  }

  it("stores a raster image by tx id and serves it again without the network", async () => {
    const { entries, storage } = fakeCaches();
    vi.stubGlobal("caches", storage);
    vi.stubGlobal("fetch", respond("image/png"));
    render(<CollectibleThumbnail name="Frog" imageUrl={`https://arweave.net/raw/${TX}`} />);
    await waitFor(() => expect(screen.getByAltText("Frog").getAttribute("src")).toBe("blob:nft-1"));
    expect([...entries.keys()]).toEqual([`https://collectible-image.invalid/${TX}`]);

    cleanup();
    resetCollectibleImageCacheForTests();
    const fetchImpl = respond("image/png");
    vi.stubGlobal("fetch", fetchImpl);
    render(<CollectibleThumbnail name="Frog" imageUrl={`https://arweave.net/raw/${TX}`} />);
    await waitFor(() => expect(screen.getByAltText("Frog").getAttribute("src")).toBe("blob:nft-2"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("draws an SVG from the gateway and never stores it", async () => {
    const { entries, storage } = fakeCaches();
    vi.stubGlobal("caches", storage);
    vi.stubGlobal("fetch", respond("image/svg+xml", "<svg/>"));
    render(<CollectibleThumbnail name="Frog" imageUrl={`https://arweave.net/${TX}`} />);
    await waitFor(() => expect(screen.getByAltText("Frog").getAttribute("src")).toBe(`https://arweave.net/${TX}`));
    expect(entries.size).toBe(0);
  });

  it("draws an oversized image from the gateway and never stores it", async () => {
    const { entries, storage } = fakeCaches();
    vi.stubGlobal("caches", storage);
    vi.stubGlobal("fetch", respond("image/png", "x".repeat(5 * 1024 * 1024 + 1)));
    render(<CollectibleThumbnail name="Frog" imageUrl={`https://arweave.net/${TX}`} />);
    await waitFor(() => expect(screen.getByAltText("Frog").getAttribute("src")).toBe(`https://arweave.net/${TX}`));
    expect(entries.size).toBe(0);
  });

  it("never stores the empty body a gateway can answer 200 with", async () => {
    const { entries, storage } = fakeCaches();
    vi.stubGlobal("caches", storage);
    vi.stubGlobal("fetch", respond("image/webp", ""));
    render(<CollectibleThumbnail name="Frog" imageUrl={`https://arweave.net/${TX}`} />);
    await waitFor(() => expect(screen.getByAltText("Frog").getAttribute("src")).toBe(`https://arweave.net/${TX}`));
    expect(entries.size).toBe(0);
  });

  it("never stores a body cut short of its declared length", async () => {
    const { entries, storage } = fakeCaches();
    vi.stubGlobal("caches", storage);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("img", { headers: { "content-type": "image/png", "content-length": "9000" } })),
    );
    render(<CollectibleThumbnail name="Frog" imageUrl={`https://arweave.net/${TX}`} />);
    await waitFor(() => expect(screen.getByAltText("Frog").getAttribute("src")).toBe(`https://arweave.net/${TX}`));
    expect(entries.size).toBe(0);
  });

  it("drops a stored copy that won't draw and fetches it again on the retry", async () => {
    const { entries, storage } = fakeCaches();
    vi.stubGlobal("caches", storage);
    const fetchImpl = respond("image/png");
    vi.stubGlobal("fetch", fetchImpl);
    render(<CollectibleThumbnail name="Frog" imageUrl={`https://arweave.net/${TX}`} />);
    await waitFor(() => expect(screen.getByAltText("Frog").getAttribute("src")).toBe("blob:nft-1"));

    fireEvent.error(screen.getByAltText("Frog"));
    await waitFor(() => expect(entries.size).toBe(0));
    act(() => void window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(screen.getByAltText("Frog").getAttribute("src")).toBe("blob:nft-2"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(entries.size).toBe(1);
  });
});
