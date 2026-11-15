import { useEffect, useRef, useState } from "react";
import type { Collectible } from "@gleam/core";
import { CollectibleThumbnail, EmptyState, SkeletonTile } from "@gleam/ui/src/components/wallet/index.ts";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { useT } from "../../../i18n";

export interface CollectiblesGalleryProps {
  items: Collectible[] | undefined;
  loading: boolean;
  onOpen: (collectible: Collectible) => void;
}

const SWIPE_PX = 40;

/**
 * The detail screen unmounts this view, so the piece being shown is kept
 * here to bring the member back to it.
 */
let lastShownId: string | undefined;

/** Test hook: forgets the remembered piece. */
export const resetCollectiblesGalleryForTests = () => {
  lastShownId = undefined;
};

const CHEVRON_CLASS =
  "absolute inset-y-0 z-10 hidden w-9 items-center text-foreground disabled:invisible [@media(hover:hover)_and_(pointer:fine)]:flex";

/**
 * A strip of thumbnails over one large piece with its name. Tapping the
 * large piece opens its detail screen. The arrows show only where a
 * pointer can hover; on touch the large piece swipes.
 */
export function CollectiblesGallery({ items, loading, onOpen }: CollectiblesGalleryProps) {
  const t = useT();
  const [shownId, setShownId] = useState(lastShownId);
  const strip = useRef<HTMLDivElement>(null);
  const swipeFrom = useRef<number | null>(null);
  const swiped = useRef(false);

  const list = items ?? [];
  const found = list.findIndex((item) => item.id === shownId);
  const index = found === -1 ? 0 : found;
  const shown = list[index];

  const show = (next: number) => {
    const target = list[Math.max(0, Math.min(list.length - 1, next))];
    if (!target) return;
    lastShownId = target.id;
    setShownId(target.id);
  };

  useEffect(() => {
    const thumb = strip.current?.children[index];
    thumb?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index, list.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      if (event.key === "ArrowLeft") show(index - 1);
      else if (event.key === "ArrowRight") show(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading && items === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {Array.from({ length: 5 }, (_, key) => (
            <div key={key} className="w-14 shrink-0">
              <SkeletonTile />
            </div>
          ))}
        </div>
        <SkeletonTile />
      </div>
    );
  }
  if (!shown) {
    return <EmptyState message={t("collectibles.empty")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative -mx-6 phone:-mx-5">
        <button
          type="button"
          aria-label={t("collectibles.previous")}
          disabled={index === 0}
          onClick={() => show(index - 1)}
          className={cn(CHEVRON_CLASS, "left-0 justify-start bg-linear-to-r from-background from-40% to-transparent pl-1")}
        >
          <Chevron direction="left" />
        </button>
        <div
          ref={strip}
          role="listbox"
          aria-label={t("collectibles.title")}
          className="flex gap-2 overflow-x-auto px-6 phone:px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {list.map((item, position) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={position === index}
              aria-label={item.name}
              onClick={() => show(position)}
              className={cn(
                "w-14 shrink-0 rounded-lg transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
                position === index ? "opacity-100" : "opacity-45 hover:opacity-80",
              )}
            >
              <CollectibleThumbnail name={item.name} imageUrl={item.imageUrl} decorative />
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={t("collectibles.next")}
          disabled={index === list.length - 1}
          onClick={() => show(index + 1)}
          className={cn(CHEVRON_CLASS, "right-0 justify-end bg-linear-to-l from-background from-40% to-transparent pr-1")}
        >
          <Chevron direction="right" />
        </button>
      </div>

      <button
        type="button"
        aria-label={shown.name}
        onPointerDown={(event) => {
          swipeFrom.current = event.clientX;
          swiped.current = false;
        }}
        onPointerUp={(event) => {
          const from = swipeFrom.current;
          swipeFrom.current = null;
          if (from === null || Math.abs(event.clientX - from) < SWIPE_PX) return;
          swiped.current = true;
          show(index + (event.clientX < from ? 1 : -1));
        }}
        onClick={() => {
          if (swiped.current) swiped.current = false;
          else onOpen(shown);
        }}
        className="block w-full touch-pan-y rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        <CollectibleThumbnail key={shown.id} name={shown.name} imageUrl={shown.imageUrl} decorative className="rounded-2xl" />
      </button>
      <p className="truncate text-body font-medium text-foreground">{shown.name}</p>
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d={direction === "left" ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
