/** The host of a URL or origin, or the input itself when it doesn't parse. */
export function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}
