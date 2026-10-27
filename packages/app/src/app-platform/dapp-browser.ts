import type { DappBrowserPort } from "./types";

const unavailable = async (): Promise<never> => {
  throw new Error("The browser isn't available here.");
};

/** For hosts without `capabilities.dappBrowser`. */
export const unavailableDappBrowser: DappBrowserPort = {
  open: unavailable,
  close: unavailable,
  goBack: unavailable,
  reload: unavailable,
  setFrame: unavailable,
  setHidden: unavailable,
  clearSiteData: unavailable,
  subscribe: () => () => {},
};
