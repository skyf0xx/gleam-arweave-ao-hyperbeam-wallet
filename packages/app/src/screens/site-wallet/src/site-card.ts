import type { ActiveSite, PermissionType } from "@gleam/core";
import type { MessageKey } from "../../../i18n";

export interface SiteCard {
  /** `suggest`: the page called another wallet, so offer Gleam. `active`: the site uses Gleam, so offer to disconnect. */
  kind: "suggest" | "active";
  origin: string;
  favIconUrl: string | null;
  /** What the site asked the other wallet for, to preselect in "Use Gleam here". */
  requestedPermissions: PermissionType[];
}

/**
 * Nothing shows when Gleam is the only wallet on the page: the dApp
 * already talks to Gleam, and Connected apps lists the grant.
 */
export function siteCardFor(site: ActiveSite | null | undefined): SiteCard | null {
  if (!site || site.otherWallet === null) return null;
  const card = { origin: site.origin, favIconUrl: site.favIconUrl, requestedPermissions: site.otherWalletPermissions };
  if (site.usesGleam) return { kind: "active", ...card };
  if (site.otherWalletUsedAt === null || site.suggestionDismissed) return null;
  return { kind: "suggest", ...card };
}

export interface PermissionGroup {
  id: string;
  titleKey: MessageKey;
  detailKey: MessageKey;
  permissions: PermissionType[];
  /** Always granted: no dApp works without the address. */
  required?: boolean;
  defaultOn: boolean;
}

/**
 * What "Use Gleam here" can grant, in the same plain words as the
 * approval window's connect screen. The defaults cover what most dApps
 * ask for, and apply only when Gleam hasn't seen what this site asks for
 * (`initialGroupIds`). A dApp that later asks for more gets a normal
 * connect prompt for the rest.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    id: "address",
    titleKey: "siteWallet.groupAddress",
    detailKey: "siteWallet.groupAddressDetail",
    permissions: ["ACCESS_ADDRESS", "ACCESS_PUBLIC_KEY", "ACCESS_ARWEAVE_CONFIG"],
    required: true,
    defaultOn: true,
  },
  {
    id: "tokens",
    titleKey: "siteWallet.groupTokens",
    detailKey: "siteWallet.groupTokensDetail",
    permissions: ["ACCESS_TOKENS"],
    defaultOn: true,
  },
  {
    id: "sign",
    titleKey: "siteWallet.groupSign",
    detailKey: "siteWallet.groupSignDetail",
    permissions: ["SIGN_TRANSACTION", "DISPATCH", "SIGNATURE"],
    defaultOn: true,
  },
  {
    id: "encrypt",
    titleKey: "siteWallet.groupEncrypt",
    detailKey: "siteWallet.groupEncryptDetail",
    permissions: ["ENCRYPT", "DECRYPT"],
    defaultOn: false,
  },
  {
    id: "wallets",
    titleKey: "siteWallet.groupWallets",
    detailKey: "siteWallet.groupWalletsDetail",
    permissions: ["ACCESS_ALL_ADDRESSES"],
    defaultOn: false,
  },
];

export function permissionsFor(enabledGroupIds: ReadonlySet<string>): PermissionType[] {
  return PERMISSION_GROUPS.filter((group) => group.required || enabledGroupIds.has(group.id)).flatMap(
    (group) => group.permissions,
  );
}

/**
 * The groups that start switched on: each one covering a permission the
 * site asked the other wallet for, or the defaults when that's unknown.
 * Without them, a site such as ArDrive finds a permission missing,
 * disconnects and asks again.
 */
export function initialGroupIds(requested: readonly PermissionType[]): Set<string> {
  const groups =
    requested.length > 0
      ? PERMISSION_GROUPS.filter((group) => group.permissions.some((permission) => requested.includes(permission)))
      : PERMISSION_GROUPS.filter((group) => group.defaultOn);
  return new Set(groups.map((group) => group.id));
}
