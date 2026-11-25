import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SHEET_EASING, useUndockPull } from "./useUndockPull";

/** Scroll distance (px) past which the header collapses to its compact form. */
const HEADER_COLLAPSE_THRESHOLD_PX = 24;

/**
 * Header fade duration (ms) — also drives how long the tokens/activity
 * section waits before it detaches and floats to the top, so the two
 * motions read as sequential (fade, then float) rather than overlapping.
 * Kept as one constant so the JS delay and the CSS `duration-300` on the
 * header's opacity transition can't drift out of sync.
 */
const HEADER_FADE_DURATION_MS = 300;

/**
 * Resting `top` (px) for the docked tokens/activity section — matches the
 * pinned account-pill/settings row's rendered height (`top-16` below),
 * kept as one constant so the Tailwind class and the slide-in offset math
 * can't drift out of sync.
 */
const LIST_DOCK_TOP_PX = 64;

/** The undock slide: a little quicker than the dock (320ms in theme.css), since leaving is faster than arriving. */
const LIST_UNDOCK_DURATION_MS = 280;


/**
 * The home screen's scroll choreography: the header collapses once the window scrolls past it, the
 * tokens/activity section docks under the pinned row and undocks with a slide. `onReset` runs when
 * the header expands again after a collapse.
 */
export function useListDock(onReset: () => void) {
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [listDocked, setListDocked] = useState(false);
  /** The top bar's summary stays mounted while it fades out, then leaves so its figures aren't on the page twice. */
  const [summaryLingers, setSummaryLingers] = useState(false);
  const collapseRafRef = useRef<number | null>(null);
  const listSectionRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const listDockOffsetRef = useRef(0);
  const listDockedRef = useRef(false);
  /** Where the docked list's top sits in the viewport: under the pinned row, which a phone moves down by its status bar. */
  const dockTop = () => (headerRef.current?.getBoundingClientRect().top ?? 0) + LIST_DOCK_TOP_PX;

  /**
   * Chrome renders the popup as one continuously-growing box past its
   * 600px ceiling (see theme.css's `[data-layout="popup"]` comment) —
   * there's no inner scroll container, so `window.scrollY` is the only
   * scroll position that exists here. Fades the header (chart,
   * actions) once scrolled down past it, and un-fades on scrolling back up
   * to the top rather than on scroll direction generally — matching the
   * reference apps this is feature-matched against, where the compact
   * header state tracks "am I still at the top", not "did the last
   * gesture go up or down". The boolean flip itself is deferred to a
   * `requestAnimationFrame` (via a ref, not state) so a burst of scroll
   * events triggers at most one state update per frame instead of one per
   * event.
   */
  useEffect(() => {
    const handleScroll = () => {
      if (collapseRafRef.current !== null) return;
      collapseRafRef.current = requestAnimationFrame(() => {
        collapseRafRef.current = null;
        const collapsed = window.scrollY > HEADER_COLLAPSE_THRESHOLD_PX;
        setHeaderCollapsed(collapsed);
        // A scroll that carries the list up to its docked place docks it there and then, rather than letting it
        // run on under the header and drop back down once the fade is over.
        const top = listSectionRef.current?.getBoundingClientRect().top;
        if (collapsed && !listDockedRef.current && top !== undefined && top <= dockTop() + 0.5) {
          listDockOffsetRef.current = 0;
          listDockedRef.current = true;
          setListDocked(true);
        }
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (collapseRafRef.current !== null) cancelAnimationFrame(collapseRafRef.current);
    };
  }, []);

  /**
   * Once the header has fully faded out, the tokens/activity section
   * detaches from document flow (`position: fixed`) and slides up to sit
   * flush under the account-pill/settings row — "floating" over the
   * now-invisible header rather than the header itself shrinking. Docking
   * is deferred until the fade transition ends (`HEADER_FADE_DURATION_MS`)
   * so the two motions read as sequential instead of overlapping, and
   * un-docks immediately on scrolling back up so the section returns to
   * flow before the header starts fading back in. The measured offset is
   * relative to the docked resting position (`LIST_DOCK_TOP_PX`, where
   * `top` lands once fixed), not the viewport top, so the slide covers
   * exactly the remaining distance instead of overshooting by however
   * tall the pinned header row is.
   */
  useEffect(() => {
    if (!headerCollapsed) {
      listDockedRef.current = false;
      setListDocked(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (listDockedRef.current) return;
      const rect = listSectionRef.current?.getBoundingClientRect();
      // The slide only ever rises to its place: one that starts above it would come down and read as a bounce.
      listDockOffsetRef.current = rect ? Math.max(0, rect.top - dockTop()) : 0;
      listDockedRef.current = true;
      setListDocked(true);
    }, HEADER_FADE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [headerCollapsed]);

  /**
   * Undocking drops the section back into flow, below the header. It starts
   * where it was pinned and slides down to that place, uncovering the
   * header as it fades back in, rather than jumping there.
   */
  const pulledBy = useUndockPull({
    docked: listDocked,
    section: listSectionRef,
    header: headerRef,
    onUndock: () => window.scrollTo({ top: 0, behavior: "auto" }),
  });
  const wasDockedRef = useRef(false);
  useLayoutEffect(() => {
    const was = wasDockedRef.current;
    wasDockedRef.current = listDocked;
    const section = listSectionRef.current;
    if (!was || listDocked || !section) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const from = dockTop() + pulledBy.current - section.getBoundingClientRect().top;
    if (from >= 0) return;
    const slide = section.animate?.([{ transform: `translateY(${from}px)` }, { transform: "none" }], {
      duration: LIST_UNDOCK_DURATION_MS,
      easing: SHEET_EASING,
    });
    if (!slide) return;
    section.dataset.sliding = "";
    const settled = () => delete section.dataset.sliding;
    slide.onfinish = settled;
    slide.oncancel = settled;
  }, [listDocked, pulledBy]);

  /**
   * Back at the top, the home screen shows Tokens again, with the hidden
   * tokens disclosure collapsed. Only an expand after a collapse counts, so
   * a remount on a tab the caller restored (returning from a detail screen)
   * keeps that tab.
   */
  const wasCollapsedRef = useRef(false);
  useEffect(() => {
    if (headerCollapsed) {
      wasCollapsedRef.current = true;
      setSummaryLingers(true);
      return;
    }
    if (!wasCollapsedRef.current) return;
    wasCollapsedRef.current = false;
    window.setTimeout(() => setSummaryLingers(false), HEADER_FADE_DURATION_MS);
    onReset();
    // onReset is deliberately left out: only the collapse flip should reset the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerCollapsed]);

  /**
   * Scrolls the window until the list section reaches its docked position,
   * so the header fades, the section docks, and the whole list has the
   * popup to itself. Once docked, the section scrolls on its own, so this
   * just brings that inner list back to its top. Shared by tab switches and
   * by expanding the hidden-tokens disclosure, which both want the list in
   * full view rather than scrolled to wherever the click happened.
   */
  const scrollListToDockedTop = (instant = false) => {
    const section = listSectionRef.current;
    if (!section) return;
    const behavior: ScrollBehavior =
      instant || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (listDocked) {
      section.scrollTo?.({ top: 0, behavior });
      return;
    }
    const top = window.scrollY + section.getBoundingClientRect().top - dockTop();
    window.scrollTo({ top: Math.max(top, HEADER_COLLAPSE_THRESHOLD_PX + 1), behavior });
  };

  /** Scrolling to the top un-collapses the header, which un-docks the list and fades the chart back in. */
  const returnHome = () => {
    const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    listSectionRef.current?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0, behavior });
  };

  return { headerCollapsed, listDocked, summaryLingers, listSectionRef, headerRef, listDockOffsetRef, scrollListToDockedTop, returnHome };
}
