/**
 * Canonical JSON for hashing: object keys sorted by UTF-16 code unit (as
 * RFC 8785 does), arrays in order, no whitespace, strings escaped by
 * `JSON.stringify`. Numbers are limited to safe integers, so there is no
 * float formatting for two implementations to disagree on. Anything JSON
 * can't carry (undefined, NaN, functions, class instances, array holes) is
 * refused instead of silently dropped, since a dropped field would give two
 * different values the same id.
 */
export function canonicalJson(value: unknown): string {
  return write(value, "$", new Set());
}

function write(value: unknown, at: string, ancestors: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error(`${at}: canonical JSON allows only safe integers, got ${value}.`);
      }
      return String(value);
    case "object":
      break;
    default:
      throw new Error(`${at}: a ${typeof value} has no JSON form.`);
  }

  if (ancestors.has(value)) throw new Error(`${at}: the value refers to itself.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!(index in value)) throw new Error(`${at}[${index}]: arrays must not have holes.`);
        items.push(write(value[index], `${at}[${index}]`, ancestors));
      }
      return `[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${at}: only plain objects and arrays have a canonical form.`);
    }
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${write(record[key], `${at}.${key}`, ancestors)}`);
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Lowercase hex SHA-256 of `data`, UTF-8 encoded when it is a string. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
