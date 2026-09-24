import type { PermissionType } from "./permission";

/**
 * A per-origin permission record created when a dApp calls `connect()`.
 * A Wallet has zero or more Grants, one per connected origin. Revoking a
 * Grant ends all access it covered.
 *
 * `budget` is reserved for future budgeted grants — modeled now so the
 * field is stable, never populated by current logic.
 */
export interface Grant {
  origin: string;
  walletId: string;
  permissions: PermissionType[];
  createdAt: number;
  expiresAt: number | null;
  budget: null;
}
