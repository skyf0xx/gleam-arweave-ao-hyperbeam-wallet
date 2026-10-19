/**
 * A Testing Library text matcher for an address that `MemorableAddress`
 * splits across chunk spans: it matches the innermost element holding the
 * whole address, so `getByText(addressText(a))` works as `getByText(a)` did.
 * A textarea's text is its value, so form fields never match.
 */
export function addressText(address: string) {
  return (_content: string, element: Element | null): boolean =>
    element !== null &&
    element.tagName !== "TEXTAREA" &&
    element.textContent === address && !Array.from(element.children).some((child) => child.textContent === address);
}
