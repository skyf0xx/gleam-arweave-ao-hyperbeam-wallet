import { useMemo, useState } from "react";
import { useLocale, useT } from "../../../i18n";
import { siteHost } from "./address";
import { dayOf, groupHistory, matchHistory, trailText, type BrowserVisit, type HistoryRow } from "./history";
import { SiteAvatar } from "./StartScreen";
import { useVisitTime } from "./useVisitTime";

/**
 * Every page opened, newest first, by day. Pages on one site in a row fold
 * into one row that opens to list them. A title is the page's own, so it
 * sits above the host it came from, never in place of it.
 */
export function HistoryScreen({ history, onOpen }: { history: readonly BrowserVisit[]; onOpen: (url: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const visitTime = useVisitTime();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const days = useMemo(() => groupHistory(matchHistory(history, query)), [history, query]);
  const dayName = useMemo(() => {
    const date = new Intl.DateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric" });
    return (start: number) => {
      const day = dayOf(start, Date.now());
      return day === "today" ? t("browser.today") : day === "yesterday" ? t("browser.yesterday") : date.format(start);
    };
  }, [locale, t]);

  const toggle = (key: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const renderRow = (row: HistoryRow) => {
    if (row.kind === "page") {
      return <PageRow key={`${row.visit.at}:${row.visit.url}`} visit={row.visit} time={visitTime(row.visit.at)} onOpen={onOpen} />;
    }
    const host = siteHost(row.origin)?.host ?? row.origin;
    const expanded = open.has(row.key);
    const newest = row.visits[0];
    return (
      <div key={row.key} className="flex flex-col">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => toggle(row.key)}
          className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl py-2 text-left active:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
        >
          <SiteAvatar host={host} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body font-semibold text-foreground">{host}</span>
            <span className="text-caption text-muted">{t("browser.pageCount", { count: String(row.visits.length) })}</span>
          </span>
          {newest ? <span className="flex-shrink-0 text-caption text-muted">{visitTime(newest.at)}</span> : null}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={expanded ? "flex-shrink-0 rotate-90 text-muted" : "flex-shrink-0 text-muted"}
          >
            <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {expanded ? (
          <div className="flex flex-col pl-[52px]">
            {row.visits.map((visit) => (
              <button
                key={`${visit.at}:${visit.url}`}
                type="button"
                onClick={() => onOpen(visit.url)}
                className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl py-1.5 text-left active:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-label text-foreground">
                    {visit.title ? <bdi>{visit.title}</bdi> : trailText(visit.url) || t("browser.homePage")}
                  </span>
                  {visit.title ? (
                    <span className="truncate text-caption text-muted">{trailText(visit.url) || t("browser.homePage")}</span>
                  ) : null}
                </span>
                <span className="flex-shrink-0 text-caption text-muted">{visitTime(visit.at)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 px-5 pb-6 pt-1">
      <input
        type="search"
        aria-label={t("browser.searchHistory")}
        placeholder={t("browser.searchHistory")}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-w-0 rounded-xl bg-mist px-3.5 py-2.5 text-body text-foreground placeholder:text-faint focus:outline focus:outline-2 focus:outline-foreground"
      />
      {days.length === 0 ? (
        <p className="py-4 text-label text-muted">{history.length === 0 ? t("browser.noHistory") : t("browser.noHistoryMatch")}</p>
      ) : (
        days.map((day) => (
          <section key={day.start} aria-label={dayName(day.start)} className="flex flex-col">
            <h2 className="pb-1 text-label font-semibold uppercase tracking-[0.04em] text-muted">{dayName(day.start)}</h2>
            {day.rows.map(renderRow)}
          </section>
        ))
      )}
    </div>
  );
}

function PageRow({ visit, time, onOpen }: { visit: BrowserVisit; time: string; onOpen: (url: string) => void }) {
  const host = siteHost(visit.url)?.host ?? visit.url;
  const trail = trailText(visit.url);
  return (
    <button
      type="button"
      onClick={() => onOpen(visit.url)}
      className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl py-2 text-left active:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
    >
      <SiteAvatar host={host} />
      <span className="flex min-w-0 flex-1 flex-col">
        {visit.title ? (
          <span className="truncate text-body text-foreground">
            <bdi>{visit.title}</bdi>
          </span>
        ) : null}
        <span className={visit.title ? "truncate text-caption" : "truncate text-body"}>
          <span className="font-semibold text-foreground">{host}</span>
          {trail ? <span className="text-muted">{` › ${trail}`}</span> : null}
        </span>
      </span>
      <span className="flex-shrink-0 text-caption text-muted">{time}</span>
    </button>
  );
}
