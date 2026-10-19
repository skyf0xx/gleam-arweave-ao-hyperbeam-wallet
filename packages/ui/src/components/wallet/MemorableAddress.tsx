import type { ClipboardEvent } from "react";
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
  className?: string;
}

/**
 * A full address as a block of two rows (7 · 4 chunks of 4
 * characters). The block keeps one shape for every address, so the
 * emphasised chunks always sit in the same places and the user learns
 * where to look. They are set on a quiet fill in full contrast; the rest
 * are muted. The avatar carries the colour, so the address stays
 * monochrome. A copied selection is the raw address text: the gaps are
 * padding, never characters.
 */
export function MemorableAddress({
  address,
  emphasisPick,
  avatarSvg,
  tone = "default",
  className,
}: MemorableAddressProps) {
  const confirm = tone === "confirm";
  const groups = chunkAddress(address, emphasisPick);

  const copyRawText = (event: ClipboardEvent<HTMLElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const inside = event.currentTarget.contains(selection.anchorNode) && event.currentTarget.contains(selection.focusNode);
    if (!inside) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selection.toString().replace(/\s+/g, ""));
  };

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-3", className)} onCopy={copyRawText}>
      {avatarSvg ? (
        <span aria-hidden="true" className="shrink-0">
          <AccountAvatar svgMarkup={avatarSvg} label="" size={confirm ? 36 : 28} />
        </span>
      ) : null}
      <span
        translate="no"
        className={cn("flex min-w-0 flex-col text-left font-mono leading-[1.75]", confirm ? "text-[13px]" : "text-label")}
      >
        {groups.map((group) => (
          <span key={group[0]!.index} className="whitespace-nowrap">
            {group.map((chunk) => (
              <span
                key={chunk.index}
                data-emphasized={chunk.emphasized || undefined}
                className={cn(
                  "rounded-[4px] px-[0.35ch]",
                  chunk.emphasized
                    ? cn("bg-foreground/[0.07] text-foreground", confirm ? "font-semibold" : "font-medium")
                    : "text-muted",
                )}
              >
                {chunk.text}
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}
