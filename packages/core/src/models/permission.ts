/**
 * ArConnect-compatible permission scope strings, requestable via `connect()`.
 * Lives in `core/models` (rather than `messaging`, where the rest of the
 * permission/privilege-tier vocabulary lives) because `Grant` — a core
 * model — references it, and `messaging` depends on `core/models`, never
 * the reverse (ARCHITECTURE.md §2.1's dependency rule).
 */
export const PERMISSION_TYPES = [
  "ACCESS_ADDRESS",
  "ACCESS_PUBLIC_KEY",
  "ACCESS_ALL_ADDRESSES",
  "ACCESS_ARWEAVE_CONFIG",
  "ACCESS_TOKENS",
  "SIGN_TRANSACTION",
  "SIGNATURE",
  "ENCRYPT",
  "DECRYPT",
  "DISPATCH",
] as const;

export type PermissionType = (typeof PERMISSION_TYPES)[number];
