import * as React from "react";
import { cn } from "../../primitives/cn";

/**
 * File drop + paste-JSON fallback for importing a keyfile
 * (onboarding.html's `.dropzone` / `.paste-input`, 1.4). Presentational
 * only: reads the dropped/selected `File` as text and hands the raw
 * string up via `onFileRead` — shape validation (`validateJWKShape`) is
 * the view module's job, not this component's, since that logic lives in
 * `@gleam/core` and this package never calls it directly.
 */
export interface KeyfileDropzoneProps {
  fileName?: string;
  errorMessage?: string;
  pasteValue: string;
  onPasteChange: (value: string) => void;
  onFileRead: (contents: string, fileName: string) => void;
  className?: string;
}

export function KeyfileDropzone({
  fileName,
  errorMessage,
  pasteValue,
  onPasteChange,
  onFileRead,
  className,
}: KeyfileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onFileRead(reader.result, file.name);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <label
        tabIndex={0}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border border-dashed border-[#e5e5e5] px-5 py-7 text-center text-[#737373] hover:border-[#a3a3a3]",
          errorMessage && "border-[#ff1717]",
        )}
      >
        <span className={cn("text-[#a3a3a3]", errorMessage && "text-[#ff1717]")}>
          {errorMessage ? <ErrorGlyph /> : <UploadGlyph />}
        </span>
        <span className="text-[13px] font-semibold text-[#111111]">
          {fileName ?? "Drop your keyfile here"}
        </span>
        <span className="text-xs text-[#a3a3a3]">
          {fileName ? "Click to try another file" : ".json · or click to browse"}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => readFile(event.target.files?.[0])}
        />
      </label>

      {errorMessage ? (
        <div role="alert" className="flex items-start gap-1.5 text-xs leading-snug text-[#ff1717]">
          <ErrorGlyph small />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="flex items-center gap-2.5">
        <span className="h-px flex-1 bg-[#e5e5e5]" />
        <span className="text-[11px] text-[#a3a3a3]">or paste JSON</span>
        <span className="h-px flex-1 bg-[#e5e5e5]" />
      </div>

      <textarea
        value={pasteValue}
        onChange={(event) => onPasteChange(event.target.value)}
        placeholder='{"kty":"RSA","n":"…'
        className="min-h-[84px] resize-none rounded-[9px] border border-[#e5e5e5] bg-white p-3 font-mono text-xs leading-relaxed text-[#111111] placeholder:font-sans placeholder:text-[#a3a3a3] focus:border-[#111111] focus:outline-none"
      />
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12M12 15l-4-4M12 15l4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorGlyph({ small = false }: { small?: boolean }) {
  const size = small ? 14 : 28;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={small ? "mt-[1px] flex-shrink-0" : undefined}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
