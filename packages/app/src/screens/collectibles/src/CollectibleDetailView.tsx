import { useLayoutEffect, useRef, useState } from "react";
import { collectibleKind, explorerUrlFor, nameSiteUrl, type Collectible } from "@gleam/core";
import { CollectibleThumbnail } from "@gleam/ui/src/components/wallet/index.ts";
import { useT } from "../../../i18n";
import { collectibleKindLabel } from "./CollectiblesGallery";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { ChangeTargetSheet } from "./ChangeTargetSheet";

export interface CollectibleDetailViewProps {
  collectible: Collectible;
  /** Opens a Permaweb Name's own site; without it the name links to Lunar like any collectible. */
  gatewayUrl?: string;
  onBack: () => void;
  /** The Send button only renders when this is provided. */
  onSend?: (collectible: Collectible) => void;
  /** The Change target button renders for a held, unlisted name when this is provided. */
  onChangeTarget?: (target: string) => void;
  /** Where the Change target sheet mounts. */
  sheetContainer?: HTMLElement | null;
}

export function CollectibleDetailView({
  collectible,
  gatewayUrl,
  onBack,
  onSend,
  onChangeTarget,
  sheetContainer = null,
}: CollectibleDetailViewProps) {
  const t = useT();
  const [changingTarget, setChangingTarget] = useState(false);
  const name = collectible.permawebName;
  const siteUrl = name && gatewayUrl ? nameSiteUrl(name.label, gatewayUrl) : undefined;
  const subtitle = name ? (name.listed ? `${t("collectibles.name")} · ${t("collectibles.listedForSale")}` : t("collectibles.name")) : collectible.collectionName;
  // An escrowed name isn't the wallet's to send until its sale order closes.
  const send = name?.listed ? undefined : onSend;
  const changeTarget = name && !name.listed ? onChangeTarget : undefined;
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("collectibles.detailTitle")} onBack={onBack} />

      <div className="flex flex-1 flex-col gap-4 px-6 phone:px-5 pb-6 phone:pb-0 pt-4">
        <CollectibleThumbnail
          name={collectible.name}
          imageUrl={collectible.imageUrl}
          videoUrl={collectible.videoUrl}
          play
          kind={collectibleKind(collectible.contentType)}
          kindLabel={collectibleKindLabel(t, collectible.contentType)}
          nameLabel={name?.label}
          className="rounded-2xl"
        />

        <div className="flex flex-col gap-0.5 text-center">
          <div className="line-clamp-2 break-words text-h3 font-semibold">
            <h2 className="inline" title={collectible.name}>
              {collectible.name}
            </h2>
            {siteUrl ? (
              <ExternalLink href={siteUrl} label={new URL(siteUrl).host} />
            ) : (
              <ExternalLink
                href={`https://lunar.arweave.net/#/explorer/${encodeURIComponent(collectible.id)}/data`}
                label={t("collectibles.viewOnLunar")}
              />
            )}
          </div>
          {subtitle ? <p className="text-label text-muted">{subtitle}</p> : null}
        </div>

        {name?.target ? (
          <div className="flex flex-col gap-1">
            <span className="text-label text-muted">{t("collectibles.pointsTo")}</span>
            <div className="flex items-center gap-1">
              <span dir="ltr" className="min-w-0 flex-1 break-all font-mono text-caption leading-relaxed text-foreground">
                {name.target}
              </span>
              <ExternalLink href={explorerUrlFor(name.target)} label={t("collectibles.viewOnLunar")} />
            </div>
          </div>
        ) : null}

        {collectible.description ? <CollectibleDescription key={collectible.id} text={collectible.description} /> : null}

        {send || changeTarget ? (
          <ScreenFooter className="gap-2.5 pt-2">
            {send ? <Button onClick={() => send(collectible)}>{t("collectibles.send")}</Button> : null}
            {changeTarget ? (
              <Button variant="secondary" onClick={() => setChangingTarget(true)}>
                {t("collectibles.changeTarget")}
              </Button>
            ) : null}
          </ScreenFooter>
        ) : null}
        {changeTarget ? (
          <ChangeTargetSheet
            open={changingTarget}
            onOpenChange={setChangingTarget}
            container={sheetContainer}
            current={name?.target}
            onReview={(target) => {
              setChangingTarget(false);
              changeTarget(target);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Three lines, with a toggle only when the text runs past them. */
function CollectibleDescription({ text }: { text: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const element = body.current;
    if (element && !expanded) setClipped(element.scrollHeight > element.clientHeight);
  }, [text, expanded]);

  return (
    <div className="flex flex-col items-start gap-1">
      <p ref={body} className={`whitespace-pre-line break-words text-body text-muted ${expanded ? "" : "line-clamp-3"}`}>
        {text}
      </p>
      {clipped ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="text-label font-medium text-foreground hover:underline"
        >
          {expanded ? t("collectibles.showLess") : t("collectibles.showMore")}
        </button>
      ) : null}
    </div>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="ml-1.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md align-middle text-muted hover:bg-hover hover:text-foreground"
    >
      <ExternalLinkIcon />
    </a>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
