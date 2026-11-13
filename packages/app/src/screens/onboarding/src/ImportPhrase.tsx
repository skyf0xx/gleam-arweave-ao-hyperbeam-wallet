import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import {
  MNEMONIC_WORD_COUNTS,
  checkMnemonic,
  isMnemonicWord,
  suggestMnemonicWords,
  type MnemonicProblem,
} from "@gleam/core/src/keys/mnemonic.ts";
import { DEFAULT_GRID_SIZE, placeWords, resizeGrid } from "./phrase-grid";
import { derivePhraseKey as defaultDerive, type DerivePhraseKey } from "./phrase-key";
import { useT } from "../../../i18n";

/**
 * Import a wallet from a BIP-39 recovery phrase (12–24 words) made by
 * another Arweave wallet. Paste the phrase into any cell and it spreads
 * across the grid, or type it word by word with wordlist suggestions.
 * The words live only in this component's state and are cleared once the
 * key is derived; Gleam never stores the phrase, only the resulting
 * keyfile, which goes through the same password step as a keyfile import.
 */
export interface ImportPhraseProps {
  onBack: () => void;
  onValidJWK: (jwk: unknown) => void;
  derive?: DerivePhraseKey;
}

// Masks a cell's text without `type="password"`, which would invite the
// browser's password manager to offer to save each word.
const MASKED = "[-webkit-text-security:disc]";

const SEPARATOR = /[\s,;]/u;

// Keeps browsers, password managers and mobile keyboards from storing,
// correcting or learning the words.
const PRIVATE_INPUT = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "none",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
} as const;

export function ImportPhrase({ onBack, onValidJWK, derive = defaultDerive }: ImportPhraseProps) {
  const t = useT();
  const [cells, setCells] = useState<string[]>(() => Array<string>(DEFAULT_GRID_SIZE).fill(""));
  const [focused, setFocused] = useState<number | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());
  const [revealed, setRevealed] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [foundCount, setFoundCount] = useState<number>();
  const [problem, setProblem] = useState<MnemonicProblem>();
  const [deriving, setDeriving] = useState(false);
  const [deriveFailed, setDeriveFailed] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const abort = useRef<AbortController | null>(null);
  const pendingFocus = useRef<number | null>(null);

  // Leaving the screen mid-derivation stops the worker.
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    inputs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  });

  const clearFeedback = () => {
    setProblem(undefined);
    setDeriveFailed(false);
  };

  const apply = (at: number, text: string, fromPaste: boolean) => {
    const update = placeWords(cells, at, text);
    if (!update) return;
    clearFeedback();
    setCells(update.cells);
    setFoundCount(update.foundCount);
    setTouched((previous) => new Set([...previous, ...update.cells.flatMap((cell, index) => (cell ? [index] : []))]));
    if (fromPaste) setPasted(true);
    pendingFocus.current = update.focus;
  };

  const setCell = (index: number, value: string) => {
    clearFeedback();
    // Hand-editing a cell supersedes whatever a paste reported, so a
    // stale word-count error can't block a fixed phrase.
    setFoundCount(undefined);
    setCells((previous) => previous.map((cell, position) => (position === index ? value : cell)));
  };

  const chooseSuggestion = (word: string) => {
    if (focused === null) return;
    apply(focused, `${word} `, false);
  };

  const unknownPositions = cells.flatMap((cell, index) =>
    cell && touched.has(index) && focused !== index && !isMnemonicWord(cell) ? [index] : [],
  );
  const filled = cells.every((cell) => cell.length > 0);
  const focusedWord = focused === null ? "" : (cells[focused] ?? "");
  // A complete word can still be the start of others ("leg", "legal").
  const suggestions = suggestMnemonicWords(focusedWord, 5)
    .filter((word) => word !== focusedWord)
    .slice(0, 4);

  const submit = async () => {
    // A shown word-count error gates the import: the grid only holds the
    // first 24 words of an over-long paste, so deriving from it would
    // silently drop the extra word. The button is disabled in this state
    // too, but Enter still submits the form, so the handler refuses.
    if (foundCount !== undefined) return;
    const check = await checkMnemonic(cells);
    if (!check.valid) {
      setProblem(check.problem);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setDeriving(true);
    setDeriveFailed(false);
    try {
      const jwk = await derive(cells, controller.signal);
      if (controller.signal.aborted) return;
      setCells(Array<string>(cells.length).fill(""));
      onValidJWK(jwk);
    } catch {
      if (!controller.signal.aborted) setDeriveFailed(true);
    } finally {
      if (abort.current === controller) abort.current = null;
      setDeriving(false);
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setDeriving(false);
  };

  const errorMessage = (() => {
    if (deriveFailed) return t("onboarding.phraseDeriveFailed");
    if (foundCount !== undefined) return t("onboarding.phraseWrongCount", { count: String(foundCount) });
    const positions = problem?.kind === "unknownWords" ? problem.positions : unknownPositions;
    if (positions.length === 1) return t("onboarding.phraseUnknownWord", { n: String(positions[0]! + 1) });
    if (positions.length > 1) {
      return t("onboarding.phraseUnknownWords", { list: positions.map((position) => position + 1).join(", ") });
    }
    if (problem?.kind === "checksum") return t("onboarding.phraseChecksum");
    if (problem?.kind === "wordCount") return t("onboarding.phraseWrongCount", { count: String(problem.count) });
    return undefined;
  })();

  if (deriving) {
    return (
      <div className="flex min-h-full flex-col">
        <ScreenHeader title={t("onboarding.importWallet")} />
        <div className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0">
          <Beam className="animate-pulse motion-reduce:animate-none" />
          <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
            <h1 className="text-h3 font-semibold tracking-tight text-foreground">{t("onboarding.phraseDeriving")}</h1>
            <p className="text-body leading-relaxed text-muted">{t("onboarding.phraseDerivingBody")}</p>
          </div>
          <ScreenFooter className="mt-auto">
            <Button type="button" variant="secondary" onClick={cancel}>
              {t("onboarding.phraseCancel")}
            </Button>
          </ScreenFooter>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("onboarding.importWallet")} onBack={onBack} />
      <form
        className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (filled) void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">{t("onboarding.phraseTitle")}</h1>
          <p className="text-body leading-relaxed text-muted">{t("onboarding.phraseBody")}</p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1" role="group" aria-label={t("onboarding.phraseWordCount")}>
            {MNEMONIC_WORD_COUNTS.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={cells.length === size}
                onClick={() => {
                  clearFeedback();
                  setFoundCount(undefined);
                  setCells(resizeGrid(cells, size));
                }}
                className={cn(
                  "rounded-md px-2 py-1 text-caption font-semibold tabular-nums transition-colors",
                  cells.length === size ? "bg-foreground text-background" : "text-muted hover:bg-mist hover:text-foreground",
                )}
              >
                {size}
              </button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed((value) => !value)}>
            {revealed ? t("onboarding.phraseHide") : t("onboarding.phraseShow")}
          </Button>
        </div>

        <ol className="grid grid-cols-3 phone:grid-cols-2 gap-2">
          {cells.map((cell, index) => {
            const unknown = unknownPositions.includes(index);
            return (
              <li key={index} className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-caption tabular-nums text-faint"
                >
                  {index + 1}
                </span>
                <input
                  ref={(element) => {
                    inputs.current[index] = element;
                  }}
                  type="text"
                  {...PRIVATE_INPUT}
                  aria-label={t("onboarding.phraseWordLabel", { n: String(index + 1), total: String(cells.length) })}
                  aria-invalid={unknown}
                  value={cell}
                  data-masked={!(revealed || focused === index)}
                  onFocus={() => setFocused(index)}
                  onBlur={() => {
                    setFocused((current) => (current === index ? null : current));
                    if (cell) setTouched((previous) => new Set(previous).add(index));
                  }}
                  onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
                    event.preventDefault();
                    apply(index, event.clipboardData.getData("text"), true);
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    // Mobile keyboards can paste through `change` without a
                    // paste event, so separators are handled here too.
                    if (SEPARATOR.test(value)) apply(index, value, value.trim().split(SEPARATOR).length > 1);
                    else setCell(index, value.toLowerCase());
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && cell === "" && index > 0) {
                      event.preventDefault();
                      inputs.current[index - 1]?.focus();
                    }
                  }}
                  className={cn(
                    "w-full rounded-md border border-line bg-background py-2 pl-7 pr-2 font-mono text-label text-foreground focus:border-foreground/25 focus:outline-none",
                    unknown && "border-warning",
                    !(revealed || focused === index) && MASKED,
                  )}
                />
              </li>
            );
          })}
        </ol>

        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label={t("onboarding.phraseSuggestions")}>
            {suggestions.map((word) => (
              <button
                key={word}
                type="button"
                // Keeps focus in the cell so the choice applies to it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseSuggestion(word)}
                className="rounded-md border border-line px-2 py-1 font-mono text-caption text-foreground hover:bg-mist"
              >
                {word}
              </button>
            ))}
          </div>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="text-caption leading-relaxed text-warning">
            {errorMessage}
          </p>
        ) : null}

        {pasted ? <p className="text-caption leading-relaxed text-muted">{t("onboarding.phraseClipboard")}</p> : null}

        <ScreenFooter className="mt-8">
          <Button type="submit" disabled={!filled || foundCount !== undefined}>
            {t("onboarding.continue")}
          </Button>
        </ScreenFooter>
      </form>
    </div>
  );
}
