/**
 * The host must provide window management for approval flows: `connect()`
 * requests and every signing request open in their own
 * `chrome.windows.create` popup window, never inline in the extension
 * popup — a popup closes on focus loss, which would silently drop the
 * request (PRD §4 — Injected provider & connection approval; Signing
 * approval).
 *
 * Implemented by `apps/extension/src/adapters/windows.ts` in a later layer
 * (`provider-bridge`, per `.hedgehog/core.yaml`) over `chrome.windows.*`.
 * `core` never imports that adapter — only this interface.
 */
export interface WindowPort {
  /**
   * Opens a dedicated approval window at `url` (typically the extension's
   * `approval` entrypoint, parameterized with a request id) and resolves
   * once the window has been created — not once the user has resolved the
   * approval inside it.
   */
  createApprovalWindow(url: string): Promise<void>;

  /**
   * Closes the approval window associated with `requestId`, if still open.
   * Used once an `ApprovalRequest` has been resolved so a stale window
   * doesn't linger.
   */
  closeApprovalWindow(requestId: string): Promise<void>;

  /**
   * Focuses the approval window associated with `requestId`, if a signing
   * request arrives while one is already open — the window should be
   * surfaced rather than duplicated.
   */
  focusApprovalWindow(requestId: string): Promise<void>;

  /**
   * Calls `listener` with the `requestId` of an approval window the user
   * closed themselves. Not called for a window closed through
   * `closeApprovalWindow`. Returns an unsubscribe function.
   */
  onApprovalWindowClosed(listener: (requestId: string) => void): () => void;
}
