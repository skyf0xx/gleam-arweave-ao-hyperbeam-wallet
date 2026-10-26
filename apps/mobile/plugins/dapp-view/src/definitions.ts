import type { PluginListenerHandle } from "@capacitor/core";

/**
 * The one channel a page in the dApp view has to native. The injected
 * script sends text with
 * `window.webkit.messageHandlers.gleamDappView.postMessage(text)` on iOS
 * and `window.gleamDappView.postMessage(text)` on Android. Every frame can
 * reach it; each message carries the frame's origin as the platform
 * reports it, and the transport decides what to accept.
 */
export const DAPP_VIEW_HANDLER = "gleamDappView";

/**
 * `postMessage` dispatches a `CustomEvent` with this type on the main
 * frame's `window`, with the text as its `detail`.
 */
export const DAPP_VIEW_EVENT = "gleamdappview";

/**
 * A rectangle in the wallet WebView's CSS pixels, as
 * `getBoundingClientRect()` reports it there.
 */
export interface DappViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DappViewOpenOptions {
  /**
   * Must be http(s); anything else fires `loadError` and leaves the view
   * blank. Once open, the view asks before a page hands a link to another
   * app.
   */
  url: string;
  /** Run at document start in the main frame of every page the view loads. */
  providerScript: string;
  frame: DappViewRect;
}

/**
 * One message a page sent. Only strings cross, because that is all
 * Android's listener carries; a non-string message is dropped.
 */
export interface DappViewMessage {
  /**
   * The sending frame's origin as the platform reports it,
   * `scheme://host[:port]`, or `"null"` for an opaque origin. The page
   * can't set it.
   */
  origin: string;
  isMainFrame: boolean;
  data: string;
}

export interface DappViewNavigation {
  url: string;
  canGoBack: boolean;
  loading: boolean;
}

export interface DappViewLoadError {
  url: string;
  message: string;
}

/**
 * A native WebView over the wallet WebView, for one dApp page at a time.
 * It has its own cookies and storage, no bridge to the wallet WebView, and
 * one message channel to native. It is a relay: it decides nothing about
 * what a page may do.
 */
export interface DappViewPlugin {
  /**
   * Replaces any view already open. The view also closes itself when the
   * wallet WebView reloads, since the code that opened it is gone.
   */
  open(options: DappViewOpenOptions): Promise<void>;
  close(): Promise<void>;
  goBack(): Promise<void>;
  reload(): Promise<void>;
  /**
   * Closes any open view, so its page can't write its state back, then
   * removes the view's cookies, storage and caches.
   */
  clearData(): Promise<void>;
  /**
   * Delivers `data` to the main frame as a `DAPP_VIEW_EVENT`, only if its
   * origin at delivery is exactly `targetOrigin`. A page that navigated
   * away in the meantime gets nothing. `delivered` is true only when the
   * check passed and the event was dispatched.
   */
  postMessage(options: { data: string; targetOrigin: string }): Promise<{ delivered: boolean }>;
  /** Moves the view, for example when the browser chrome around it changes size. */
  setFrame(options: { frame: DappViewRect }): Promise<void>;
  /**
   * The view sits above the whole wallet WebView, so anything drawn there
   * over it (the approval sheet) needs it hidden first. The page keeps
   * running while hidden.
   */
  setHidden(options: { hidden: boolean }): Promise<void>;
  addListener(eventName: "message", listener: (message: DappViewMessage) => void): Promise<PluginListenerHandle>;
  /** Fires when the URL, back history or loading state changes. */
  addListener(eventName: "navigation", listener: (navigation: DappViewNavigation) => void): Promise<PluginListenerHandle>;
  /**
   * A page that failed to load: offline, a bad certificate, a URL `open`
   * refused, or a page whose web process crashed again after one reload.
   */
  addListener(eventName: "loadError", listener: (error: DappViewLoadError) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
