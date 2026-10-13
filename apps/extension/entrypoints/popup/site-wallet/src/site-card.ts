import type { ActiveSite, PermissionType } from "@gleam/core";

export interface SiteCard {
  /** `suggest`: the page called another wallet, so offer Gleam. `active`: the site uses Gleam, so offer to disconnect. */
  kind: "suggest" | "active";
  origin: string;
  favIconUrl: string | null;
}

/**
 * Nothing shows when Gleam is the only wallet on the page: the dApp
 * already talks to Gleam, and Connected apps lists the grant.
 */
export function siteCardFor(site: ActiveSite | null | undefined): SiteCard | null {
  if (!site || site.otherWallet === null) return null;
  const card = { origin: site.origin, favIconUrl: site.favIconUrl };
  if (site.usesGleam) return { kind: "active", ...card };
  if (site.otherWalletUsedAt === null || site.suggestionDismissed) return null;
  return { kind: "suggest", ...card };
}

export function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export interface PermissionGroup {
  id: string;
  title: string;
  detail: string;
  permissions: PermissionType[];
  /** Always granted: no dApp works without the address. */
  required?: boolean;
  defaultOn: boolean;
}

/**
 * What "Use Gleam here" can grant, in the same plain words as the
 * approval window's connect screen. The defaults cover what most dApps
 * ask for. A dApp that later asks for more gets a normal connect prompt
 * for the rest.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    id: "address",
    title: "See your address",
    detail: "Your address, public key and network settings",
    permissions: ["ACCESS_ADDRESS", "ACCESS_PUBLIC_KEY", "ACCESS_ARWEAVE_CONFIG"],
    required: true,
    defaultOn: true,
  },
  {
    id: "tokens",
    title: "See your token balances",
    detail: "AR and AO token balances",
    permissions: ["ACCESS_TOKENS"],
    defaultOn: true,
  },
  {
    id: "sign",
    title: "Request payments and signatures",
    detail: "You'll confirm each one",
    permissions: ["SIGN_TRANSACTION", "DISPATCH", "SIGNATURE"],
    defaultOn: true,
  },
  {
    id: "encrypt",
    title: "Encrypt and decrypt data",
    detail: "Using your key",
    permissions: ["ENCRYPT", "DECRYPT"],
    defaultOn: false,
  },
  {
    id: "wallets",
    title: "See all your wallets",
    detail: "Every address you've added",
    permissions: ["ACCESS_ALL_ADDRESSES"],
    defaultOn: false,
  },
];

export function permissionsFor(enabledGroupIds: ReadonlySet<string>): PermissionType[] {
  return PERMISSION_GROUPS.filter((group) => group.required || enabledGroupIds.has(group.id)).flatMap(
    (group) => group.permissions,
  );
}
