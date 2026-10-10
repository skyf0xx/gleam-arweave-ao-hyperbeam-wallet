/**
 * A small attention dot on the extension's toolbar icon. Implemented by
 * `apps/extension/src/adapters/badge.ts` over `browser.action`; `core`
 * and the handlers only see this interface.
 */
export interface BadgePort {
  setDot(visible: boolean): Promise<void>;
}
