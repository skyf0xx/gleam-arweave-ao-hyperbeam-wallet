import { useState } from "react";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { FileDropzone } from "@gleam/ui/src/primitives/file-dropzone.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { validateJWKShape } from "@gleam/core/src/keys/jwk.ts";

/**
 * 1.4 Import wallet (onboarding.html) — file drop + paste-JSON fallback,
 * validates JWK shape before proceeding to the password screen (TODO.md
 * 1.4). Rejects invalid files with the specific reason
 * `validateJWKShape` returns, never a generic error. Uses the shared,
 * content-agnostic `FileDropzone` primitive (replaces the onboarding-only
 * `KeyfileDropzone`, per this task's inherited debt note) — the
 * paste-JSON divider/textarea stays local screen composition, since no
 * shared primitive covers that shape yet.
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

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") tryParse(reader.result, file.name);
    };
    reader.readAsText(file);
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
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">
            Add your keyfile
          </h1>
          <p className="text-body leading-relaxed text-muted">
            Import an existing Arweave wallet using its JWK keyfile.
          </p>
        </div>

        <FileDropzone
          label="Drop your keyfile here"
          hint=".json · or click to browse"
          fileName={fileName}
          errorMessage={errorMessage}
          accept="application/json"
          onFile={readFile}
        />

        <div className="flex items-center gap-2.5">
          <span className="h-px flex-1 bg-line" />
          <span className="text-caption text-faint">or paste JSON</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <textarea
          value={pasteValue}
          onChange={(event) => {
            setPasteValue(event.target.value);
            if (event.target.value.trim().length > 0) tryParse(event.target.value);
          }}
          placeholder='{"kty":"RSA","n":"…'
          className="min-h-[84px] resize-none rounded-md border border-line bg-background p-3 font-mono text-caption leading-relaxed text-foreground placeholder:font-sans placeholder:text-faint focus:border-foreground focus:outline-none"
        />

        <Button type="submit" disabled={!pendingJWK} className="mt-8">
          Continue
        </Button>
      </form>
    </div>
  );
}
