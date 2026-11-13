import type { MessageSet } from "../define";
import { activity } from "./activity";
import { app } from "./app";
import { approval } from "./approval";
import { backup } from "./backup";
import { browser } from "./browser";
import { collectibles } from "./collectibles";
import { common } from "./common";
import { connectedApps } from "./connected-apps";
import { contacts } from "./contacts";
import { displayCurrency } from "./display-currency";
import { errors } from "./errors";
import { extension } from "./extension";
import { homeScreen } from "./home-screen";
import { language } from "./language";
import { lockSettings } from "./lock-settings";
import { mainScreen } from "./main-screen";
import { manageTokens } from "./manage-tokens";
import { networkPeers } from "./network-peers";
import { onboarding } from "./onboarding";
import { points } from "./points";
import { receive } from "./receive";
import { send } from "./send";
import { settingsHome } from "./settings-home";
import { siteWallet } from "./site-wallet";
import { transferReview } from "./transfer-review";
import { unlock } from "./unlock";
import { walletDetail } from "./wallet-detail";
import { walletSwitcher } from "./wallet-switcher";

/** One entry per screen folder, plus `common` for text several screens share. A key is `namespace.name`. */
export const NAMESPACES = {
  activity,
  app,
  approval,
  backup,
  browser,
  collectibles,
  common,
  connectedApps,
  contacts,
  displayCurrency,
  errors,
  extension,
  homeScreen,
  language,
  lockSettings,
  mainScreen,
  manageTokens,
  networkPeers,
  onboarding,
  points,
  receive,
  send,
  settingsHome,
  siteWallet,
  transferReview,
  unlock,
  walletDetail,
  walletSwitcher,
} as const satisfies Record<string, MessageSet<Record<string, string>>>;
