import type { ReactNode } from "react";
import { Drawer } from "vaul";

export interface SheetProps {
  open: boolean;
  /** Called with `false` when the user swipes it down, taps the backdrop or presses Escape. Not called when `open` changes. */
  onOpenChange: (open: boolean) => void;
  /** Screen readers announce this; it isn't drawn. */
  label: string;
  /**
   * Where the sheet mounts. It must sit inside the layout root, because a
   * portal in `document.body` is outside `[data-layout="phone"]` and loses
   * its styles.
   */
  container: HTMLElement | null;
  children: ReactNode;
}

/** A bottom sheet over the current screen. */
export function Sheet({ open, onOpenChange, label, container, children }: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal container={container}>
        {/* `contents` keeps the layout root's rule for its direct children (width, max-width) off the fixed layers. */}
        <div className="contents">
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Drawer.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[calc(100dvh-var(--safe-top,0px)-1rem)] w-full max-w-(--content-max) flex-col overflow-hidden rounded-t-2xl bg-background pb-[var(--safe-bottom,0px)] text-foreground outline-none"
          >
            <Drawer.Title className="sr-only">{label}</Drawer.Title>
            <div aria-hidden className="mx-auto mt-2 h-1 w-9 flex-shrink-0 rounded-full bg-line" />
            {/* The scroller is inside the capped, clipped sheet so tall content scrolls instead of being cut off; the grabber stays put. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </Drawer.Content>
        </div>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
