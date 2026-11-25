import {
  UNKNOWN_WALLET_NAME,
  type ActiveSite,
  type Grant,
  type PermissionType,
  type StoragePort,
} from "@gleam/core";
import { updateStored } from "../storage-update";
import { isPermissionType, stringList } from "../guards";

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
  permissions?: PermissionType[];
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

/** The origin of an http(s) URL, or null. */
export function webOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Grants keep the icon, so an inline image past this size isn't worth storing. */
const SITE_ICON_MAX_LENGTH = 32_000;

/** The page sets its icon, so only a URL the wallet can show as a plain image passes. */
export function safeSiteIconUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > SITE_ICON_MAX_LENGTH) return null;
  if (/^data:image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml);/i.test(raw)) return raw;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

function seenOf(raw: unknown): SeenOtherWallet | null {
  return raw !== null && typeof raw === "object" && typeof (raw as SeenOtherWallet).origin === "string"
    ? (raw as SeenOtherWallet)
    : null;
}

function knownPermissions(raw: unknown): PermissionType[] {
  if (!Array.isArray(raw)) return [];
  const known = raw.filter(isPermissionType);
  return [...new Set(known)];
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
    return seenOf(await this.deps.storage.get<unknown>(otherWalletKey(tabId)));
  }

  private async loadOrigins(key: string): Promise<string[]> {
    return stringList(await this.deps.storage.get<unknown>(key));
  }

  private async usesGleam(origin: string): Promise<{ usesGleam: boolean; grant: Grant | null }> {
    const grant = await this.deps.findActiveGrant(origin);
    return { grant, usesGleam: grant !== null || (await this.loadOrigins(GLEAM_SITES_KEY)).includes(origin) };
  }

  async mode(origin: string): Promise<{ useGleam: boolean }> {
    return { useGleam: (await this.usesGleam(origin)).usesGleam };
  }

  async setUseGleam(origin: string, useGleam: boolean): Promise<void> {
    await updateStored(this.deps.storage, GLEAM_SITES_KEY, (raw) => {
      const sites = stringList(raw).filter((site) => site !== origin);
      return useGleam ? [...sites, origin] : sites;
    });
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
  async report(
    tabId: number,
    origin: string,
    req: { walletName: unknown; used: unknown; permissions?: unknown },
  ): Promise<void> {
    if (typeof req.walletName !== "string" || typeof req.used !== "boolean") return;
    const { walletName, used } = req;
    const permissions = knownPermissions(req.permissions);
    const now = this.now();
    await updateStored<SeenOtherWallet>(this.deps.storage, otherWalletKey(tabId), (raw) => {
      const previous = seenOf(raw);
      const sameSite = previous?.origin === origin;
      return {
        origin,
        walletName: displayWalletName(walletName),
        usedAt: used ? now : sameSite ? previous.usedAt : null,
        permissions: permissions.length > 0 ? permissions : sameSite ? knownPermissions(previous.permissions) : [],
      };
    });
  }

  async forgetTab(tabId: number): Promise<void> {
    await updateStored(this.deps.storage, otherWalletKey(tabId), () => null);
  }

  async activeSite(tab: SiteTab | undefined): Promise<ActiveSite | null> {
    const origin = webOrigin(tab?.url);
    if (!origin) return null;
    const seen = typeof tab?.id === "number" ? await this.loadSeen(tab.id) : null;
    const current = seen?.origin === origin ? seen : null;
    return {
      origin,
      favIconUrl: safeSiteIconUrl(tab?.favIconUrl),
      otherWallet: current?.walletName ?? null,
      otherWalletUsedAt: current?.usedAt ?? null,
      otherWalletPermissions: knownPermissions(current?.permissions),
      ...(await this.usesGleam(origin)),
      suggestionDismissed: (await this.loadOrigins(SUGGESTIONS_DISMISSED_KEY)).includes(origin),
    };
  }

  async dismiss(origin: string): Promise<void> {
    await updateStored(this.deps.storage, SUGGESTIONS_DISMISSED_KEY, (raw) => {
      const dismissed = stringList(raw);
      return dismissed.includes(origin) ? undefined : [...dismissed, origin];
    });
  }
}
