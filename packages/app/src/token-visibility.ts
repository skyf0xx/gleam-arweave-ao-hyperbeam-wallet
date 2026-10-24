import type { TokenBalance } from "@gleam/core";

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
 * The logo to draw for `token`. Anyone can send a wallet a token wearing a
 * lookalike logo, so a discovered token shows its letters until the user
 * chooses Show on its row; from then on they have vouched for it.
 */
export function shownTokenLogo(token: TokenBalance, visibility: RowVisibility): string | undefined {
  if (token.source === "discovered" && visibility[token.processId] !== "shown") return undefined;
  return token.logoUrl ?? undefined;
}
