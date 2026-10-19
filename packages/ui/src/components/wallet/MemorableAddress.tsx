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
  /** `confirm` is the last look before signing: larger, with heavier emphasis. */
  tone?: "default" | "confirm";
  className?: string;
}

/**
 * A full address in 4-character chunks, grouped 4 · 4 · 3. The chunks to
 * compare are in full contrast with an amber underline, the rest muted.
 * Groups wrap as whole units, and a copied selection is the raw address
 * text: the gaps are margins, never characters.
 */
export function MemorableAddress({ address, emphasisPick, avatarSvg, tone = "default", className }: MemorableAddressProps) {
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
    <span className={cn("inline-flex min-w-0 items-start gap-2", className)} onCopy={copyRawText}>
      {avatarSvg ? (
        <span aria-hidden="true" className="shrink-0">
          <AccountAvatar svgMarkup={avatarSvg} label="" size={confirm ? 28 : 20} />
        </span>
      ) : null}
      <span
        translate="no"
        className={cn(
          "flex min-w-0 font-mono leading-relaxed",
          // The last look before signing stacks one group per line, so the
          // chunks line up in columns.
          confirm ? "flex-col text-[13px]" : "flex-wrap gap-x-[1ch] text-label",
          avatarSvg && (confirm ? "pt-0.75" : "pt-px"),
        )}
      >
        {groups.map((group) => (
          <span key={group[0]!.index} className="whitespace-nowrap">
            {group.map((chunk, position) => (
              <span
                key={chunk.index}
                className={cn(
                  position > 0 && "ml-[0.4ch]",
                  chunk.emphasized
                    ? cn(
                        "text-foreground underline decoration-emphasis underline-offset-[3px]",
                        confirm ? "font-bold decoration-2" : "font-semibold decoration-[1.5px]",
                      )
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
