/**
 * Putting the queries together for one site or for every site. The query
 * function is injected, so this runs in tests without the network.
 */

import type { QueryBody, QueryResponse } from "./api.js";
import { chooseWindow, dailyOf, fetchSizeFor, probeBody, rankedOf, totalsOf, type Window } from "./report.js";
import type { Metrics, Site } from "./types.js";

export type Query = (siteUrl: string, body: QueryBody) => Promise<QueryResponse>;

export interface ReportOptions {
  days: number;
  /** Include preliminary data up to today (PT) instead of stopping at the last complete day. */
  fresh: boolean;
  /** Also list the top n queries by clicks. */
  queries?: number;
  /** Also list the top n pages by clicks. */
  pages?: number;
}

export interface SiteReport {
  siteUrl: string;
  window: Window;
  totals: Metrics;
  daily: { date: string; metrics: Metrics }[];
  queries?: { key: string; metrics: Metrics }[];
  pages?: { key: string; metrics: Metrics }[];
}

export interface AllRow {
  site: Site;
  window?: Window;
  totals?: Metrics;
  error?: string;
}

/** The window for a site: one probe with fresh data to learn where complete data ends. */
export async function windowFor(siteUrl: string, opts: ReportOptions, today: string, query: Query): Promise<Window> {
  const probe = await query(siteUrl, probeBody(opts.days, today));
  return chooseWindow(probe, opts.days, today, opts.fresh);
}

function rangeBody(window: Window, fresh: boolean, extra: Partial<QueryBody> = {}): QueryBody {
  return {
    startDate: window.start,
    endDate: window.end,
    dataState: fresh ? "all" : "final",
    ...extra,
  };
}

/** Totals, a daily series and optional top queries and pages for one site. */
export async function siteReport(siteUrl: string, opts: ReportOptions, today: string, query: Query): Promise<SiteReport> {
  const window = await windowFor(siteUrl, opts, today, query);
  // With no dimensions the single row is the property's total for the range.
  const [totals, daily, queries, pages] = await Promise.all([
    query(siteUrl, rangeBody(window, opts.fresh)),
    query(siteUrl, rangeBody(window, opts.fresh, { dimensions: ["date"] })),
    opts.queries
      ? query(siteUrl, rangeBody(window, opts.fresh, { dimensions: ["query"], rowLimit: fetchSizeFor(opts.queries) }))
      : undefined,
    opts.pages
      ? query(siteUrl, rangeBody(window, opts.fresh, { dimensions: ["page"], rowLimit: fetchSizeFor(opts.pages) }))
      : undefined,
  ]);
  return {
    siteUrl,
    window,
    totals: totalsOf(totals),
    daily: dailyOf(daily, window),
    ...(queries ? { queries: rankedOf(queries, opts.queries) } : {}),
    ...(pages ? { pages: rankedOf(pages, opts.pages) } : {}),
  };
}

/** How many sites are queried at once by `allReports`. */
const CONCURRENCY = 4;

/**
 * Totals for every site, in the order given. Each site gets its own window
 * (complete data can end on different days). A site that fails records its
 * error and does not stop the others.
 */
export async function allReports(sites: Site[], opts: ReportOptions, today: string, query: Query): Promise<AllRow[]> {
  const out: AllRow[] = new Array(sites.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < sites.length) {
      const i = next++;
      const site = sites[i]!;
      try {
        const window = await windowFor(site.siteUrl, opts, today, query);
        const totals = totalsOf(await query(site.siteUrl, rangeBody(window, opts.fresh)));
        out[i] = { site, window, totals };
      } catch (err) {
        out[i] = { site, error: (err as Error).message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, worker));
  return out;
}
