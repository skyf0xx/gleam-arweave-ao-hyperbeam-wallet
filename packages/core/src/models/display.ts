/**
 * Fiat currencies a balance can be shown in, by ISO 4217 code. Every one
 * is in CoinGecko's `exchange_rates`, which the points API's FX lookup
 * reads first, so the list doubles as that endpoint's allow-list.
 */
export const FIAT_CURRENCIES = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "KRW", name: "South Korean Won" },
  { code: "INR", name: "Indian Rupee" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "NGN", name: "Nigerian Naira" },
  { code: "KES", name: "Kenyan Shilling" },
  { code: "ZAR", name: "South African Rand" },
  { code: "AED", name: "UAE Dirham" },
  { code: "PLN", name: "Polish Złoty" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "IDR", name: "Indonesian Rupiah" },
  { code: "PHP", name: "Philippine Peso" },
  { code: "VND", name: "Vietnamese Dong" },
  { code: "UAH", name: "Ukrainian Hryvnia" },
  { code: "RUB", name: "Russian Ruble" },
] as const;

export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]["code"];

/** The tokens a balance can be denominated in, listed ahead of the fiat currencies. */
export const TOKEN_CURRENCIES = [
  { code: "AO", name: "AO" },
  { code: "AR", name: "Arweave" },
] as const;

export type TokenCurrency = (typeof TOKEN_CURRENCIES)[number]["code"];

export type DisplayCurrency = TokenCurrency | FiatCurrency;

/** What the main screen's large figure shows: the total value, or one token's balance. */
export type HeadlineBalance = "total" | "AR" | "AO";

export interface DisplaySettings {
  currency: DisplayCurrency;
  showChart: boolean;
  /** Draws token logos in place of ticker letters; off by default. */
  showTokenLogos: boolean;
  headline: HeadlineBalance;
  /** Masks balances on the main screen, toggled by tapping the headline. */
  balancesHidden: boolean;
}

export function isFiatCurrency(value: unknown): value is FiatCurrency {
  return FIAT_CURRENCIES.some((currency) => currency.code === value);
}

export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return isFiatCurrency(value) || TOKEN_CURRENCIES.some((currency) => currency.code === value);
}

export function isHeadlineBalance(value: unknown): value is HeadlineBalance {
  return value === "total" || value === "AR" || value === "AO";
}

const EURO_REGIONS = new Set([
  "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK",
]);

const CURRENCY_BY_REGION: Record<string, FiatCurrency> = {
  US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", KR: "KRW", IN: "INR", CA: "CAD", AU: "AUD", CH: "CHF", BR: "BRL",
  MX: "MXN", HK: "HKD", SG: "SGD", TR: "TRY", NG: "NGN", KE: "KES", ZA: "ZAR", AE: "AED", PL: "PLN", SE: "SEK",
  NO: "NOK", ID: "IDR", PH: "PHP", VN: "VND", UA: "UAH", RU: "RUB",
};

/** The currency of a BCP 47 locale's region (`"de-AT"` → EUR), or USD when it has none we list. */
export function defaultDisplayCurrency(locale: string | undefined): FiatCurrency {
  const region = locale?.split(/[-_]/).slice(1).find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
  if (!region) return "USD";
  if (EURO_REGIONS.has(region)) return "EUR";
  return CURRENCY_BY_REGION[region] ?? "USD";
}

export function defaultDisplaySettings(locale: string | undefined): DisplaySettings {
  return { currency: defaultDisplayCurrency(locale), showChart: true, showTokenLogos: false, headline: "total", balancesHidden: false };
}
