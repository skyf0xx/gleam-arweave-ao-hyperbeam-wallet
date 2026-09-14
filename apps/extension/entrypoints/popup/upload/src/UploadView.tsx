import { useState, type ReactNode } from "react";
import type { RuntimePort, UploadReview, UploadTag, WalletSummary } from "@gleam/core";
import { PasswordField, ScreenHeader } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

const TAG_BYTES_LIMIT = 4096;
const GATEWAY_VIEW_URL = "https://arweave.net";
const VIEWBLOCK_URL = "https://viewblock.io/arweave/tx";

/**
 * Upload flow (upload-flow.html / TODO.md §5) — compose → review → success,
 * same internal step-state shape (no router) as `SendView`/`OnboardingView`.
 *
 * Password prompt: same shape as `SendView`'s — see `handlers/upload.ts`'s
 * doc comment for why `submitUpload` needs `walletId`/`password` alongside
 * `ProtocolMap`'s `UploadDraft`. Collected once on the review step's
 * "Sign and upload", carried only in `step` state, discarded on unmount.
 *
 * UDL license picker: the sibling repo's own material (upload-flow.html,
 * CLAUDE.md item 7, TODO.md §5.1) names only "optional UDL license tag"
 * with no expanded list of license types to choose from — no screen or
 * copy for an expanded picker exists to port. This ships a minimal
 * closed set of common UDL "License-Fee" access conditions (the ones the
 * UDL spec itself names) behind a single picker rather than inventing a
 * fuller flow; reported as a gap in this task's final report rather than
 * fabricated UX.
 */
export interface UploadViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
  onDone: () => void;
}

type SourceKind = "file" | "text" | "json";

const UDL_LICENSE_OPTIONS: Array<{ value: string; label: string; sub: string }> = [
  { value: "", label: "No license", sub: "Optional — add a UDL tag" },
  { value: "Default", label: "Default (UDL)", sub: "Universal Data License, default access terms" },
  { value: "Access-Fee", label: "Access fee (UDL)", sub: "One-time fee required before use" },
];

interface ComposeState {
  kind: "compose";
  source: SourceKind;
  fileName: string | null;
  fileSizeBytes: number | null;
  dataBase64: string;
  contentType: string;
  textValue: string;
  tags: UploadTag[];
  license: string;
  password: string;
  submitting: boolean;
  error?: string;
}

interface ReviewState {
  kind: "review";
  source: SourceKind;
  fileName: string | null;
  dataBase64: string;
  contentType: string;
  tags: UploadTag[];
  licenseTag: UploadTag | null;
  review: UploadReview;
  password: string;
  submitting: boolean;
  error?: string;
}

interface SuccessState {
  kind: "success";
  txId: string;
  fileName: string | null;
}

type Step = ComposeState | ReviewState | SuccessState;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function tagBytes(tags: UploadTag[]): number {
  return tags.reduce(
    (sum, tag) => sum + new TextEncoder().encode(tag.name).byteLength + new TextEncoder().encode(tag.value).byteLength,
    0,
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function licenseTagFor(license: string): UploadTag | null {
  if (!license) return null;
  return { name: "License", value: license };
}

const INITIAL_STEP: ComposeState = {
  kind: "compose",
  source: "file",
  fileName: null,
  fileSizeBytes: null,
  dataBase64: "",
  contentType: "application/octet-stream",
  textValue: "",
  tags: [{ name: "Content-Type", value: "application/octet-stream" }],
  license: "",
  password: "",
  submitting: false,
};

export function UploadView({ runtime, wallet, onBack, onDone }: UploadViewProps) {
  const [step, setStep] = useState<Step>(INITIAL_STEP);

  if (step.kind === "compose") {
    return (
      <ComposeStep
        step={step}
        onBack={onBack}
        onChange={(patch) => setStep({ ...step, ...patch, error: undefined })}
        onContinue={async () => {
          setStep({ ...step, submitting: true, error: undefined });
          try {
            const tags = step.tags.filter((tag) => tag.name.trim().length > 0);
            const licenseTag = licenseTagFor(step.license);
            const review = await runtime.send<
              { contentType: string; data: string; tags: UploadTag[]; licenseTag: UploadTag | null },
              UploadReview
            >({
              type: "reviewUpload",
              payload: { contentType: step.contentType, data: step.dataBase64, tags, licenseTag },
            });
            setStep({
              kind: "review",
              source: step.source,
              fileName: step.fileName,
              dataBase64: step.dataBase64,
              contentType: step.contentType,
              tags,
              licenseTag,
              review,
              password: step.password,
              submitting: false,
            });
          } catch (error) {
            setStep({
              ...step,
              submitting: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }}
      />
    );
  }

  if (step.kind === "review") {
    return (
      <ReviewStep
        wallet={wallet}
        step={step}
        onBack={() =>
          setStep({
            ...INITIAL_STEP,
            source: step.source,
            fileName: step.fileName,
            dataBase64: step.dataBase64,
            contentType: step.contentType,
            tags: step.tags,
            license: step.licenseTag?.value ?? "",
          })
        }
        onPasswordChange={(password) => setStep({ ...step, password, error: undefined })}
        onSign={async () => {
          setStep({ ...step, submitting: true, error: undefined });
          try {
            const result = await runtime.send<
              {
                walletId: string;
                password: string;
                contentType: string;
                data: string;
                tags: UploadTag[];
                licenseTag: UploadTag | null;
              },
              { txId: string }
            >({
              type: "submitUpload",
              payload: {
                walletId: wallet.id,
                password: step.password,
                contentType: step.contentType,
                data: step.dataBase64,
                tags: step.tags,
                licenseTag: step.licenseTag,
              },
            });
            setStep({ kind: "success", txId: result.txId, fileName: step.fileName });
          } catch (error) {
            setStep({
              ...step,
              submitting: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }}
      />
    );
  }

  return <SuccessStep step={step} onDone={onDone} />;
}

function ComposeStep({
  step,
  onBack,
  onChange,
  onContinue,
}: {
  step: ComposeState;
  onBack: () => void;
  onChange: (patch: Partial<ComposeState>) => void;
  onContinue: () => void;
}) {
  const totalTagBytes = tagBytes(step.tags);
  const overLimit = totalTagBytes > TAG_BYTES_LIMIT;
  const hasContent = step.source === "file" ? step.dataBase64.length > 0 : step.textValue.trim().length > 0;
  const canContinue = hasContent && !overLimit && step.password.length > 0 && !step.submitting;

  const handleFilePicked = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const dataBase64 = bytesToBase64(new Uint8Array(buffer));
    const contentType = file.type || "application/octet-stream";
    onChange({
      fileName: file.name,
      fileSizeBytes: file.size,
      dataBase64,
      contentType,
      tags: [{ name: "Content-Type", value: contentType }, ...step.tags.slice(1)],
    });
  };

  const handleTextChanged = (text: string, contentType: string) => {
    const dataBase64 = bytesToBase64(new TextEncoder().encode(text));
    onChange({
      textValue: text,
      dataBase64,
      contentType,
      tags: [{ name: "Content-Type", value: contentType }, ...step.tags.slice(1)],
    });
  };

  const updateTag = (index: number, patch: Partial<UploadTag>) => {
    const tags = step.tags.map((tag, i) => (i === index ? { ...tag, ...patch } : tag));
    onChange({ tags });
  };

  const removeTag = (index: number) => {
    onChange({ tags: step.tags.filter((_, i) => i !== index) });
  };

  const addTag = () => {
    onChange({ tags: [...step.tags, { name: "", value: "" }] });
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Upload" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-5 px-5 py-5">
        <div className="flex rounded-[10px] bg-[#f5f5f5] p-[3px]">
          {(["file", "text", "json"] as SourceKind[]).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => onChange({ source })}
              className={`flex-1 rounded-[8px] py-2 text-xs font-semibold ${
                step.source === source ? "bg-white text-[#111111]" : "text-[#737373]"
              }`}
            >
              {source === "file" ? "File" : source === "text" ? "Text" : "JSON"}
            </button>
          ))}
        </div>

        {step.source === "file" ? (
          step.fileName ? (
            <FileRow
              name={step.fileName}
              size={step.fileSizeBytes ?? 0}
              onRemove={() => onChange({ fileName: null, fileSizeBytes: null, dataBase64: "" })}
            />
          ) : (
            <label className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-[#e5e5e5] bg-[#f5f5f5] px-4 py-8 text-center">
              <input
                type="file"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFilePicked(file);
                }}
              />
              <DropZoneIcon />
              <span className="text-[13px] font-semibold text-[#111111]">Drop a file, or click to browse</span>
              <span className="text-[11px] text-[#a3a3a3]">Any file type</span>
            </label>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-[#737373]">Content</span>
            <textarea
              rows={5}
              value={step.textValue}
              onChange={(event) =>
                handleTextChanged(event.target.value, step.source === "json" ? "application/json" : "text/plain")
              }
              placeholder={
                step.source === "json" ? "Paste JSON to publish…" : "Write or paste text to publish…"
              }
              className="w-full resize-none rounded-[9px] border border-[#e5e5e5] bg-white px-3.5 py-3 font-mono text-xs leading-relaxed text-[#111111] focus:border-[#111111] focus:outline-none"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold text-[#737373]">Tags</span>
            <span className={`text-[11px] ${overLimit ? "font-semibold text-[#ff1717]" : "text-[#a3a3a3]"}`}>
              {totalTagBytes.toLocaleString()} of {TAG_BYTES_LIMIT.toLocaleString()} bytes
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {step.tags.map((tag, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Name"
                  value={tag.name}
                  onChange={(event) => updateTag(index, { name: event.target.value })}
                  className="min-w-0 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-2 text-xs text-[#111111] focus:border-[#111111] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={tag.value}
                  onChange={(event) => updateTag(index, { value: event.target.value })}
                  className="min-w-0 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-2 text-xs text-[#111111] focus:border-[#111111] focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Remove tag"
                  onClick={() => removeTag(index)}
                  className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[8px] text-[#a3a3a3] hover:bg-[#f5f5f5] hover:text-[#ff1717]"
                >
                  <RemoveIcon />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addTag}
            className="flex items-center gap-1.5 self-start py-1.5 text-xs font-semibold text-[#737373] hover:text-[#111111]"
          >
            <PlusIcon />
            Add tag
          </button>
          {overLimit ? (
            <div role="alert" className="flex items-start gap-1.5 text-xs leading-snug text-[#ff1717]">
              <span>
                Tags are {totalTagBytes.toLocaleString()} bytes — the limit is{" "}
                {TAG_BYTES_LIMIT.toLocaleString()}.
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-[#737373]">License</span>
          <select
            value={step.license}
            onChange={(event) => onChange({ license: event.target.value })}
            className="w-full rounded-[9px] border border-[#e5e5e5] bg-white px-3.5 py-3 text-[13px] font-semibold text-[#111111] focus:border-[#111111] focus:outline-none"
          >
            {UDL_LICENSE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <PasswordField
          label="Password"
          placeholder="Enter your password to continue"
          autoComplete="current-password"
          value={step.password}
          onChange={(event) => onChange({ password: event.target.value })}
        />

        {step.error ? (
          <div role="alert" className="text-xs leading-snug text-[#ff1717]">
            {step.error}
          </div>
        ) : null}

        <Button
          type="button"
          disabled={!canContinue}
          aria-busy={step.submitting}
          onClick={onContinue}
          className="mt-auto w-full rounded-[10px] py-3"
        >
          {step.submitting ? "Checking…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function FileRow({ name, size, onRemove }: { name: string; size: number; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[9px] border border-[#e5e5e5] bg-white p-3.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] bg-[#f5f5f5] text-[#111111]">
        <FileIcon />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-semibold text-[#111111]">{name}</span>
        <span className="text-[11px] text-[#737373]">{formatFileSize(size)}</span>
      </div>
      <button
        type="button"
        aria-label="Remove file"
        onClick={onRemove}
        className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[8px] text-[#a3a3a3] hover:bg-[#f5f5f5] hover:text-[#111111]"
      >
        <RemoveIcon />
      </button>
    </div>
  );
}

function ReviewStep({
  wallet,
  step,
  onBack,
  onPasswordChange,
  onSign,
}: {
  wallet: WalletSummary;
  step: ReviewState;
  onBack: () => void;
  onPasswordChange: (password: string) => void;
  onSign: () => void;
}) {
  const tripped = step.review.secretScanMatch !== null;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Review upload" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-5 px-5 py-5">
        {step.fileName ? <FileRow name={step.fileName} size={0} onRemove={onBack} /> : null}

        {tripped ? (
          <div role="alert" className="flex gap-2.5 rounded-[9px] border border-[#ffd6d6] bg-[#fff5f5] p-3.5">
            <WarningIcon className="mt-px flex-shrink-0 text-[#ff1717]" />
            <p className="text-xs leading-relaxed text-[#111111]">
              <strong className="font-bold">This looks like a {step.review.secretScanMatch}.</strong> Uploads
              are public and permanent — remove it before continuing.
            </p>
          </div>
        ) : (
          <div className="flex gap-2.5 rounded-[9px] bg-[#f5f5f5] p-3.5">
            <InfoIcon className="mt-px flex-shrink-0 text-[#737373]" />
            <p className="text-xs leading-relaxed text-[#111111]">
              This upload is public and permanent once signed. Anyone can view it, and it can&apos;t be
              edited or removed.
            </p>
          </div>
        )}

        <div className="flex flex-col">
          <ReviewRow
            label="Tags"
            value={
              <span className="flex flex-wrap justify-end gap-1.5">
                {step.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="rounded-[5px] border border-[#e5e5e5] bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#737373]"
                  >
                    {tag.name}: {tag.value}
                  </span>
                ))}
              </span>
            }
          />
          <ReviewRow label="License" value={step.licenseTag ? step.licenseTag.value : "No license"} />
        </div>

        {!tripped ? (
          <PasswordField
            label="Password"
            placeholder="Enter your password to continue"
            autoComplete="current-password"
            value={step.password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        ) : null}

        {step.error ? (
          <div role="alert" className="text-xs leading-snug text-[#ff1717]">
            {step.error}
          </div>
        ) : null}

        <Button
          type="button"
          disabled={tripped || step.password.length === 0 || step.submitting}
          aria-busy={step.submitting}
          onClick={onSign}
          className="mt-auto w-full rounded-[10px] py-3"
        >
          {step.submitting ? "Signing…" : "Sign and upload"}
        </Button>
      </div>
      <span className="sr-only">{wallet.name}</span>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#e5e5e5] py-2.5 text-[13px] last:border-b-0">
      <span className="flex-shrink-0 text-[#737373]">{label}</span>
      <span className="text-right font-semibold text-[#111111]">{value}</span>
    </div>
  );
}

function SuccessStep({ step, onDone }: { step: SuccessState; onDone: () => void }) {
  const contentUrl = `${GATEWAY_VIEW_URL}/${step.txId}`;
  const viewblockUrl = `${VIEWBLOCK_URL}/${step.txId}`;

  return (
    <div className="flex min-h-full flex-col items-center gap-4 px-6 pb-6 pt-12 text-center">
      <div className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#f5f5f5] text-[#111111]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-base text-[#111111]">Signed and uploaded.</h2>
      {step.fileName ? <p className="-mt-2 text-[13px] text-[#737373]">{step.fileName}</p> : null}

      <div className="mt-2 flex w-full items-center gap-2 border-b border-[#e5e5e5] py-3 text-xs text-[#737373]">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FFE45C]" />
        <span>Pending confirmation</span>
      </div>

      <div className="mt-1 flex justify-center gap-4">
        <a
          href={contentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-[#737373] underline-offset-2 hover:text-[#111111] hover:underline"
        >
          View content
        </a>
        <a
          href={viewblockUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-[#737373] underline-offset-2 hover:text-[#111111] hover:underline"
        >
          View on ViewBlock
        </a>
      </div>

      <Button type="button" onClick={onDone} className="mt-auto w-full rounded-[10px] py-3">
        Done
      </Button>
    </div>
  );
}

function DropZoneIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[#737373]">
      <path d="M12 16V4M12 4 7 9M12 4l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
