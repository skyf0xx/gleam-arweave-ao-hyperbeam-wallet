import { useState } from "react";
import { ScreenHeader, KeyfileDropzone } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { validateJWKShape } from "@gleam/core/src/keys/jwk.ts";

/**
 * 1.4 Import wallet (onboarding.html) — file drop + paste-JSON fallback,
 * validates JWK shape before proceeding to the password screen (TODO.md
 * 1.4). Rejects invalid files with the specific reason
 * `validateJWKShape` returns, never a generic error.
 */
export interface ImportProps {
  onBack: () => void;
  onValidJWK: (jwk: unknown) => void;
}

export function Import({ onBack, onValidJWK }: ImportProps) {
  const [fileName, setFileName] = useState<string>();
  const [pasteValue, setPasteValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [pendingJWK, setPendingJWK] = useState<unknown>(null);

  const tryParse = (raw: string, sourceName?: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setErrorMessage("That file isn't a valid Arweave keyfile.");
      setPendingJWK(null);
      if (sourceName) setFileName(sourceName);
      return;
    }

    const result = validateJWKShape(parsed);
    if (!result.valid) {
      setErrorMessage(result.reason);
      setPendingJWK(null);
      if (sourceName) setFileName(sourceName);
      return;
    }

    setErrorMessage(undefined);
    setPendingJWK(result.jwk);
    if (sourceName) setFileName(sourceName);
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Import a wallet" onBack={onBack} />
      <form
        className="flex flex-1 flex-col gap-5 px-6 py-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (pendingJWK) onValidJWK(pendingJWK);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-[#111111]">
            Add your keyfile
          </h1>
          <p className="text-[13px] leading-relaxed text-[#737373]">
            Import an existing Arweave wallet using its JWK keyfile.
          </p>
        </div>

        <KeyfileDropzone
          fileName={fileName}
          errorMessage={errorMessage}
          pasteValue={pasteValue}
          onPasteChange={(value) => {
            setPasteValue(value);
            if (value.trim().length > 0) tryParse(value);
          }}
          onFileRead={(contents, name) => tryParse(contents, name)}
        />

        <Button type="submit" disabled={!pendingJWK} className="mt-8 w-full rounded-[10px] py-3">
          Continue
        </Button>
      </form>
    </div>
  );
}
