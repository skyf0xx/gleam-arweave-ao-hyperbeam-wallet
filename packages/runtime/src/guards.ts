import { PERMISSION_TYPES, type PermissionType } from "@gleam/core";

/** The strings in a stored or page-supplied array; anything else in it is dropped. */
export function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

export function isPermissionType(value: unknown): value is PermissionType {
  return typeof value === "string" && (PERMISSION_TYPES as readonly string[]).includes(value);
}
