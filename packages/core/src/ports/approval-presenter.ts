/**
 * Shows the user the approval UI for one pending `ApprovalRequest`, named
 * only by its `requestId`. The UI fetches the request itself, so the
 * presenter never sees its contents.
 *
 * The UI must outlive whatever surface the request came from: in the
 * extension each request gets its own popup window, because the action
 * popup closes on focus loss and would silently drop the request.
 *
 * Implemented by `apps/extension/src/adapters/windows.ts` over
 * `browser.windows`, and in the phone app by a sheet over the dApp view
 * (`apps/mobile/src/adapters/approval-presenter.ts`), which shows one
 * request at a time. `core` and the handlers only see this interface.
 */
export interface ApprovalPresenterPort {
  /**
   * Shows the approval UI for `requestId`. Resolves once it is showing,
   * not once the user has decided.
   */
  present(requestId: string): Promise<void>;

  /**
   * Brings the approval UI for `requestId` to the user's attention, if it
   * is still showing. A no-op for a request that isn't presented.
   */
  focus(requestId: string): Promise<void>;

  /**
   * Takes down the approval UI for `requestId` once the request has been
   * settled. A no-op if it is already gone. Never reported through
   * `onDismissed`.
   */
  dismiss(requestId: string): Promise<void>;

  /**
   * Calls `listener` with the `requestId` of an approval UI the user
   * dismissed themselves, which rejects that request. Not called for one
   * taken down through `dismiss`. Returns an unsubscribe function.
   */
  onDismissed(listener: (requestId: string) => void): () => void;
}
