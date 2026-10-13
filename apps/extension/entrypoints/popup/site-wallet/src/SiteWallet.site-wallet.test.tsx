import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ActiveSite, Grant, RuntimePort } from "@gleam/core";
import { SiteWalletCard } from "./SiteWalletCard";
import { UseGleamOnSiteView } from "./UseGleamOnSiteView";
import { initialGroupIds, siteCardFor } from "./site-card";

afterEach(() => {
  cleanup();
});

const ORIGIN = "https://bazar.arweave.net";
const GRANT: Grant = {
  origin: ORIGIN,
  walletId: "wallet-1",
  permissions: ["ACCESS_ADDRESS"],
  createdAt: 0,
  expiresAt: null,
  budget: null,
};

function site(overrides: Partial<ActiveSite> = {}): ActiveSite {
  return {
    origin: ORIGIN,
    favIconUrl: null,
    otherWallet: "Wander",
    otherWalletUsedAt: 1_000,
    otherWalletPermissions: [],
    grant: null,
    usesGleam: false,
    suggestionDismissed: false,
    ...overrides,
  };
}

function runtimeWith(responses: Record<string, unknown>): { runtime: RuntimePort; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async ({ type }: { type: string }) => {
    if (type in responses) return responses[type];
    throw new Error(`Unexpected message type "${type}"`);
  });
  return { runtime: { send: send as unknown as RuntimePort["send"], onMessage: vi.fn(() => () => {}) }, send };
}

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("siteCardFor", () => {
  it("suggests Gleam once the page has used the other wallet", () => {
    expect(siteCardFor(site())).toEqual({ kind: "suggest", origin: ORIGIN, favIconUrl: null, requestedPermissions: [] });
  });

  it("stays quiet on a page that has another wallet but never called it", () => {
    expect(siteCardFor(site({ otherWalletUsedAt: null }))).toBeNull();
  });

  it("stays quiet when Gleam is the only wallet, or the suggestion was dismissed", () => {
    expect(siteCardFor(site({ otherWallet: null }))).toBeNull();
    expect(siteCardFor(site({ suggestionDismissed: true }))).toBeNull();
    expect(siteCardFor(null)).toBeNull();
  });

  it("shows the active line for a Gleam site, even if the suggestion was dismissed", () => {
    expect(siteCardFor(site({ usesGleam: true, suggestionDismissed: true, otherWalletUsedAt: null }))).toEqual({
      kind: "active",
      origin: ORIGIN,
      favIconUrl: null,
      requestedPermissions: [],
    });
  });
});

describe("SiteWalletCard", () => {
  it("offers Gleam on a site using another wallet, without naming that wallet", async () => {
    const { runtime } = runtimeWith({ getActiveSite: site({ otherWalletPermissions: ["ACCESS_ADDRESS", "SIGNATURE"] }) });
    const onUseGleam = vi.fn();
    const { container } = render(wrap(<SiteWalletCard runtime={runtime} onUseGleam={onUseGleam} />));

    await waitFor(() => expect(screen.getByText("bazar.arweave.net")).toBeTruthy());
    expect(container.textContent).not.toMatch(/Wander/);
    fireEvent.click(screen.getByRole("button", { name: "Use Gleam here" }));
    expect(onUseGleam).toHaveBeenCalledWith({
      origin: ORIGIN,
      favIconUrl: null,
      requestedPermissions: ["ACCESS_ADDRESS", "SIGNATURE"],
    });
  });

  it("shows the site's favicon, and its first letter when the favicon fails to load", async () => {
    const { runtime } = runtimeWith({ getActiveSite: site({ favIconUrl: "https://bazar.arweave.net/favicon.ico" }) });
    const { container } = render(wrap(<SiteWalletCard runtime={runtime} onUseGleam={vi.fn()} />));

    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://bazar.arweave.net/favicon.ico");
    fireEvent.error(container.querySelector("img")!);
    await waitFor(() => expect(container.querySelector("img")).toBeNull());
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("dismisses the suggestion for this site", async () => {
    const { runtime, send } = runtimeWith({ getActiveSite: site(), dismissSiteSuggestion: undefined });
    render(wrap(<SiteWalletCard runtime={runtime} onUseGleam={vi.fn()} />));

    await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "dismissSiteSuggestion", payload: { origin: ORIGIN } }),
    );
  });

  it("disconnects a Gleam site, handing it back to the other wallet", async () => {
    const { runtime, send } = runtimeWith({ getActiveSite: site({ grant: GRANT, usesGleam: true }), stopGleamOnSite: undefined });
    render(wrap(<SiteWalletCard runtime={runtime} onUseGleam={vi.fn()} />));

    await waitFor(() => expect(screen.getByText("bazar.arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "stopGleamOnSite", payload: { origin: ORIGIN } }));
  });

  it("renders nothing when the active site can't be read", async () => {
    const { runtime, send } = runtimeWith({});
    const { container } = render(wrap(<SiteWalletCard runtime={runtime} onUseGleam={vi.fn()} />));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("initialGroupIds", () => {
  it("starts with the defaults when the site's permissions are unknown", () => {
    expect([...initialGroupIds([])]).toEqual(["address", "tokens", "sign"]);
  });

  it("starts with the groups covering what the site asked for, and nothing else", () => {
    const ardrive = ["ACCESS_ADDRESS", "SIGN_TRANSACTION", "SIGNATURE", "ACCESS_PUBLIC_KEY", "ACCESS_ALL_ADDRESSES"] as const;
    expect([...initialGroupIds(ardrive)]).toEqual(["address", "sign", "wallets"]);
  });
});

describe("UseGleamOnSiteView", () => {
  it("preselects what the site asked the other wallet for", async () => {
    const { runtime, send } = runtimeWith({ useGleamOnSite: undefined });
    render(
      wrap(
        <UseGleamOnSiteView
          runtime={runtime}
          origin={ORIGIN}
          favIconUrl={null}
          requestedPermissions={["ACCESS_ADDRESS", "ACCESS_ALL_ADDRESSES"]}
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
      ),
    );

    expect(screen.getByRole("switch", { name: "See all your wallets" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "See your token balances" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Use Gleam here" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect((send.mock.calls[0]![0] as { payload: { permissions: string[] } }).payload.permissions).toEqual([
      "ACCESS_ADDRESS",
      "ACCESS_PUBLIC_KEY",
      "ACCESS_ARWEAVE_CONFIG",
      "ACCESS_ALL_ADDRESSES",
    ]);
  });

  it("grants the default permissions and returns home", async () => {
    const { runtime, send } = runtimeWith({ useGleamOnSite: undefined });
    const onDone = vi.fn();
    render(wrap(<UseGleamOnSiteView runtime={runtime} origin={ORIGIN} favIconUrl={null} onBack={vi.fn()} onDone={onDone} />));

    fireEvent.click(screen.getByRole("button", { name: "Use Gleam here" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith({
      type: "useGleamOnSite",
      payload: {
        origin: ORIGIN,
        permissions: [
          "ACCESS_ADDRESS",
          "ACCESS_PUBLIC_KEY",
          "ACCESS_ARWEAVE_CONFIG",
          "ACCESS_TOKENS",
          "SIGN_TRANSACTION",
          "DISPATCH",
          "SIGNATURE",
        ],
      },
    });
  });

  it("leaves out a group the user switched off, and adds one switched on", async () => {
    const { runtime, send } = runtimeWith({ useGleamOnSite: undefined });
    render(wrap(<UseGleamOnSiteView runtime={runtime} origin={ORIGIN} favIconUrl={null} onBack={vi.fn()} onDone={vi.fn()} />));

    fireEvent.click(screen.getByRole("switch", { name: "Request payments and signatures" }));
    fireEvent.click(screen.getByRole("switch", { name: "Encrypt and decrypt data" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Gleam here" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    const permissions = (send.mock.calls[0]![0] as { payload: { permissions: string[] } }).payload.permissions;
    expect(permissions).not.toContain("SIGN_TRANSACTION");
    expect(permissions).toEqual(expect.arrayContaining(["ACCESS_ADDRESS", "ENCRYPT", "DECRYPT"]));
  });

  it("keeps the address permission on with no switch to turn it off", () => {
    const { runtime } = runtimeWith({});
    render(wrap(<UseGleamOnSiteView runtime={runtime} origin={ORIGIN} favIconUrl={null} onBack={vi.fn()} onDone={vi.fn()} />));
    expect(screen.queryByRole("switch", { name: "See your address" })).toBeNull();
    expect(screen.getByText("Always")).toBeTruthy();
  });

  it("shows the error and stays put when the switch fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("There is no wallet to connect. Create or import one first."));
    const onDone = vi.fn();
    render(
      wrap(
        <UseGleamOnSiteView
          runtime={{ send: send as unknown as RuntimePort["send"], onMessage: vi.fn(() => () => {}) }}
          origin={ORIGIN}
          favIconUrl={null}
          onBack={vi.fn()}
          onDone={onDone}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Gleam here" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/no wallet to connect/));
    expect(onDone).not.toHaveBeenCalled();
  });
});
