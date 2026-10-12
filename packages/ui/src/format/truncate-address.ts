/** Keeps the ends of an address, where people compare them, and drops the middle. */
export function truncateAddress(address: string, head = 5, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
