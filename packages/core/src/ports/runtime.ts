/**
 * The host must provide a way to send messages across extension contexts
 * (background/content/popup/approval) and to listen for incoming ones.
 * `core` depends only on this narrower interface so it never imports
 * `webextension-polyfill` or `chrome.runtime` directly.
 *
 * Implemented by `apps/extension/src/adapters/runtime.ts`. `core` never
 * imports that adapter — only this interface.
 */
export interface RuntimeMessage<TPayload = unknown> {
  type: string;
  payload: TPayload;
}

export interface RuntimePort {
  /**
   * Sends a message to the given extension context (or the background
   * context by default when `target` is omitted) and resolves with its
   * response, or rejects if the receiving context is unreachable.
   */
  send<TPayload, TResponse>(
    message: RuntimeMessage<TPayload>,
    target?: string,
  ): Promise<TResponse>;

  /**
   * Registers a handler for messages of `type`. Returns an unsubscribe
   * function. Only one handler per `type` is expected to produce a
   * response — additional listeners observe without responding.
   */
  onMessage<TPayload, TResponse>(
    type: string,
    handler: (payload: TPayload) => TResponse | Promise<TResponse>,
  ): () => void;
}
