import * as React from "react";
import { cn } from "./cn";

/**
 * File drop target. Presentational and content-agnostic: hands the
 * dropped/selected `File` up via `onFile` and lets the caller own the
 * read (text parse, size validation, etc.) — this primitive never
 * assumes the file is JSON/a keyfile specifically, so both the
 * onboarding import flow and the upload-compose flow can compose it.
 */
export interface FileDropzoneProps {
  label?: string;
  hint?: string;
  fileName?: string;
  errorMessage?: string;
  accept?: string;
  onFile: (file: File) => void;
  className?: string;
}

export function FileDropzone({
  label = "Drop a file here",
  hint = "or click to browse",
  fileName,
  errorMessage,
  accept,
  onFile,
  className,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        tabIndex={0}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border border-dashed border-line px-5 py-7 text-center text-muted hover:border-faint",
          dragging && "border-faint bg-mist",
          errorMessage && "border-warning",
        )}
      >
        <span className={cn("text-faint", errorMessage && "text-warning")}>
          {errorMessage ? <ErrorGlyph /> : <UploadGlyph />}
        </span>
        <span className="text-label font-semibold text-foreground">{fileName ?? label}</span>
        <span className="text-caption text-faint">{fileName ? "Click to try another file" : hint}</span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>
      {errorMessage ? (
        <div role="alert" className="flex items-start gap-1.5 text-caption leading-snug text-warning">
          <ErrorGlyph small />
          <span>{errorMessage}</span>
        </div>
      ) : null}
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v12M12 15l-4-4M12 15l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
