import { useEffect, useState } from "react";
import { usePlatform } from "../../../app-platform/context";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { FileDropzone } from "@gleam/ui/src/primitives/file-dropzone.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { validateJWKShape } from "@gleam/core/src/keys/jwk.ts";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { StepForm, StepIntro } from "@gleam/ui/src/components/onboarding/index.ts";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";

/**
 * Import wallet — file drop + paste-JSON fallback, validates JWK shape
 * before proceeding to the password screen. Rejects invalid files with
 * the specific reason `validateJWKShape` returns, never a generic error.
 * Uses the shared, content-agnostic `FileDropzone` primitive — the
 * paste-JSON divider/textarea stays local screen composition, since no
 * shared primitive covers that shape yet.
 */
export interface ImportProps {
  onBack: () => void;
  onValidJWK: (jwk: unknown) => void;
}

export function Import({ onBack, onValidJWK }: ImportProps) {
  const t = useT();
  // A pasted keyfile is the key itself, shown in full.
  const { secureScreen } = usePlatform();
  useEffect(() => secureScreen?.protect(), [secureScreen]);
  const [fileName, setFileName] = useState<string>();
  const [pasteValue, setPasteValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [pendingJWK, setPendingJWK] = useState<unknown>(null);

  const tryParse = (raw: string, sourceName?: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setErrorMessage(t("onboarding.invalidKeyfile"));
      setPendingJWK(null);
      if (sourceName) setFileName(sourceName);
      return;
    }

    const result = validateJWKShape(parsed);
    if (!result.valid) {
      setErrorMessage(errorText(result.reason));
      setPendingJWK(null);
      if (sourceName) setFileName(sourceName);
      return;
    }

    setErrorMessage(undefined);
    setPendingJWK(result.jwk);
    if (sourceName) setFileName(sourceName);
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") tryParse(reader.result, file.name);
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("onboarding.importWallet")} onBack={onBack} />
      <StepForm
        onSubmit={(event) => {
          event.preventDefault();
          if (pendingJWK) onValidJWK(pendingJWK);
        }}
      >
        <StepIntro title={t("onboarding.importKeyfileTitle")} body={t("onboarding.importKeyfileBody")} />

        <FileDropzone
          label={t("onboarding.dropKeyfile")}
          hint={t("onboarding.dropKeyfileHint")}
          fileName={fileName}
          errorMessage={errorMessage}
          accept="application/json"
          onFile={readFile}
        />

        <div className="flex items-center gap-2.5">
          <span className="h-px flex-1 bg-line" />
          <span className="text-caption text-faint">{t("onboarding.orPasteJson")}</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <textarea
          value={pasteValue}
          onChange={(event) => {
            setPasteValue(event.target.value);
            if (event.target.value.trim().length > 0) tryParse(event.target.value);
          }}
          placeholder='{"kty":"RSA","n":"…'
          className="min-h-[84px] resize-none rounded-md border border-line bg-background p-3 font-mono text-caption leading-relaxed text-foreground placeholder:font-sans placeholder:text-faint focus:border-foreground/25 focus:outline-none"
        />

        <ScreenFooter className="mt-8">
          <Button type="submit" disabled={!pendingJWK}>
            {t("onboarding.continue")}
          </Button>
        </ScreenFooter>
      </StepForm>
    </div>
  );
}
