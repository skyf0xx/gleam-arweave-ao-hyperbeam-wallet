import type { z } from "zod";

/**
 * A type guard that accepts what `schema` accepts and returns the value
 * itself, so a stored record keeps any field the schema doesn't name.
 */
export function schemaGuard<T>(schema: z.ZodType): (value: unknown) => value is T {
  return (value): value is T => schema.safeParse(value).success;
}
