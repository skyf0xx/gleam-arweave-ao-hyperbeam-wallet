/**
 * `PermissionType` lives in `core/models` (`Grant`, a core model,
 * references it). Re-exported here because this module is the
 * messaging contract's named home for the permission/privilege-tier
 * vocabulary.
 */
export { PERMISSION_TYPES } from "@gleam/core";
export type { PermissionType } from "@gleam/core";

export { PROVIDER_METHODS, APPROVAL_METHODS, KEY_METHODS } from "@gleam/core";
export type { ProviderMethod, ApprovalMethod, KeyMethod } from "@gleam/core";
