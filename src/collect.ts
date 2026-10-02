/**
 * Putting the queries together for one site or for every site. The query
 * function is injected, so this runs in tests without the network.
 */

import type { QueryBody, QueryResponse } from "./api.js";
import {
  NO_QUERY_TYPES,
  chooseWindow,
  dailyOf,
  fetchSizeFor,
  hostFilter,
  previousWindow,
  probeBody,
  rankedOf,
  totalsOf,
  type Window,
} from "./report.js";
import type { Metrics, Site } from "./types.js";

export type Query = (siteUrl: string, body: QueryBody) => Promise<QueryResponse>;

export interface ReportOptions {
  /** Days to report when no fixed window is given. */
  days: number;
  /** Include preliminary data up to today (PT) instead of stopping at the last complete day. */
  fresh: boolean;
  /** A fixed window (--start/--end) instead of one ending on the last complete day. */
  fixed?: Window;
  /** Also report the window of the same length just before. */
  compare?: boolean;
  /** Search type (web, image, video, news, discover, googleNews); the API's default is web. */
  type?: string;
  /** Narrow a Domain property to pages on this host. */
  host?: string;
  /** Also list the top n queries by clicks. */
  queries?: number;
  /** Also list the top n pages by clicks. */
  pages?: number;
}

/** How a top-n list was fetched: rows asked for and rows Search Console returned. */
export interface TopFetch {
  requested: number;
  returned: number;
}

export interface SiteReport {
  siteUrl: string;
  host?: string;
  type: string;
  window: Window;
  totals: Metrics;
  /** How Search Console aggregated the totals ("byProperty" or "byPage"). */
  aggregation?: string;
  previous?: { window: Window; totals: Metrics };
  daily: { date: string; metrics: Metrics }[];
  queries?: { key: string; metrics: Metrics }[];
  pages?: { key: string; metrics: Metrics }[];
  /** For each top-n list: when `returned` equals `requested`, more rows may exist beyond them. */
  fetched?: { queries?: TopFetch; pages?: TopFetch };
}

export interface AllRow {
  site: Site;
  window?: Window;
  totals?: Metrics;
  aggregation?: string;
  previous?: { window: Window; totals: Metrics };
  error?: string;
}

/** Search type and filters shared by every query of a report. */
function scope(opts: ReportOptions): Partial<QueryBody> {
  return {
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.host ? { dimensionFilterGroups: [{ groupType: "and" as const, filters: [hostFilter(opts.host)] }] } : {}),
  };
}

/**
 * The window for a site. A fixed window is used as given; otherwise one probe
 * with fresh data, in the same search type and scope, learns where complete
 * data ends.
 */
export async function windowFor(siteUrl: string, opts: ReportOptions, today: string, query: Query): Promise<Window> {
  if (opts.fixed && !opts.fresh) return opts.fixed;
  const probe = await query(siteUrl, { ...probeBody(today), ...scope(opts) });
  if (opts.fixed) {
    // A fixed range read with preliminary data: keep the range, record where
    // preliminary data starts.
    const incompleteFrom = probe.metadata?.firstIncompleteDate;
    return { ...opts.fixed, ...(incompleteFrom ? { incompleteFrom } : {}) };
  }
  return chooseWindow(probe, opts.days, today, opts.fresh);
}

function rangeBody(window: Window, opts: ReportOptions, extra: Partial<QueryBody> = {}): QueryBody {
  return {
    startDate: window.start,
    endDate: window.end,
    dataState: window.dataState,
    ...scope(opts),
    ...extra,
  };
}

async function previousTotals(siteUrl: string, window: Window, opts: ReportOptions, query: Query) {
  if (!opts.compare) return undefined;
  const prev = previousWindow(window);
  return { window: prev, totals: totalsOf(await query(siteUrl, rangeBody(prev, opts))) };
}

/** Totals, a daily series and optional top queries, pages and comparison for one site. */
export async function siteReport(siteUrl: string, opts: ReportOptions, today: string, query: Query): Promise<SiteReport> {
  if (opts.queries && opts.type && NO_QUERY_TYPES.has(opts.type)) {
    throw new Error(`Search Console cannot group ${opts.type} data by query; drop --queries (--pages works)`);
  }
  const window = await windowFor(siteUrl, opts, today, query);
  // With no dimensions the single row is the property's total for the range.
  const [totals, daily, queries, pages, previous] = await Promise.all([
    query(siteUrl, rangeBody(window, opts)),
    query(siteUrl, rangeBody(window, opts, { dimensions: ["date"] })),
    opts.queries
      ? query(siteUrl, rangeBody(window, opts, { dimensions: ["query"], rowLimit: fetchSizeFor(opts.queries) }))
      : undefined,
    opts.pages
      ? query(siteUrl, rangeBody(window, opts, { dimensions: ["page"], rowLimit: fetchSizeFor(opts.pages) }))
      : undefined,
    previousTotals(siteUrl, window, opts, query),
  ]);
  return {
    siteUrl,
    ...(opts.host ? { host: opts.host } : {}),
    type: opts.type ?? "web",
    window,
    totals: totalsOf(totals),
    ...(totals.responseAggregationType ? { aggregation: totals.responseAggregationType } : {}),
    ...(previous ? { previous } : {}),
    daily: dailyOf(daily, window),
    ...(queries ? { queries: rankedOf(queries, opts.queries) } : {}),
    ...(pages ? { pages: rankedOf(pages, opts.pages) } : {}),
    ...(queries || pages
      ? {
          fetched: {
            ...(queries && opts.queries
              ? { queries: { requested: fetchSizeFor(opts.queries), returned: queries.rows?.length ?? 0 } }
              : {}),
            ...(pages && opts.pages ? { pages: { requested: fetchSizeFor(opts.pages), returned: pages.rows?.length ?? 0 } } : {}),
          },
        }
      : {}),
  };
}

/** How many sites are queried at once by `allReports`. */
const CONCURRENCY = 4;

/**
 * Totals for every site, in the order given. Without a fixed window each site
 * gets its own (complete data can end on different days). A site that fails
 * records its error and does not stop the others.
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
        const [totals, previous] = await Promise.all([
          query(site.siteUrl, rangeBody(window, opts)),
          previousTotals(site.siteUrl, window, opts, query),
        ]);
        out[i] = {
          site,
          window,
          totals: totalsOf(totals),
          ...(totals.responseAggregationType ? { aggregation: totals.responseAggregationType } : {}),
          ...(previous ? { previous } : {}),
        };
      } catch (err) {
        out[i] = { site, error: (err as Error).message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, worker));
  return out;
}
