import { useEffect, useMemo, type ReactNode } from "react";
import { UiLabelsProvider, type UiLabels as UiLabelSet } from "@gleam/ui/src/labels";
import { LANGUAGES } from "./define";
import { useLanguage, useT } from "./index";

/**
 * Wraps every page root. It gives `@gleam/ui` its text and number formats in
 * the language in use, and keeps `<html lang>` in step so screen readers and
 * CJK font selection follow it. Without it, shared components stay in English.
 */
export function LocalizedRoot({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = useLanguage();
  useEffect(() => {
    document.documentElement.lang = LANGUAGES.find((entry) => entry.code === locale)?.htmlLang ?? "en";
  }, [locale]);
  const labels = useMemo<UiLabelSet>(
    () => ({
      back: t("common.back"),
      showPassword: t("common.showPassword"),
      hidePassword: t("common.hidePassword"),
      capsLockOn: t("common.capsLockOn"),
      passwordStrength: [t("common.strengthWeak"), t("common.strengthFair"), t("common.strengthGood"), t("common.strengthStrong")],
      stepOf: (current, total) => t("common.stepOf", { current, total }),
      refreshing: t("common.refreshing"),
      securityPhrase: (word) => t("common.securityPhrase", { word }),
      networkError: { message: t("common.networkMessage"), retry: t("common.networkRetry"), retrying: t("common.networkRetrying") },
      addressDisplay: {
        copied: t("common.addressCopied"),
        copy: (address) => t("common.copyAddress", { address }),
      },
      addressReveal: {
        title: t("common.keyfileTitle"),
        savedAs: (name) => t("common.keyfileSavedAs", { name }),
        saving: t("common.keyfileSaving"),
        format: t("common.keyfileFormat"),
        save: t("common.keyfileSave"),
        continue: t("common.keyfileContinue"),
        skip: t("common.keyfileSkip"),
      },
      recipientWarning: {
        irreversible: t("common.irreversible"),
        lookalikeTitle: t("common.lookalikeTitle"),
        lookalikeScammers: t("common.lookalikeScammers"),
        lookalikeLabel: t("common.lookalikeLabel"),
        firstTime: t("common.firstTimeRecipient"),
        doubleCheck: t("common.doubleCheckRecipient"),
      },
      recipientCard: {
        newAddress: t("common.newAddress"),
        avatar: (name) => t("common.avatarOf", { name }),
        addressAvatar: t("common.addressAvatar"),
        change: (name) => (name ? t("common.changeRecipientNamed", { name }) : t("common.changeRecipient")),
      },
      qrCode: (address) => t("common.qrCode", { address }),
      pendingConfirmation: t("common.pendingConfirmation"),
      dropFile: t("common.dropFile"),
      browseHint: t("common.browseHint"),
      tryAnotherFile: t("common.tryAnotherFile"),
      watchOnly: t("common.watchOnly"),
      send: t("common.send"),
      receive: t("common.receive"),
      securityPhrasePicker: { word: t("common.securityPhraseWord"), suggestAnother: t("common.suggestAnotherPhrase") },
      chart: {
        showAllWallets: t("common.chartShowAll"),
        showThisWallet: t("common.chartShowThis"),
        thisWallet: t("common.chartThisWallet"),
        allWallets: t("common.chartAllWallets"),
        noChartData: t("common.chartNoData"),
        summary: (total, change, period) => t("common.chartSummary", { total, change, period }),
        showBalances: t("common.showBalances"),
        hideBalances: t("common.hideBalances"),
        noHistory: t("common.chartNoHistory"),
        valueWillAppear: t("common.chartWillAppear"),
        rangeTabs: t("common.chartRange"),
      },
    }),
    [t],
  );
  return (
    <UiLabelsProvider labels={labels} locale={locale}>
      {children}
    </UiLabelsProvider>
  );
}
