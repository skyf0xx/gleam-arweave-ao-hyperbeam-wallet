import type { PermissionType } from "./permission";

/**
 * A per-origin permission record created when a dApp calls `connect()`
 * (PRD §3 Glossary — Grant). A Wallet has zero or more Grants, one per
 * connected origin. Revoking a Grant ends all access it covered.
 *
 * `budget` is nullable in Phase 1, reserved for Phase 2 budgeted grants —
 * modeled now so the field is stable, never populated by this phase's logic.
 */
export interface Grant {
  origin: string;
  walletId: string;
  permissions: PermissionType[];
  createdAt: number;
  expiresAt: number | null;
  budget: null;
}
