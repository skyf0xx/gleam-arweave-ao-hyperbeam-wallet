import { fakeBrowser } from "wxt/testing/fake-browser";

/**
 * `@wxt-dev/browser` picks `globalThis.chrome` once, when it first loads,
 * so a test file imports this before any module that reaches `browser`.
 */
Object.assign(globalThis, { chrome: fakeBrowser });

export { fakeBrowser };
