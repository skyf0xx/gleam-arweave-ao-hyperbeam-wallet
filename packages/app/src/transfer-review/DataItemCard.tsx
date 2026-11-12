import { MemorableAddress } from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../address-identity";
import { useT } from "../i18n";
import { UntrustedText } from "../approval/UntrustedText";
import type { OtherItem } from "./model";

/** One data item a request signs that moves no value: its target, data, tags and hash. */
export function DataItemCard({ index, item }: { index: number; item: OtherItem }) {
  const t = useT();
  const identity = useAddressIdentity();
  const { emphasisPick } = identity;
  const targetAvatarSvg = item.target ? identity.avatarSvg(item.target) : undefined;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-caption font-semibold text-foreground">{t("approval.itemNumber", { number: index + 1 })}</span>
        {item.unreadableTokenTransfer ? (
          <span className="text-caption font-semibold text-warning">{t("approval.unreadableItem")}</span>
        ) : null}
      </div>

      {item.target !== null ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.target")}</span>
          <MemorableAddress address={item.target} emphasisPick={emphasisPick} avatarSvg={targetAvatarSvg} />
        </div>
      ) : null}

      {item.decodedData !== null && item.decodedData !== "" ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.decodedData")}</span>
          <div className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-mist p-2 font-mono text-caption leading-relaxed text-foreground">
            <UntrustedText text={item.decodedData} />
          </div>
        </div>
      ) : null}

      {item.tags.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.tags")}</span>
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag, tagIndex) => (
              <span key={tagIndex} className="break-all rounded-md bg-mist px-2 py-1 font-mono text-micro text-foreground">
                <span className="text-muted"><UntrustedText text={tag.name} />:</span> <UntrustedText text={tag.value} />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-0.5">
        <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.payloadHash")}</span>
        <span className="break-all font-mono text-caption text-foreground">{item.payloadHash}</span>
      </div>
    </div>
  );
}
