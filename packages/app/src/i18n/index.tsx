import { useCallback } from "react";
import { CATALOGS, type MessageKey } from "./catalog";
import type { Language } from "./define";
import { getLanguage, useLanguage } from "./store";

export { LANGUAGES, type Language } from "./define";
export type { MessageKey } from "./catalog";
export {
  setLanguagePreference,
  useLanguage,
  useLanguagePreference,
  type LanguagePreference,
} from "./store";

export type MessageParams = Record<string, string | number>;
export type TFunction = (key: MessageKey, params?: MessageParams) => string;

export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const text = CATALOGS[language][key] || CATALOGS.en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** For code outside React; components use `useT`. */
export const t: TFunction = (key, params) => translate(getLanguage(), key, params);

/**
 * The translate function for the language in use. Without a language set it
 * follows the device, and English when that is not one we ship. Components
 * re-render when the language changes.
 */
export function useT(): TFunction {
  const language = useLanguage();
  return useCallback((key, params) => translate(language, key, params), [language]);
}

/** The BCP 47 tag for `Intl` calls, so dates and numbers match the text. */
export function useLocale(): string {
  return useLanguage();
}
