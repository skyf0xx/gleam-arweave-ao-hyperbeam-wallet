import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { collectibleKind, type Collectible, type CollectibleKind } from "@gleam/core";
import { CollectibleThumbnail, EmptyState } from "@gleam/ui/src/components/wallet/index.ts";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { useT } from "../../../i18n";

export interface CollectiblesGalleryProps {
  items: Collectible[] | undefined;
  loading: boolean;
  onOpen: (collectible: Collectible) => void;
}

/** The gap between large pieces, matching `gap-4` on the stage. */
const STAGE_GAP_PX = 16;

type Translate = ReturnType<typeof useT>;

/** What the tile says when it has no preview; images and videos have one. */
export function collectibleKindLabel(t: Translate, contentType: string | undefined): string | undefined {
  switch (collectibleKind(contentType)) {
    case "audio":
      return t("collectibles.kindAudio");
    case "web":
      return t("collectibles.kindWeb");
    case "document":
      return t("collectibles.kindDocument");
    case "file":
      return t("collectibles.kindFile");
    default:
      return undefined;
  }
}

type GalleryGroup = CollectibleKind | "name";

const GROUP_ORDER: readonly GalleryGroup[] = ["image", "video", "audio", "web", "document", "file", "name"];

function groupOf(item: Collectible): GalleryGroup {
  return item.permawebName ? "name" : collectibleKind(item.contentType);
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Grouped by kind in `GROUP_ORDER`, A–Z inside each group; a name sorts by its label, without the @. */
export function sortForGallery(items: readonly Collectible[]): Collectible[] {
  const sortName = (item: Collectible) => item.permawebName?.label ?? item.name;
  return [...items].sort(
    (a, b) =>
      GROUP_ORDER.indexOf(groupOf(a)) - GROUP_ORDER.indexOf(groupOf(b)) ||
      byName.compare(sortName(a), sortName(b)) ||
      a.id.localeCompare(b.id),
  );
}

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
 * A strip of thumbnails over one large piece with its name, in
 * `sortForGallery` order. Tapping the large piece opens its detail
 * screen. The arrows show only where a pointer can hover; on touch the
 * large pieces sit side by side in a snap scroller, so a swipe follows
 * the finger and settles on the next piece with the browser's own
 * momentum. Only the piece in view and its neighbours load their media.
 */
export function CollectiblesGallery({ items, loading, onOpen }: CollectiblesGalleryProps) {
  const t = useT();
  const [shownId, setShownId] = useState(lastShownId);
  const strip = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  /** Where an arrow, thumbnail or key sent the stage; the pieces it slides past on the way aren't selected. */
  const heading = useRef<number | null>(null);

  const list = useMemo(() => sortForGallery(items ?? []), [items]);
  const found = list.findIndex((item) => item.id === shownId);
  const index = found === -1 ? 0 : found;
  const shown = list[index];

  const stageStep = () => (stage.current ? stage.current.clientWidth + STAGE_GAP_PX : 0);

  const select = (next: number) => {
    const target = list[next];
    if (!target) return;
    lastShownId = target.id;
    setShownId(target.id);
  };

  /** Arrows, thumbnails and keys move the stage; the scroll then selects the piece. A long jump cuts rather than sliding past every piece between. */
  const show = (next: number) => {
    const clamped = Math.max(0, Math.min(list.length - 1, next));
    if (!list[clamped]) return;
    select(clamped);
    heading.current = clamped;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    stage.current?.scrollTo?.({
      left: clamped * stageStep(),
      behavior: Math.abs(clamped - index) === 1 && !reduced ? "smooth" : "auto",
    });
  };

  const onStageScroll = () => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const step = stageStep();
      if (!stage.current || step <= 0) return;
      const next = Math.max(0, Math.min(list.length - 1, Math.round(stage.current.scrollLeft / step)));
      if (heading.current !== null) {
        if (next === heading.current) heading.current = null;
        return;
      }
      if (next !== index) select(next);
    });
  };

  useEffect(() => () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
  }, []);

  // Opens on the remembered piece, and stays on it when the list reloads.
  useLayoutEffect(() => {
    if (stage.current) stage.current.scrollLeft = index * stageStep();
    // Only a new list moves the stage; a scroll already put it where `index` says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

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
        <div className="flex gap-2 phone:order-last">
          {Array.from({ length: 5 }, (_, key) => (
            <div key={key} className="aspect-square w-14 shrink-0 gleam-shimmer rounded-lg" />
          ))}
        </div>
        <div className="aspect-square w-full gleam-shimmer rounded-2xl" />
        <div className="h-[13px] w-[40%] gleam-shimmer rounded-md" />
      </div>
    );
  }
  if (!shown) {
    return <EmptyState message={t("collectibles.empty")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* On a phone the ribbon sits under the piece, where the thumb rests; the extension keeps it on top. */}
      <div className="relative -mx-6 phone:order-last phone:-mx-5">
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
                // A wider gap where one kind ends and the next begins; the groups have no labels.
                position > 0 && groupOf(list[position - 1]!) !== groupOf(item) && "ml-3",
              )}
            >
              <CollectibleThumbnail
                name={item.name}
                imageUrl={item.imageUrl}
                videoUrl={item.videoUrl}
                kind={collectibleKind(item.contentType)}
                nameLabel={item.permawebName?.label}
                decorative
              />
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

      <div
        ref={stage}
        data-testid="collectibles-stage"
        onScroll={onStageScroll}
        onPointerDown={() => (heading.current = null)}
        onWheel={() => (heading.current = null)}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {list.map((item, position) => {
          const current = position === index;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.name}
              aria-hidden={current ? undefined : true}
              tabIndex={current ? undefined : -1}
              onClick={() => onOpen(item)}
              className="block w-full shrink-0 snap-center snap-always rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              {Math.abs(position - index) <= 1 ? (
                <CollectibleThumbnail
                  name={item.name}
                  imageUrl={item.imageUrl}
                  videoUrl={item.videoUrl}
                  play={current}
                  kind={collectibleKind(item.contentType)}
                  kindLabel={collectibleKindLabel(t, item.contentType)}
                  nameLabel={item.permawebName?.label}
                  decorative
                  className="rounded-2xl"
                />
              ) : (
                <div className="aspect-square w-full rounded-2xl bg-mist" />
              )}
            </button>
          );
        })}
      </div>
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
