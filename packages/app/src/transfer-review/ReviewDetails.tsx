import { useState } from "react";
import { useT } from "../i18n";
import { UntrustedText } from "../approval/UntrustedText";
import { SignedDataText } from "../approval/SignedDataText";
import { CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";
import { copyToClipboard } from "@gleam/ui/src/primitives/use-copy.ts";
import { GUTTER } from "./review-parts";
import {
  groupDigits,
  methodText,
  type SignedPart,
  type TransferLine,
  type TransferRequest,
} from "./model";

export function ReviewDetails({ request, batch }: { request: TransferRequest; batch: boolean }) {
  const t = useT();
  const showTags = request.unreadableTokenTransfer === true;
  const [open, setOpen] = useState(showTags);
  const first = request.transfers[0]!;
  const method = methodText(request, t);
  const count = t("transferReview.itemsCount", { count: request.itemCount });
  const summary = batch ? (method ? `${method} · ${count}` : count) : groupDigits(first.amount);

  return (
    <div className={`pt-6 ${GUTTER}`}>
      <div className="rounded-xl bg-mist">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-4 text-left text-body font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          <span>{t("transferReview.details")}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span dir="ltr" className="truncate font-mono text-caption font-normal tabular-nums text-muted">
              {summary}
            </span>
            <ChevronIcon open={open} />
          </span>
        </button>
        {open ? (
          <div className="flex flex-col gap-3 px-4 pb-4">
            {method ? <DetailRow label={t("transferReview.method")} value={method} /> : null}
            {batch
              ? request.transfers.map((transfer) => (
                  <div key={transfer.index} className="flex flex-col gap-3 pt-2">
                    <span className="text-label font-semibold text-foreground">
                      {t("transferReview.itemNumber", { number: transfer.index + 1 })}
                    </span>
                    <TransferDetails transfer={transfer} part={transfer.part} showTags={showTags} />
                  </div>
                ))
              : <TransferDetails transfer={first} part={first.part} showTags={showTags} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TransferDetails({ transfer, part, showTags }: { transfer: TransferLine; part: SignedPart; showTags: boolean }) {
  const t = useT();
  const [tagsOpen, setTagsOpen] = useState(showTags);
  return (
    <>
      <DetailRow label={t("transferReview.rawUnitsLabel")} value={groupDigits(transfer.amount)} />
      {transfer.token !== null ? (
        <DetailRow
          label={transfer.collectible ? t("transferReview.collectible") : t("transferReview.process")}
          value={transfer.token}
        />
      ) : null}
      {part.tags.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={tagsOpen}
            onClick={() => setTagsOpen((current) => !current)}
            className="min-h-6 self-start text-label font-medium text-foreground underline underline-offset-[3px] phone:hit-target"
          >
            {tagsOpen ? t("transferReview.hideTags") : t("transferReview.viewAllTags", { count: part.tags.length })}
          </button>
          {tagsOpen ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {part.tags.map((tag, index) => (
                <li key={index} className="break-all font-mono text-caption leading-snug text-foreground">
                  <span className="text-muted">
                    <UntrustedText text={tag.name} />:
                  </span>{" "}
                  <UntrustedText text={tag.value} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {part.decodedData !== null && part.decodedData !== "" ? (
        <div className="flex flex-col gap-1">
          <span className="text-label text-muted">{t("transferReview.decodedData")}</span>
          <SignedDataText
            text={part.decodedData}
            size={part.dataSize}
            truncated={part.dataTruncated}
            index={part.dataIndex}
            boxClassName="overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-caption leading-relaxed text-foreground"
            collapsedClassName="max-h-24"
          />
        </div>
      ) : part.decodedData === null && (part.dataSize ?? 0) > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-label text-muted">{t("approval.data")}</span>
          <span className="font-mono text-caption text-foreground">{t("approval.bytes", { size: String(part.dataSize) })}</span>
        </div>
      ) : null}
      {part.payloadHash !== null ? <PayloadHash value={part.payloadHash} /> : null}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="flex-shrink-0 text-label text-muted">{label}</span>
      <span dir="ltr" className="min-w-0 break-all text-right font-mono text-caption leading-snug tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function PayloadHash({ value }: { value: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label text-muted">{t("transferReview.payloadHash")}</span>
      <div className="flex items-start gap-2">
        <span dir="ltr" className="flex-1 break-all font-mono text-caption leading-relaxed text-foreground">
          {value}
        </span>
        <button
          type="button"
          aria-label={t("transferReview.copyPayloadHash")}
          onClick={() => void copyToClipboard(value)}
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-background hover:text-muted phone:hit-target"
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`flex-shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
