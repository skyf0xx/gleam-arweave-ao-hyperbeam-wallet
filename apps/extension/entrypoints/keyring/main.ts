import { browser } from "wxt/browser";
import { Keyring } from "@gleam/core/signer";
import { keepKeyringConnected } from "@/src/keyring/server";

/**
 * The offscreen document that holds unlocked wallets' keys. It lives as
 * long as a wallet is unlocked, unlike the service worker, which Chrome
 * stops when idle; the background closes it on lock.
 */
keepKeyringConnected(browser.runtime, new Keyring());
