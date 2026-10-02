/**
 * The pure part of gsc: dates, the reporting window, site resolution and
 * turning API rows into numbers. Nothing here touches the network.
 */

import type { DimensionFilter, QueryResponse, QueryRow } from "./api.js";
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
  /**
   * "final": ends on the last day of complete data. "fresh": ends today (PT)
   * and includes preliminary data. "fixed": the range was given with
   * --start/--end.
   */
  mode: "final" | "fresh" | "fixed";
  /** First date still being collected, when Search Console reported one. */
  incompleteFrom?: string;
  /**
   * For "final": "reported" when the end comes from Search Console's
   * firstIncompleteDate, "assumed" when Search Console did not report one and
   * the range ends yesterday (PT), whose newest days may still be incomplete.
   */
  boundary?: "reported" | "assumed";
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
 * Final mode ends the day before `firstIncompleteDate`. Days without data are
 * left out of date-grouped rows, so the newest row says nothing about where
 * complete data ends; when Search Console reports no incomplete date, the
 * window ends yesterday (PT) and is marked `boundary: "assumed"`.
 * Fresh mode always ends today (PT).
 */
export function chooseWindow(probe: QueryResponse, days: number, today: string, fresh: boolean): Window {
  const incompleteFrom = probe.metadata?.firstIncompleteDate;
  let end: string;
  let boundary: Window["boundary"];
  if (fresh) {
    end = today;
  } else if (incompleteFrom) {
    end = addDays(incompleteFrom, -1);
    boundary = "reported";
  } else {
    end = addDays(today, -1);
    boundary = "assumed";
  }
  if (end > today) end = today;
  return {
    start: addDays(end, -(days - 1)),
    end,
    mode: fresh ? "fresh" : "final",
    ...(incompleteFrom ? { incompleteFrom } : {}),
    ...(boundary ? { boundary } : {}),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A valid calendar date in YYYY-MM-DD form. */
export function isDate(value: string): boolean {
  return DATE_RE.test(value) && addDays(value, 0) === value;
}

/** A window given explicitly with --start and --end (both inclusive, PT dates). */
export function fixedWindow(start: string, end: string, today: string): Window {
  if (!isDate(start) || !isDate(end)) throw new Error("--start and --end must be dates in YYYY-MM-DD form");
  if (start > end) throw new Error("--start must not be after --end");
  if (end > today) throw new Error(`--end ${end} is in the future (today is ${today} in Pacific Time)`);
  return { start, end, mode: "fixed" };
}

/** Number of days in a window, inclusive. */
export function windowDays(w: Window): number {
  return datesBetween(w.start, w.end).length;
}

/** The window of the same length that ends the day before `w` starts, for --compare. */
export function previousWindow(w: Window): Window {
  const len = windowDays(w);
  const end = addDays(w.start, -1);
  return { start: addDays(end, -(len - 1)), end, mode: w.mode === "fixed" ? "fixed" : "final" };
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

/** What a --site argument resolved to: a property, and optionally a host to narrow it to. */
export interface Target {
  site: Site;
  /**
   * Set when the argument was a subdomain covered by a Domain property: the
   * report is that property filtered to pages on this host.
   */
  host?: string;
}

function bareHost(input: string): string | undefined {
  // A bare host has no scheme, no "sc-domain:", no path.
  return /^[a-z0-9.-]+$/i.test(input) && input.includes(".") ? input.toLowerCase() : undefined;
}

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

/**
 * Find the property a user means.
 *
 * - An exact siteUrl, or a URL that normalizes to one ("https://example.com"
 *   for "https://example.com/"), is used as is. A URL or "sc-domain:" that
 *   matches nothing is an error: a different property would cover a
 *   different scope.
 * - A bare host ("example.com") matches its Domain property
 *   ("sc-domain:example.com") or a URL-prefix property at the root of that
 *   host. Several matches are an error that lists them.
 * - A bare subdomain covered by a Domain property ("blog.example.com" under
 *   "sc-domain:example.com") resolves to that property narrowed to pages on
 *   the subdomain, and says so.
 */
export function resolveSite(input: string, sites: Site[]): Target {
  const wanted = input.trim();
  const known = sites.map((s) => s.siteUrl).join(", ") || "none";
  const exact = sites.find((s) => s.siteUrl === wanted || sameUrl(s.siteUrl, wanted));
  if (exact) return { site: exact };
  const host = bareHost(wanted);
  if (!host) throw new Error(`no Search Console property is exactly "${input}" (visible: ${known})`);

  const matches = sites.filter((s) => {
    if (s.siteUrl.startsWith("sc-domain:")) return s.siteUrl.slice("sc-domain:".length).toLowerCase() === host;
    try {
      const u = new URL(s.siteUrl);
      return u.host.toLowerCase() === host && u.pathname === "/";
    } catch {
      return false;
    }
  });
  if (matches.length === 1) return { site: matches[0]! };
  if (matches.length > 1) {
    throw new Error(`"${input}" matches more than one property: ${matches.map((m) => m.siteUrl).join(", ")}; pass one exactly`);
  }
  // The longest Domain property that covers this host, e.g. sc-domain:example.com for blog.example.com.
  const covering = sites
    .filter((s) => s.siteUrl.startsWith("sc-domain:") && host.endsWith("." + s.siteUrl.slice("sc-domain:".length).toLowerCase()))
    .sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0];
  if (covering) return { site: covering, host };
  throw new Error(`no Search Console property matches "${input}" (visible: ${known})`);
}

/** A page filter that keeps only pages on `host` (http or https). */
export function hostFilter(host: string): DimensionFilter {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { dimension: "page", operator: "includingRegex", expression: `^https?://${escaped}(/|$)` };
}
