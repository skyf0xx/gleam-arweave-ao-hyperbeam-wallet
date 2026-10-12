import { UNKNOWN_WALLET_NAME, type ActiveSite, type Grant, type StoragePort } from "@gleam/core";

/**
 * One `SeenOtherWallet` per tab, so tabs reporting at once never overwrite
 * each other. Session storage, so it goes when the browser closes.
 */
export const otherWalletKey = (tabId: number) => `session:siteWallet:tab:${tabId}`;
/** Origins whose "Use Gleam here" suggestion the user closed, as `string[]`. */
export const SUGGESTIONS_DISMISSED_KEY = "local:siteWallet:dismissed";
/**
 * Origins the user switched to Gleam from the popup, as `string[]`. Kept
 * apart from the grant so a dApp's own disconnect, as in a log out and back
 * in, doesn't hand the site back to the other wallet.
 */
export const GLEAM_SITES_KEY = "local:siteWallet:gleamSites";

/**
 * The page reports the other wallet's name, so only names we recognise are
 * shown as given. Anything else could be text the page made up.
 */
const KNOWN_WALLET_NAMES: readonly string[] = ["Wander", "ArConnect", "PermawebOS"];

interface SeenOtherWallet {
  origin: string;
  walletName: string;
  usedAt: number | null;
}

export interface SiteTab {
  id?: number;
  url?: string;
  favIconUrl?: string;
}

export interface SiteWalletHandlerDeps {
  storage: StoragePort;
  findActiveGrant: (origin: string) => Promise<Grant | null>;
  now?: () => number;
}

function webOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** The page sets its favicon, so only a URL the popup can show as a plain image passes. */
function safeFavIconUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^data:image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml);/i.test(raw)) return raw;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export function displayWalletName(raw: string): string {
  return KNOWN_WALLET_NAMES.includes(raw) ? raw : UNKNOWN_WALLET_NAME;
}

/**
 * Tracks which tabs have another wallet extension on the page, so the
 * popup can offer to use Gleam on sites that actually call a wallet.
 */
export class SiteWalletHandler {
  private readonly now: () => number;

  constructor(private readonly deps: SiteWalletHandlerDeps) {
    this.now = deps.now ?? Date.now;
  }

  private async loadSeen(tabId: number): Promise<SeenOtherWallet | null> {
    const raw = await this.deps.storage.get<SeenOtherWallet>(otherWalletKey(tabId));
    return raw !== null && typeof raw === "object" && typeof raw.origin === "string" ? raw : null;
  }

  private async loadOrigins(key: string): Promise<string[]> {
    const raw = await this.deps.storage.get<unknown>(key);
    return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
  }

  private async usesGleam(origin: string): Promise<{ usesGleam: boolean; grant: Grant | null }> {
    const grant = await this.deps.findActiveGrant(origin);
    return { grant, usesGleam: grant !== null || (await this.loadOrigins(GLEAM_SITES_KEY)).includes(origin) };
  }

  async mode(origin: string): Promise<{ useGleam: boolean }> {
    return { useGleam: (await this.usesGleam(origin)).usesGleam };
  }

  async setUseGleam(origin: string, useGleam: boolean): Promise<void> {
    const sites = (await this.loadOrigins(GLEAM_SITES_KEY)).filter((site) => site !== origin);
    await this.deps.storage.set(GLEAM_SITES_KEY, useGleam ? [...sites, origin] : sites);
  }

  /**
   * For when the last wallet goes: with no wallet, every site goes back to
   * the other one. Resolves to the sites that were on Gleam, so their open
   * tabs can be told.
   */
  async forgetGleamSites(): Promise<string[]> {
    const sites = await this.loadOrigins(GLEAM_SITES_KEY);
    await this.deps.storage.remove(GLEAM_SITES_KEY);
    return sites;
  }

  /** A use stays recorded across reloads of the same origin, and clears on navigating elsewhere. */
  async report(tabId: number, origin: string, req: { walletName: unknown; used: unknown }): Promise<void> {
    if (typeof req.walletName !== "string" || typeof req.used !== "boolean") return;
    const previous = await this.loadSeen(tabId);
    const earlierUse = previous?.origin === origin ? previous.usedAt : null;
    const seen: SeenOtherWallet = {
      origin,
      walletName: displayWalletName(req.walletName),
      usedAt: req.used ? this.now() : earlierUse,
    };
    await this.deps.storage.set(otherWalletKey(tabId), seen);
  }

  async forgetTab(tabId: number): Promise<void> {
    await this.deps.storage.remove(otherWalletKey(tabId));
  }

  async activeSite(tab: SiteTab | undefined): Promise<ActiveSite | null> {
    const origin = webOrigin(tab?.url);
    if (!origin) return null;
    const seen = typeof tab?.id === "number" ? await this.loadSeen(tab.id) : null;
    const current = seen?.origin === origin ? seen : null;
    return {
      origin,
      favIconUrl: safeFavIconUrl(tab?.favIconUrl),
      otherWallet: current?.walletName ?? null,
      otherWalletUsedAt: current?.usedAt ?? null,
      ...(await this.usesGleam(origin)),
      suggestionDismissed: (await this.loadOrigins(SUGGESTIONS_DISMISSED_KEY)).includes(origin),
    };
  }

  async dismiss(origin: string): Promise<void> {
    const dismissed = await this.loadOrigins(SUGGESTIONS_DISMISSED_KEY);
    if (dismissed.includes(origin)) return;
    await this.deps.storage.set(SUGGESTIONS_DISMISSED_KEY, [...dismissed, origin]);
  }
}
