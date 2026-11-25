import {
  WATCH_ONLY_CONNECT_REFUSAL,
  type ConnectApprovalPreview,
  type Grant,
  type PermissionType,
  type StoragePort,
} from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { updateStored } from "../storage-update";
import { dappError } from "../dapp-error";
import { isPermissionType } from "../guards";
import type { KeySession } from "./key-session";
import { safeSiteIconUrl } from "./site-wallet";
import { UNSAFE_TEXT } from "./prepared-check";
import { activeGrant, GRANTS_KEY, validGrants, type PendingApprovalRecord } from "./approval-records";

/** The stored `local:grants`: one `Grant` per connected origin. */
export class GrantStore {
  constructor(
    private readonly storage: StoragePort,
    private readonly keySession: Pick<KeySession, "getWalletMethod">,
    private readonly activeWalletId: () => Promise<string | null>,
  ) {}

  async load(): Promise<Grant[]> {
    return validGrants(await this.storage.get<unknown>(GRANTS_KEY));
  }

  async findActive(origin: string): Promise<Grant | null> {
    return activeGrant(await this.load(), origin);
  }

  /** The only way to write grants. `update` sees the current grants and returns the new ones. */
  private async update<R>(update: (grants: Grant[]) => { next: Grant[] | null; result: R }): Promise<R> {
    let result!: R;
    await updateStored(this.storage, GRANTS_KEY, (raw) => {
      const outcome = update(validGrants(raw));
      result = outcome.result;
      return outcome.next;
    });
    return result;
  }

  /** The grant an approved `connect` request asked for. */
  async createFromConnect(entry: PendingApprovalRecord): Promise<{ granted: PermissionType[] }> {
    const preview = entry.request.preview as ConnectApprovalPreview;
    const name = preview.appInfo?.name ?? null;
    return this.merge(entry.request.origin, entry.walletId, preview.requestedPermissions, {
      icon: entry.siteIcon ?? null,
      name: name !== null && !UNSAFE_TEXT.test(name) ? name : null,
    });
  }

  /**
   * Grants `origin` from the popup's "Use Gleam here", where the user
   * picked the permissions themselves, so no approval window opens.
   */
  async grantSite(req: { origin: string; permissions: PermissionType[]; favIconUrl?: string | null }): Promise<Grant> {
    const permissions = Array.isArray(req.permissions) ? [...new Set(req.permissions.filter(isPermissionType))] : [];
    if (!permissions.includes("ACCESS_ADDRESS")) permissions.unshift("ACCESS_ADDRESS");
    await this.merge(req.origin, null, permissions, { icon: safeSiteIconUrl(req.favIconUrl), name: null });
    const grant = await this.findActive(req.origin);
    if (!grant) throw new Error(dappError(`Couldn't save the grant for "${req.origin}".`));
    return grant;
  }

  private async merge(
    origin: string,
    walletId: string | null,
    requested: readonly PermissionType[],
    site: { icon: string | null; name: string | null },
  ): Promise<{ granted: PermissionType[] }> {
    const grantWalletId = walletId ?? (await this.activeWalletId());
    if (!grantWalletId) {
      throw new Error(userErrorMessage("noWalletToConnect"));
    }
    if ((await this.keySession.getWalletMethod(grantWalletId)) === "watch") {
      throw new Error(WATCH_ONLY_CONNECT_REFUSAL);
    }
    return this.update((grants) => {
      const withoutExisting = grants.filter((grant) => grant.origin !== origin);
      // A connect from an already-connected origin only asks for what the
      // grant lacks, so approving it adds to the grant instead of narrowing it.
      const existing = activeGrant(grants, origin);
      const permissions = [...(existing?.permissions ?? [])];
      for (const permission of requested) {
        if (!permissions.includes(permission)) permissions.push(permission);
      }

      const grant: Grant = {
        origin,
        walletId: grantWalletId,
        permissions,
        createdAt: Date.now(),
        expiresAt: null,
        budget: null,
        icon: site.icon ?? existing?.icon ?? null,
        name: site.name ?? existing?.name ?? null,
      };

      return { next: [...withoutExisting, grant], result: { granted: grant.permissions } };
    });
  }

  /** Removes every grant and returns the origins they were for. */
  revokeAll(): Promise<string[]> {
    return this.update((grants) => ({ next: null, result: grants.map((grant) => grant.origin) }));
  }

  async revoke(origin: string): Promise<void> {
    await this.update((grants) => ({
      next: grants.filter((grant) => grant.origin !== origin),
      result: undefined,
    }));
  }
}
