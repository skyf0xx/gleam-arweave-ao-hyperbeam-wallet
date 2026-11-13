import type { ClipboardEvent, ReactNode } from "react";
import { chunkAddress } from "@gleam/core";
import { cn } from "../../primitives/cn";
import { AccountAvatar } from "./AccountAvatar";

export interface MemorableAddressProps {
  address: string;
  /** The user's emphasis pick (`addressEmphasisPick`); `null` uses the default middle chunks. */
  emphasisPick: number | null;
  /** Drawn inline before the address when given. */
  avatarSvg?: string;
  /** `confirm` is the last look before signing: a size larger, with heavier emphasis. */
  tone?: "default" | "confirm";
  /** Placed in the grid's next cell, so it sits at the end of the last row. */
  trailing?: ReactNode;
  /** Another address to compare with: chunks that differ from it at the same position are marked. */
  diffAgainst?: string;
  className?: string;
}

/**
 * A full address as a block of 4-character chunks laid out on a grid:
 * two rows (7 · 4) where the space fits seven chunks, three (4 · 4 · 3)
 * where it doesn't. The columns are fixed and the chunks never wrap on
 * their own, so on a given screen the block keeps one shape for every
 * address, the emphasised chunks always sit in the same places and the
 * user learns where to look. They are set on a quiet fill in full contrast; the rest
 * are muted. The avatar carries the colour, so the address stays
 * monochrome. A copied selection is the raw address text: the gaps are
 * padding, never characters.
 */
export function MemorableAddress({
  address,
  emphasisPick,
  avatarSvg,
  tone = "default",
  trailing,
  diffAgainst,
  className,
}: MemorableAddressProps) {
  const confirm = tone === "confirm";
  const chunks = chunkAddress(address, emphasisPick).flat();
  const otherChunks = diffAgainst === undefined ? null : chunkAddress(diffAgainst, emphasisPick).flat();

  const copyRawText = (event: ClipboardEvent<HTMLElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const inside = event.currentTarget.contains(selection.anchorNode) && event.currentTarget.contains(selection.focusNode);
    if (!inside) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selection.toString().replace(/\s+/g, ""));
  };

  return (
    <span className={cn("flex w-full min-w-0 items-center gap-3", className)} onCopy={copyRawText}>
      {avatarSvg ? (
        <span aria-hidden="true" className="shrink-0">
          <AccountAvatar svgMarkup={avatarSvg} label="" size={confirm ? 36 : 28} />
        </span>
      ) : null}
      {/* Seven chunks with their padding are 32.9ch, or 31.5ch with the phone's tighter padding; `ch` here is the address's own font, so the switch follows the type size. */}
      {/* eslint-disable-next-line gleam/type-scale -- 12.5px fits seven chunks on one line at confirm width; the grid below depends on it. */}
      <span className={cn("@container flex min-w-0 flex-1 font-mono [justify-content:inherit]", confirm ? "text-[12.5px]" : "text-label")}>
        <span
          translate="no"
          className="grid min-w-0 grid-cols-[repeat(4,max-content)] text-left leading-[1.75] @[33ch]:grid-cols-[repeat(7,max-content)] phone:@[31.6ch]:grid-cols-[repeat(7,max-content)]"
        >
          {chunks.map((chunk) => (
            <span
              key={chunk.index}
              data-emphasized={chunk.emphasized || undefined}
              className={cn(
                "whitespace-nowrap rounded-[4px] px-[0.35ch] phone:px-[0.25ch]",
                otherChunks && otherChunks[chunk.index]?.text !== chunk.text
                  ? "bg-warning/10 font-semibold text-warning"
                  : chunk.emphasized
                  ? cn("bg-foreground/[0.07] text-foreground", confirm ? "font-semibold" : "font-medium")
                  : "text-muted",
              )}
            >
              {chunk.text}
            </span>
          ))}
          {trailing ? <span className="flex items-center pl-[0.35ch]">{trailing}</span> : null}
        </span>
      </span>
    </span>
  );
}
