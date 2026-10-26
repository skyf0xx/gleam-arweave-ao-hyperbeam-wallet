import { SECURITY_PHRASE_WORD_MAX_LENGTH, suggestSecurityPhrase, type SecurityPhrase } from "@gleam/core";
import { TextField } from "../../primitives/text-field";
import { SecurityPhraseIcon } from "./SecurityPhraseIcon";

export interface SecurityPhrasePickerProps {
  value: SecurityPhrase;
  onChange: (phrase: SecurityPhrase) => void;
  /** The icon drawn from the word as typed, or nothing while the word isn't valid. */
  iconSvg?: string;
  disabled?: boolean;
  errorMessage?: string;
}

/** A word, with its icon redrawn as it's typed. Validation is the caller's (`readSecurityPhrase`). */
export function SecurityPhrasePicker({ value, onChange, iconSvg, disabled = false, errorMessage }: SecurityPhrasePickerProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-center py-2">
        <SecurityPhraseIcon svgMarkup={iconSvg} size={72} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="security-phrase-word" className="text-caption font-semibold text-muted">
            Word
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(suggestSecurityPhrase(Math.random, value.word))}
            className="rounded-md px-1.5 py-0.5 text-caption font-medium text-muted hover:bg-mist hover:text-foreground disabled:opacity-60 phone:flex phone:min-h-11 phone:items-center phone:px-2.5"
          >
            Suggest another
          </button>
        </div>
        <TextField
          id="security-phrase-word"
          value={value.word}
          maxLength={SECURITY_PHRASE_WORD_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange({ word: event.target.value })}
        />
        {errorMessage ? (
          <p role="alert" className="text-caption text-warning">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
