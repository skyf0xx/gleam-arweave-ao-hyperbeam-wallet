/**
 * PermissionType lives in `core/models` (`Grant`, a core model, references
 * it — see `packages/core/src/models/permission.ts` for why). Re-exported
 * here because `packages/messaging/src/permissions.ts` is this contract's
 * named home for the permission/privilege-tier vocabulary per
 * ARCHITECTURE.md §2's repository layout.
 */
export { PERMISSION_TYPES } from "@gleam/core";
export type { PermissionType } from "@gleam/core";

export { PROVIDER_METHODS, APPROVAL_METHODS, KEY_METHODS } from "@gleam/core";
export type { ProviderMethod, ApprovalMethod, KeyMethod } from "@gleam/core";
