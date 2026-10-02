/**
 * The two Search Console API calls gsc makes (network).
 *
 * References (read 2026-10-02):
 * - https://developers.google.com/webmaster-tools/v1/sites/list
 * - https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 * - https://developers.google.com/webmaster-tools/limits
 */

import { exchange, type Sleep } from "./http.js";
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

async function call(url: string, init: RequestInit, token: string, fetchFn: typeof fetch, sleep?: Sleep): Promise<unknown> {
  const res = await exchange(
    url,
    { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) } },
    fetchFn,
    sleep,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.text.slice(0, 400)}${hint(res.status, res.text)}`);
  return JSON.parse(res.text) as unknown;
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
  sleep?: Sleep,
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
