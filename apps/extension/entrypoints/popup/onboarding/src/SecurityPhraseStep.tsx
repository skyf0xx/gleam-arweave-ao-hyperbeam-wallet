import { useMemo, useState } from "react";
import { readSecurityPhrase, suggestSecurityPhrase, type RuntimePort, type SecurityPhrase } from "@gleam/core";
import { SecurityPhrasePicker } from "@gleam/ui/src/components/security-phrase/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { securityPhraseIconSvg } from "@/src/security-phrase-icon";
import { useAddressIdentity } from "@/src/address-identity";

export interface SecurityPhraseStepProps {
  runtime: RuntimePort;
  onDone: () => void;
}

/** Onboarding's anti-phishing step. It starts on a suggestion, so Continue alone is enough. */
export function SecurityPhraseStep({ runtime, onDone }: SecurityPhraseStepProps) {
  const { refresh: refreshAddressIdentity } = useAddressIdentity();
  const [phrase, setPhrase] = useState<SecurityPhrase>(() => suggestSecurityPhrase());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const validWord = readSecurityPhrase(phrase)?.word;
  const valid = validWord !== undefined;
  const icon = useMemo(() => (validWord ? securityPhraseIconSvg(validWord) : undefined), [validWord]);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Security phrase" />
      <form
        className="flex flex-1 flex-col gap-5 px-6 py-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || saving) return;
          setSaving(true);
          setError(undefined);
          runtime
            .send<SecurityPhrase, void>({ type: "setSecurityPhrase", payload: phrase })
            .then(() => {
              refreshAddressIdentity();
              onDone();
            }, (caught: unknown) => {
              setError(caught instanceof Error ? caught.message : String(caught));
              setSaving(false);
            });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">Pick your security phrase</h1>
          <p className="text-body leading-relaxed text-muted">
            Pick a word. Gleam draws an icon from it and shows both when you unlock and on every request it
            asks you to approve. If a window asks for your password without them, that window isn&apos;t Gleam.
          </p>
        </div>

        <SecurityPhrasePicker
          value={phrase}
          iconSvg={icon}
          onChange={setPhrase}
          disabled={saving}
          errorMessage={error ?? (valid ? undefined : "Use up to 24 letters or numbers.")}
        />

        <Button type="submit" disabled={!valid || saving} className="mt-auto">
          {saving ? "Saving…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
