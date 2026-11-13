import type { TokenBalance } from "@gleam/core";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";

/** The user's Show/Hide choices on token rows, keyed by row; a row without one keeps its default. */
export type RowVisibility = Record<string, "hidden" | "shown">;

const ROW_VISIBILITY_KEY_PREFIX = "gleam:tokenVisibility:";

export function readRowVisibility(address: string): RowVisibility {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(`${ROW_VISIBILITY_KEY_PREFIX}${address}`) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, "hidden" | "shown"] => entry[1] === "hidden" || entry[1] === "shown"),
    );
  } catch {
    return {};
  }
}

export function writeRowVisibility(address: string, visibility: RowVisibility): void {
  try {
    window.localStorage.setItem(`${ROW_VISIBILITY_KEY_PREFIX}${address}`, JSON.stringify(visibility));
  } catch {
    // Not persisting only means the next open shows the default rows.
  }
}

/**
 * The logo to draw for `token`, or none while the Token logos display
 * setting is off. Anyone can send a wallet a token wearing a lookalike logo,
 * so a discovered token shows its letters until the user chooses Show on its
 * row; from then on they have vouched for it.
 */
export function shownTokenLogo(token: TokenBalance, visibility: RowVisibility, showLogos: boolean): string | undefined {
  if (!showLogos) return undefined;
  if (token.source === "discovered" && visibility[token.processId] !== "shown") return undefined;
  return token.logoUrl ?? undefined;
}

/**
 * `shownTokenLogo` for a send-screen token, where `null` is AR. AR and AO
 * carry no logo on their balance rows, so theirs come from the defaults.
 */
export function sendTokenLogo(token: TokenBalance | null, visibility: RowVisibility, showLogos: boolean): string | undefined {
  if (!showLogos) return undefined;
  if (token === null) return DEFAULT_AR_TOKEN.logoUrl;
  if (token.processId === DEFAULT_AO_TOKEN.processId) return DEFAULT_AO_TOKEN.logoUrl;
  return shownTokenLogo(token, visibility, true);
}

/** Whether a token row or picker entry is left out: hidden by choice, or discovered and never shown. */
export function isTokenHidden(token: TokenBalance, visibility: RowVisibility): boolean {
  const choice = visibility[token.processId];
  return choice === "hidden" || (choice !== "shown" && token.source === "discovered");
}
