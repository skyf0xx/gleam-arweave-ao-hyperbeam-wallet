/** A non-null object: arrays pass. For a shape check where an array fails its field reads anyway. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** A non-null, non-array object: a JSON object as `JSON.parse` gives it. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}
