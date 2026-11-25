import type { ReactNode } from "react";
import { MemorableAddress } from "@gleam/ui/src/components/wallet/index.ts";
import { tierTags, type AppTag } from "@gleam/core/src/ao/tag-tiers.ts";
import { useAddressIdentity } from "../address-identity";
import { useT } from "../i18n";
import { UntrustedText } from "../approval/UntrustedText";
import type { Tag } from "@gleam/core";
import { FieldLabel } from "./FieldLabel";

const ROW = "grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-x-3 text-label leading-snug";

/**
 * A signed item's target and tags, sorted by `tierTags`: the Action (or a
 * Type) as the headline, then addresses, app tags and the protocol tags,
 * every tag shown. Tags carrying the same address share one row, so the
 * address is read once; the signing wallet is named.
 */
export function TagTiers({ tags, target, walletAddress }: { tags: readonly Tag[]; target: string | null; walletAddress: string | null }) {
  const t = useT();
  const tiers = tierTags(tags);
  const thisWallet = (address: string) => (address === walletAddress ? t("approval.tagThisWallet") : null);

  return (
    <>
      {tiers.headline ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-mist p-3">
          <FieldLabel><UntrustedText text={tiers.headline.tag.name} /></FieldLabel>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="break-all font-mono text-h3 font-semibold text-foreground">
              <UntrustedText text={tiers.headline.tag.value} />
            </span>
            {tiers.headline.quantity ? (
              <span className="break-all font-mono text-label text-muted">
                {tiers.headline.quantity.name} <UntrustedText text={tiers.headline.quantity.value} />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {target !== null || tiers.addresses.length > 0 ? (
        <Section label={t("approval.tagAddresses")}>
          {groupByAddress(target === null ? null : t("approval.target"), target, tiers.addresses).map((group) => (
            <AddressRow key={group.address} labels={group.labels} address={group.address} note={thisWallet(group.address)} />
          ))}
        </Section>
      ) : null}

      {tiers.app.length > 0 ? (
        <Section label={t("approval.tagApp")}>
          {tiers.app.map((tag, index) => (
            <AppTagRow key={index} tag={tag} />
          ))}
        </Section>
      ) : null}

      {tiers.protocol.length > 0 ? (
        <Section label={t("approval.tagProtocol")} gap="gap-1">
          {tiers.protocol.map((tag, index) => (
            <div key={index} className={`${ROW} text-caption`}>
              <span className="break-words text-muted"><UntrustedText text={tag.name} /></span>
              <span className="break-all font-mono text-muted"><UntrustedText text={tag.value} /></span>
            </div>
          ))}
        </Section>
      ) : null}
    </>
  );
}

function Section({ label, gap = "gap-2", children }: { label: string; gap?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col ${gap}`}>
      <FieldLabel className="pb-0.5">{label}</FieldLabel>
      {children}
    </div>
  );
}

interface AddressGroup {
  address: string;
  labels: ReactNode[];
}

/**
 * Groups address tags by exact value, in order of first appearance, with the
 * target first. Exact equality on purpose: an address one character off a
 * group's stays on its own row instead of hiding among look-alikes.
 */
function groupByAddress(targetLabel: string | null, target: string | null, tags: readonly Tag[]): AddressGroup[] {
  const groups = new Map<string, AddressGroup>();
  if (target !== null && targetLabel !== null) groups.set(target, { address: target, labels: [targetLabel] });
  tags.forEach((tag) => {
    const label = <UntrustedText text={tag.name} />;
    const group = groups.get(tag.value);
    if (group) group.labels.push(label);
    else groups.set(tag.value, { address: tag.value, labels: [label] });
  });
  return [...groups.values()];
}

function AddressRow({ labels, address, note }: { labels: ReactNode[]; address: string; note: string | null }) {
  const { emphasisPick } = useAddressIdentity();
  return (
    <div className={ROW}>
      <span className="flex flex-col break-words text-muted">
        {labels.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <MemorableAddress address={address} emphasisPick={emphasisPick} />
        {note ? <span className="text-caption text-muted">{note}</span> : null}
      </div>
    </div>
  );
}

function AppTagRow({ tag }: { tag: AppTag }) {
  const t = useT();
  return (
    <div className={ROW}>
      <span className="break-words text-muted"><UntrustedText text={tag.name} /></span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="break-all font-mono text-foreground"><UntrustedText text={tag.value} /></span>
        {tag.unusual ? (
          <span className="text-caption">
            <span className="font-semibold text-warning">{t("approval.tagUnusualValue")}</span>
            <span className="text-muted">
              {" · "}
              {t("approval.tagExpected", { value: tag.unusual.expected })}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
