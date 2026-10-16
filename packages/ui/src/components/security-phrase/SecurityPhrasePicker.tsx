import { SECURITY_PHRASE_EMOJI, SECURITY_PHRASE_WORD_MAX_LENGTH, type SecurityPhrase } from "@gleam/core";
import { TextField } from "../../primitives/text-field";
import { cn } from "../../primitives/cn";

export interface SecurityPhrasePickerProps {
  value: SecurityPhrase;
  onChange: (phrase: SecurityPhrase) => void;
  disabled?: boolean;
  errorMessage?: string;
}

/** An emoji from the fixed set and a word. Validation is the caller's (`readSecurityPhrase`). */
export function SecurityPhrasePicker({ value, onChange, disabled = false, errorMessage }: SecurityPhrasePickerProps) {
  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Emoji" className="grid grid-cols-8 gap-1">
        {SECURITY_PHRASE_EMOJI.map((emoji) => {
          const selected = emoji === value.emoji;
          return (
            <button
              key={emoji}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={emoji}
              disabled={disabled}
              onClick={() => onChange({ ...value, emoji })}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-[18px] leading-none hover:bg-mist disabled:opacity-60",
                selected && "bg-mist ring-1 ring-foreground",
              )}
            >
              {emoji}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="security-phrase-word" className="text-caption font-semibold text-muted">
          Word
        </label>
        <TextField
          id="security-phrase-word"
          value={value.word}
          maxLength={SECURITY_PHRASE_WORD_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, word: event.target.value })}
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
