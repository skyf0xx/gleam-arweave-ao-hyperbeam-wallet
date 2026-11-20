import { useMemo, useState } from "react";
import { FIAT_CURRENCIES, TOKEN_CURRENCIES, type DisplayCurrency, type RuntimePort } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { OptionSection } from "@gleam/ui/src/primitives/option-list.tsx";
import { SearchField } from "@gleam/ui/src/primitives/search-field.tsx";
import { useDisplaySettings } from "../../../display-settings";
import { useLocale, useT } from "../../../i18n";

/**
 * Picks the currency every balance and price is shown in: AO and AR first,
 * then the fiat currencies, filtered by code or name as the user types.
 * Choosing one saves it and returns to Settings.
 */
export interface DisplayCurrencyViewProps {
  runtime: RuntimePort;
  onBack: () => void;
}

interface CurrencyOption {
  code: DisplayCurrency;
  name: string;
}

function fiatSymbol(code: string, locale: string): string {
  try {
    return (
      new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? ""
    );
  } catch {
    return "";
  }
}

/** The currency's name in the wallet language, or the English one when the runtime has no name for it. */
function localizedName(names: Intl.DisplayNames | null, option: CurrencyOption): string {
  try {
    return names?.of(option.code) ?? option.name;
  } catch {
    return option.name;
  }
}

export function DisplayCurrencyView({ runtime, onBack }: DisplayCurrencyViewProps) {
  const t = useT();
  const locale = useLocale();
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames(locale, { type: "currency" });
    } catch {
      return null;
    }
  }, [locale]);
  const { settings, update } = useDisplaySettings(runtime);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (option: CurrencyOption, shownName: string) =>
    needle === "" ||
    option.code.toLowerCase().includes(needle) ||
    option.name.toLowerCase().includes(needle) ||
    shownName.toLowerCase().includes(needle);
  const tokens = TOKEN_CURRENCIES.filter((option) => matches(option, option.name));
  const fiat = FIAT_CURRENCIES.filter((option) => matches(option, localizedName(names, option)));

  const choose = async (code: DisplayCurrency) => {
    await update({ currency: code });
    onBack();
  };

  const renderOption = (option: CurrencyOption, symbol: string, shownName: string) => {
    const selected = settings?.currency === option.code;
    return (
      <button
        key={option.code}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => void choose(option.code)}
        className="-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-3 text-left phone:py-3.5 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
      >
        <span className="w-10 flex-shrink-0 text-label font-semibold text-foreground">{option.code}</span>
        <span className="min-w-0 flex-1 truncate text-label text-muted">{shownName}</span>
        {symbol && symbol !== option.code ? <span className="flex-shrink-0 text-label text-faint">{symbol}</span> : null}
        <span aria-hidden="true" className="w-4 flex-shrink-0 text-foreground">
          {selected ? <CheckIcon /> : null}
        </span>
      </button>
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("displayCurrency.title")} onBack={onBack} />

      <div className="flex flex-1 flex-col gap-6 px-6 phone:px-5 pb-6 pt-5">
        <SearchField
          aria-label={t("displayCurrency.searchLabel")}
          placeholder={t("displayCurrency.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />

        <div role="radiogroup" aria-label={t("displayCurrency.title")} className="flex flex-col gap-6">
          {tokens.length > 0 ? (
            <OptionSection title={t("displayCurrency.sectionTokens")}>{tokens.map((option) => renderOption(option, "", option.name))}</OptionSection>
          ) : null}
          {fiat.length > 0 ? (
            <OptionSection title={t("displayCurrency.sectionCurrencies")}>
              {fiat.map((option) => renderOption(option, fiatSymbol(option.code, locale), localizedName(names, option)))}
            </OptionSection>
          ) : null}
          {tokens.length === 0 && fiat.length === 0 ? (
            <p className="py-3 text-center text-caption text-muted">{t("displayCurrency.noMatch", { query: query.trim() })}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
