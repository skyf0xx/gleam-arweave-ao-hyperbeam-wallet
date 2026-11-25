import { z } from "zod";
import { PERMISSION_TYPES, type PermissionType } from "@gleam/core";

export const permissionTypeSchema = z.enum(PERMISSION_TYPES);

/** The strings in a stored or page-supplied array; anything else in it is dropped. */
export function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

export function isPermissionType(value: unknown): value is PermissionType {
  return typeof value === "string" && (PERMISSION_TYPES as readonly string[]).includes(value);
}

/** `promise`, or `fallback` once `ms` pass first. The slow work isn't cancelled. */
export function withFallbackAfter<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}
