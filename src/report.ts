/**
 * The pure part of gsc: dates, the reporting window, site resolution and
 * turning API rows into numbers. Nothing here touches the network.
 */

import type { QueryResponse, QueryRow } from "./api.js";
import type { Metrics, Site } from "./types.js";

/**
 * Search Console dates are Pacific Time: the API reference describes
 * startDate and endDate as "YYYY-MM-DD format, in PT time (UTC - 7:00/8:00)".
 */
export const SEARCH_CONSOLE_TIME_ZONE = "America/Los_Angeles";

/** Today's date in Pacific Time, as YYYY-MM-DD. */
export function todayPT(now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SEARCH_CONSOLE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Shift a YYYY-MM-DD date by `n` days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Every date from `start` to `end`, inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** How far back the probe for the latest date looks, beyond the window itself. */
export const PROBE_SLACK_DAYS = 10;

/** The date range a report covers, and how its end was chosen. */
export interface Window {
  start: string;
  end: string;
  /** "final": end is the last day whose data is complete. "fresh": end is today (PT), and data from `incompleteFrom` on is preliminary. */
  mode: "final" | "fresh";
  /** First date still being collected, when Search Console reported one. */
  incompleteFrom?: string;
}

/**
 * The body of the probe that finds where complete data ends. It asks for fresh
 * data (`dataState: "all"`) because only then does the response carry
 * `metadata.firstIncompleteDate`.
 */
export function probeBody(days: number, today: string): { startDate: string; endDate: string; dimensions: string[]; dataState: "all" } {
  return {
    startDate: addDays(today, -(days + PROBE_SLACK_DAYS)),
    endDate: today,
    dimensions: ["date"],
    dataState: "all",
  };
}

/**
 * Pick the window from the probe's response.
 *
 * Final mode ends the day before `firstIncompleteDate`. When Search Console
 * reports no incomplete date, everything returned is complete, so the window
 * ends on the newest date with data, or yesterday (PT) when there is none.
 * Fresh mode always ends today (PT).
 */
export function chooseWindow(probe: QueryResponse, days: number, today: string, fresh: boolean): Window {
  const incompleteFrom = probe.metadata?.firstIncompleteDate;
  let end: string;
  if (fresh) {
    end = today;
  } else if (incompleteFrom) {
    end = addDays(incompleteFrom, -1);
  } else {
    const dates = (probe.rows ?? []).map((r) => r.keys?.[0] ?? "").filter(Boolean).sort();
    end = dates.at(-1) ?? addDays(today, -1);
  }
  if (end > today) end = today;
  return {
    start: addDays(end, -(days - 1)),
    end,
    mode: fresh ? "fresh" : "final",
    ...(incompleteFrom ? { incompleteFrom } : {}),
  };
}

export function metricsOf(row: QueryRow | undefined): Metrics {
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0,
    position: row?.position ?? 0,
  };
}

/** The totals row of a query with no dimensions; zeros when the range has no data. */
export function totalsOf(res: QueryResponse): Metrics {
  return metricsOf(res.rows?.[0]);
}

/**
 * One entry per date in the window. Search Console omits days without data
 * when grouping by date, so those days are filled with zeros here.
 */
export function dailyOf(res: QueryResponse, window: Window): { date: string; metrics: Metrics }[] {
  const byDate = new Map((res.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]));
  return datesBetween(window.start, window.end).map((date) => ({ date, metrics: metricsOf(byDate.get(date)) }));
}

/**
 * How many rows to fetch for a top-n list. The API sorts by clicks and leaves
 * ties "sorted in an arbitrary way", so on a site with few clicks the first n
 * rows would be a random pick; fetching more and re-sorting by impressions
 * as well gives a stable, meaningful top n.
 */
export function fetchSizeFor(n: number): number {
  return Math.min(25_000, Math.max(n, 1_000));
}

/** The top `n` rows keyed by their first dimension, by clicks, then impressions, then key. */
export function rankedOf(res: QueryResponse, n = Infinity): { key: string; metrics: Metrics }[] {
  return (res.rows ?? [])
    .map((r) => ({ key: r.keys?.[0] ?? "", metrics: metricsOf(r) }))
    .sort(
      (a, b) =>
        b.metrics.clicks - a.metrics.clicks ||
        b.metrics.impressions - a.metrics.impressions ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    .slice(0, n);
}

/**
 * Find the property a user means. Exact siteUrl first; then a bare host
 * ("example.com") matches its Domain property ("sc-domain:example.com") or a
 * URL-prefix property on that host. More than one match is an error that
 * lists them.
 */
export function resolveSite(input: string, sites: Site[]): Site {
  const wanted = input.trim();
  const exact = sites.find((s) => s.siteUrl === wanted);
  if (exact) return exact;
  const host = wanted.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const matches = sites.filter((s) => {
    if (s.siteUrl.startsWith("sc-domain:")) return s.siteUrl.slice("sc-domain:".length).toLowerCase() === host;
    try {
      return new URL(s.siteUrl).host.toLowerCase() === host;
    } catch {
      return false;
    }
  });
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`"${input}" matches more than one property: ${matches.map((m) => m.siteUrl).join(", ")}; pass one exactly`);
  }
  const known = sites.map((s) => s.siteUrl).join(", ") || "none";
  throw new Error(`no Search Console property matches "${input}" (visible: ${known})`);
}
