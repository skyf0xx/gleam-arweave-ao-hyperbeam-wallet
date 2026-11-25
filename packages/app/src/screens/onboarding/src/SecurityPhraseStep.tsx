import { useMemo, useState } from "react";
import { readSecurityPhrase, suggestSecurityPhrase, type RuntimePort, type SecurityPhrase } from "@gleam/core";
import { SecurityPhrasePicker } from "@gleam/ui/src/components/security-phrase/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { securityPhraseIconSvg } from "../../../security-phrase-icon";
import { useAddressIdentity } from "../../../address-identity";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { StepForm, StepIntro } from "@gleam/ui/src/components/onboarding/index.ts";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";

export interface SecurityPhraseStepProps {
  runtime: RuntimePort;
  onDone: () => void;
}

/** Onboarding's anti-phishing step. It starts on a suggestion, so Continue alone is enough. */
export function SecurityPhraseStep({ runtime, onDone }: SecurityPhraseStepProps) {
  const t = useT();
  const { refresh: refreshAddressIdentity } = useAddressIdentity();
  const [phrase, setPhrase] = useState<SecurityPhrase>(() => suggestSecurityPhrase());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const validWord = readSecurityPhrase(phrase)?.word;
  const valid = validWord !== undefined;
  const icon = useMemo(() => (validWord ? securityPhraseIconSvg(validWord) : undefined), [validWord]);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("onboarding.antiPhishingTitle")} />
      <StepForm
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
              setError(errorText(caught));
              setSaving(false);
            });
        }}
      >
        <StepIntro title={t("onboarding.antiPhishingHeading")} body={t("onboarding.antiPhishingBody")} />

        <SecurityPhrasePicker
          value={phrase}
          iconSvg={icon}
          onChange={setPhrase}
          disabled={saving}
          errorMessage={error ?? (valid ? undefined : t("onboarding.antiPhishingInvalid"))}
        />

        <ScreenFooter>
          <Button type="submit" disabled={!valid || saving}>
            {saving ? t("onboarding.saving") : t("onboarding.continue")}
          </Button>
        </ScreenFooter>
      </StepForm>
    </div>
  );
}
