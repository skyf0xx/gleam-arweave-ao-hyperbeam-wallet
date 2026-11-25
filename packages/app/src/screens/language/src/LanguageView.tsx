import type { ReactNode } from "react";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import gbFlag from "flag-icons/flags/4x3/gb.svg?url";
import cnFlag from "flag-icons/flags/4x3/cn.svg?url";
import twFlag from "flag-icons/flags/4x3/tw.svg?url";
import esFlag from "flag-icons/flags/4x3/es.svg?url";
import idFlag from "flag-icons/flags/4x3/id.svg?url";
import brFlag from "flag-icons/flags/4x3/br.svg?url";
import vnFlag from "flag-icons/flags/4x3/vn.svg?url";
import trFlag from "flag-icons/flags/4x3/tr.svg?url";
import ruFlag from "flag-icons/flags/4x3/ru.svg?url";
import jpFlag from "flag-icons/flags/4x3/jp.svg?url";
import krFlag from "flag-icons/flags/4x3/kr.svg?url";
import { LANGUAGES, setLanguagePreference, useLanguagePreference, useT, type Language, type LanguagePreference } from "../../../i18n";
import { ChoiceRow } from "@gleam/ui/src/primitives/option-list.tsx";

const FLAGS: Record<Language, string> = {
  en: gbFlag,
  es: esFlag,
  id: idFlag,
  "pt-BR": brFlag,
  vi: vnFlag,
  tr: trFlag,
  ru: ruFlag,
  ja: jpFlag,
  ko: krFlag,
  "zh-CN": cnFlag,
  "zh-TW": twFlag,
};

/** Picks the language the wallet is shown in; the choice applies at once and stays on this device. */
export interface LanguageViewProps {
  onBack: () => void;
}

export function LanguageView({ onBack }: LanguageViewProps) {
  const t = useT();
  const preference = useLanguagePreference();

  const renderOption = (value: LanguagePreference, label: string, icon: ReactNode, hint?: string) => {
    const selected = preference === value;
    return (
      <ChoiceRow key={value} selected={selected} onSelect={() => setLanguagePreference(value)}>
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block text-label font-semibold text-foreground">{label}</span>
          {hint ? <span className="block text-caption text-muted">{hint}</span> : null}
        </span>
      </ChoiceRow>
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("language.title")} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-6 phone:px-5 pb-6 pt-5">
        <div role="radiogroup" aria-label={t("language.title")}>
          {renderOption("system", t("language.system"), <GlobeIcon />, t("language.systemHint"))}
          {LANGUAGES.map((language) =>
            renderOption(language.code, language.name, <img src={FLAGS[language.code]} alt="" className="h-[15px] w-5 flex-shrink-0 rounded-[2px] object-cover" />),
          )}
        </div>
      </div>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="flex-shrink-0 text-muted">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3 12h18M12 3c2.5 2.5 3.75 5.5 3.75 9s-1.25 6.5-3.75 9c-2.5-2.5-3.75-5.5-3.75-9S9.5 5.5 12 3Z" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

