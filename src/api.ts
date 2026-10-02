/**
 * The two Search Console API calls gsc makes (network).
 *
 * References (read 2026-10-02):
 * - https://developers.google.com/webmaster-tools/v1/sites/list
 * - https://developers.google.com/webmaster-tools/v1/searchanalytics/query
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
  responseAggregationType?: string;
  /** Present when fresh data was requested: the first date still being collected. */
  metadata?: { firstIncompleteDate?: string; firstIncompleteHour?: string };
}

/** A searchAnalytics.query request body. */
export interface QueryBody {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  dataState?: "final" | "all";
  type?: string;
}

async function call(url: string, init: RequestInit, token: string, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as unknown;
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
): Promise<QueryResponse> {
  const url = `${BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  try {
    return (await call(
      url,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      token,
      fetchFn,
    )) as QueryResponse;
  } catch (err) {
    throw new Error(`searchAnalytics.query for ${siteUrl} failed (${(err as Error).message})`);
  }
}
