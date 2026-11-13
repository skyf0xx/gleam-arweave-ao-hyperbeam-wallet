import { createContext, useContext, type ReactNode } from "react";
import type { AddressDisplayLabels } from "./components/wallet/AddressDisplay";
import type { AddressRevealLabels } from "./components/onboarding/AddressReveal";
import type { RecipientWarningLabels } from "./components/wallet/RecipientWarning";
import type { RecipientCardLabels } from "./components/wallet/RecipientCard";

/**
 * Text a shared component shows or announces when its caller passes none. The
 * app mounts one provider with the translated set, so screens never thread
 * these through; `@gleam/ui` cannot import the app's i18n.
 */
export interface UiLabels {
  back: string;
  showPassword: string;
  hidePassword: string;
  capsLockOn: string;
  passwordStrength: readonly [string, string, string, string];
  stepOf: (current: number, total: number) => string;
  refreshing: string;
  securityPhrase: (word: string) => string;
  networkError: { message: string; retry: string; retrying: string };
  addressDisplay: AddressDisplayLabels;
  addressReveal: AddressRevealLabels;
  recipientWarning: RecipientWarningLabels;
  recipientCard: RecipientCardLabels;
  qrCode: (address: string) => string;
  pendingConfirmation: string;
  dropFile: string;
  browseHint: string;
  tryAnotherFile: string;
  watchOnly: string;
  send: string;
  receive: string;
  securityPhrasePicker: { word: string; suggestAnother: string };
  chart: {
    showAllWallets: string;
    showThisWallet: string;
    thisWallet: string;
    allWallets: string;
    noChartData: string;
    summary: (total: string, change: string, period: string) => string;
    showBalances: string;
    hideBalances: string;
    noHistory: string;
    valueWillAppear: string;
    rangeTabs: string;
  };
}

export const DEFAULT_UI_LABELS: UiLabels = {
  back: "Back",
  showPassword: "Show password",
  hidePassword: "Hide password",
  capsLockOn: "Caps Lock is on",
  passwordStrength: ["Weak", "Fair", "Good", "Strong"],
  stepOf: (current, total) => `Step ${current} of ${total}`,
  refreshing: "Refreshing",
  securityPhrase: (word) => `Your anti-phishing phrase: ${word}`,
  networkError: {
    message: "Couldn't reach the network. Check your connection and try again.",
    retry: "Retry",
    retrying: "Retrying",
  },
  addressDisplay: {
    copied: "Address copied",
    copy: (address) => `Copy address ${address}`,
  },
  addressReveal: {
    title: "Wallet keyfile",
    savedAs: (name) => `Saved as ${name}`,
    saving: "Saving…",
    format: "JSON · standard Arweave keyfile",
    save: "Save keyfile",
    continue: "Continue to wallet",
    skip: "I'll back this up later",
  },
  recipientWarning: {
    irreversible: "This cannot be undone.",
    lookalikeTitle: "This may be a phishing attempt.",
    lookalikeScammers: "Scammers create lookalikes to trick you.",
    lookalikeLabel: "Known address",
    firstTime: "You haven't sent to this address before.",
    doubleCheck: "Double-check the recipient before signing.",
  },
  recipientCard: {
    newAddress: "New address",
    avatar: (name) => `${name} avatar`,
    addressAvatar: "Address avatar",
    change: (name) => `Change recipient${name ? `, ${name}` : ""}`,
  },
  qrCode: (address) => `QR code for wallet address ${address}`,
  pendingConfirmation: "Pending confirmation",
  dropFile: "Drop a file here",
  browseHint: "or click to browse",
  tryAnotherFile: "Click to try another file",
  watchOnly: "Watch only",
  send: "Send",
  receive: "Receive",
  securityPhrasePicker: { word: "Word", suggestAnother: "Suggest another" },
  chart: {
    showAllWallets: "Show all wallets",
    showThisWallet: "Show this wallet",
    thisWallet: "This wallet",
    allWallets: "All wallets",
    noChartData: "No chart data",
    summary: (total, change, period) => `Portfolio value ${total}, ${change} for ${period}`,
    showBalances: "Show balances",
    hideBalances: "Hide balances",
    noHistory: "No portfolio history yet",
    valueWillAppear: "Your portfolio value will appear here.",
    rangeTabs: "Chart range",
  },
};

interface UiLabelsContextValue {
  labels: UiLabels;
  /** BCP 47 tag for `Intl`; unset follows the browser. */
  locale: string | undefined;
}

const UiLabelsContext = createContext<UiLabelsContextValue>({ labels: DEFAULT_UI_LABELS, locale: undefined });

export function UiLabelsProvider({ labels, locale, children }: { labels: UiLabels; locale?: string; children: ReactNode }) {
  return <UiLabelsContext.Provider value={{ labels, locale }}>{children}</UiLabelsContext.Provider>;
}

export function useUiLabels(): UiLabels {
  return useContext(UiLabelsContext).labels;
}

export function useUiLocale(): string | undefined {
  return useContext(UiLabelsContext).locale;
}
