/**
 * The two Search Console API calls gsc makes (network).
 *
 * References (read 2026-10-02):
 * - https://developers.google.com/webmaster-tools/v1/sites/list
 * - https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 * - https://developers.google.com/webmaster-tools/limits
 */

import type { Site } from "./types.js";

const BASE = "https://www.googleapis.com/webmasters/v3";

/** One row of a searchAnalytics.query response. */
export interface QueryRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

/** The slice of a searchAnalytics.query response gsc reads. */
export interface QueryResponse {
  rows?: QueryRow[];
  /** "byProperty" or "byPage": how Search Console aggregated the numbers. */
  responseAggregationType?: string;
  /** Present when fresh data was requested: the first date still being collected. */
  metadata?: { firstIncompleteDate?: string; firstIncompleteHour?: string };
}

/** One filter on a dimension; see the reference for operators (contains, equals, includingRegex, ...). */
export interface DimensionFilter {
  dimension: "country" | "device" | "page" | "query" | "searchAppearance";
  operator: "contains" | "equals" | "notContains" | "notEquals" | "includingRegex" | "excludingRegex";
  expression: string;
}

/** A searchAnalytics.query request body. */
export interface QueryBody {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  dataState?: "final" | "all";
  /** Search type: web (the API's default), image, video, news, discover, googleNews. */
  type?: string;
  dimensionFilterGroups?: { groupType?: "and"; filters: DimensionFilter[] }[];
}

/** How long one request may take. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Extra attempts after a server error (5xx) or a network failure. */
export const RETRIES = 2;

class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 400)}`);
  }
}

/** A hint for errors the user can act on. */
function hint(status: number, body: string): string {
  if (status === 429 || /quota/i.test(body)) {
    // The limits page: "If you exceed your quota, wait 15 minutes and try again."
    return " (Search Console quota exceeded: wait 15 minutes and try again)";
  }
  if (status === 403 && /has not been used|is disabled/i.test(body)) {
    return " (enable the Google Search Console API in the key's Google Cloud project)";
  }
  if (status === 403) {
    return " (add the service account's email as a user of this property in Search Console)";
  }
  return "";
}

async function call(
  url: string,
  init: RequestInit,
  token: string,
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(url, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure or timeout: retry a couple of times, then give up.
      if (attempt < RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`request failed: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as unknown;
    // Server errors are worth another try; client errors (auth, permission,
    // quota, bad request) are not, since the same request fails the same way.
    if (res.status >= 500 && attempt < RETRIES) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const err = new HttpError(res.status, text);
    err.message += hint(res.status, text);
    throw err;
  }
}

/** Every Search Console property the credentials can see (sites.list). */
export async function listSites(token: string, fetchFn: typeof fetch = fetch): Promise<Site[]> {
  let body: { siteEntry?: { siteUrl?: string; permissionLevel?: string }[] };
  try {
    body = (await call(`${BASE}/sites`, { method: "GET" }, token, fetchFn)) as typeof body;
  } catch (err) {
    throw new Error(`sites.list failed (${(err as Error).message})`);
  }
  return (body.siteEntry ?? []).map((s) => ({
    siteUrl: s.siteUrl ?? "",
    permissionLevel: s.permissionLevel ?? "",
  }));
}

/** searchAnalytics.query for one property. `siteUrl` is URL-encoded into the path. */
export async function querySite(
  siteUrl: string,
  body: QueryBody,
  token: string,
  fetchFn: typeof fetch = fetch,
  sleep?: (ms: number) => Promise<void>,
): Promise<QueryResponse> {
  const url = `${BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  try {
    return (await call(
      url,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      token,
      fetchFn,
      sleep,
    )) as QueryResponse;
  } catch (err) {
    throw new Error(`searchAnalytics.query for ${siteUrl} failed (${(err as Error).message})`);
  }
}
