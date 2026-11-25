import { useT } from "../i18n";
import { SignedDataText } from "../approval/SignedDataText";
import { TagTiers } from "./TagTiers";
import type { OtherItem } from "./model";
import { Field } from "./FieldLabel";

/**
 * One data item a request signs that moves no value: its tags in tiers,
 * its data and hash. `numbered` heads it with its item number, for a
 * request that signs more than one.
 */
export function DataItemCard({
  index,
  item,
  numbered,
  walletAddress,
}: {
  index: number;
  item: OtherItem;
  numbered: boolean;
  walletAddress: string | null;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      {numbered || item.unreadableTokenTransfer ? (
        <div className="flex items-baseline justify-between gap-2">
          {numbered ? <span className="text-label font-semibold text-foreground">{t("approval.itemNumber", { number: index + 1 })}</span> : <span />}
          {item.unreadableTokenTransfer ? (
            <span className="text-caption font-semibold text-warning">{t("approval.unreadableItem")}</span>
          ) : null}
        </div>
      ) : null}

      <TagTiers tags={item.tags} target={item.target} walletAddress={walletAddress} />

      {item.decodedData !== null && item.decodedData !== "" ? (
        <Field label={t("approval.decodedData")} className="gap-1">
          <SignedDataText
            text={item.decodedData}
            size={item.dataSize}
            truncated={item.dataTruncated}
            index={index}
            boxClassName="overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-mist p-2 font-mono text-caption leading-relaxed text-foreground"
            collapsedClassName="max-h-20"
          />
        </Field>
      ) : item.decodedData === null && (item.dataSize ?? 0) > 0 ? (
        <Field label={t("approval.data")} className="gap-1">
          <span className="font-mono text-caption text-foreground">{t("approval.bytes", { size: String(item.dataSize) })}</span>
        </Field>
      ) : null}

      <Field label={t("approval.payloadHash")} className="gap-1">
        <span className="break-all font-mono text-caption text-foreground">{item.payloadHash}</span>
      </Field>
    </div>
  );
}
