import { describe, expect, it } from "vitest";
import { allReports, siteReport, type Query } from "../src/collect.js";
import type { QueryBody } from "../src/api.js";

function fake(calls: { site: string; body: QueryBody }[]): Query {
  return async (site, body) => {
    calls.push({ site, body });
    if (site === "sc-domain:broken.example") throw new Error("searchAnalytics.query failed (HTTP 403)");
    if (body.dataState === "all" && body.dimensions?.[0] === "date" && body.endDate === "2026-10-01") {
      return { rows: [{ keys: ["2026-09-30"], impressions: 5 }], metadata: { firstIncompleteDate: "2026-09-30" } };
    }
    if (!body.dimensions) return { rows: [{ clicks: 2, impressions: 106, ctr: 0.0189, position: 15.6 }] };
    if (body.dimensions[0] === "date") return { rows: [{ keys: ["2026-09-29"], clicks: 2, impressions: 58 }] };
    return { rows: [{ keys: ["kweqoo"], clicks: 2, impressions: 10 }] };
  };
}

describe("siteReport", () => {
  it("probes, then asks for complete data in the chosen window", async () => {
    const calls: { site: string; body: QueryBody }[] = [];
    const r = await siteReport("sc-domain:kweqoo.net", { days: 3, fresh: false, queries: 5 }, "2026-10-01", fake(calls));
    expect(r.window).toMatchObject({ start: "2026-09-27", end: "2026-09-29" });
    expect(r.totals.impressions).toBe(106);
    expect(r.daily.map((d) => d.metrics.impressions)).toEqual([0, 0, 58]);
    expect(r.queries?.[0]?.key).toBe("kweqoo");
    expect(r.pages).toBeUndefined();
    const ranged = calls.slice(1);
    expect(ranged.every((c) => c.body.startDate === "2026-09-27" && c.body.endDate === "2026-09-29")).toBe(true);
    expect(ranged.every((c) => c.body.dataState === "final")).toBe(true);
    // Fetches more than asked so ties on clicks can be broken by impressions.
    expect(ranged.find((c) => c.body.dimensions?.[0] === "query")?.body.rowLimit).toBe(1000);
  });

  it("asks for fresh data in fresh mode", async () => {
    const calls: { site: string; body: QueryBody }[] = [];
    const r = await siteReport("sc-domain:kweqoo.net", { days: 2, fresh: true }, "2026-10-01", fake(calls));
    expect(r.window).toMatchObject({ start: "2026-09-30", end: "2026-10-01", mode: "fresh", dataState: "all", incompleteFrom: "2026-09-30" });
    expect(calls.slice(1).every((c) => c.body.dataState === "all")).toBe(true);
  });
});

describe("allReports", () => {
  it("keeps order and records a failing site without stopping the rest", async () => {
    const sites = [
      { siteUrl: "sc-domain:kweqoo.net", permissionLevel: "siteFullUser" },
      { siteUrl: "sc-domain:broken.example", permissionLevel: "siteFullUser" },
    ];
    const rows = await allReports(sites, { days: 3, fresh: false }, "2026-10-01", fake([]));
    expect(rows[0]?.totals?.impressions).toBe(106);
    expect(rows[0]?.window?.end).toBe("2026-09-29");
    expect(rows[1]?.totals).toBeUndefined();
    expect(rows[1]?.error).toContain("HTTP 403");
  });
});

describe("scope, fixed windows and comparisons", () => {
  it("applies the search type and host filter to every query, probe included", async () => {
    const calls: { site: string; body: QueryBody }[] = [];
    await siteReport(
      "sc-domain:kweqoo.net",
      { days: 3, fresh: false, type: "image", host: "kabuto-zukan.kweqoo.net" },
      "2026-10-01",
      fake(calls),
    );
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      expect(c.body.type).toBe("image");
      expect(c.body.dimensionFilterGroups?.[0]?.filters[0]?.expression).toBe(
        "^https?://kabuto-zukan\\.kweqoo\\.net(:[0-9]+)?(/|$)",
      );
    }
  });

  it("uses a fixed window without probing, and compares against the period before", async () => {
    const calls: { site: string; body: QueryBody }[] = [];
    const r = await siteReport(
      "sc-domain:kweqoo.net",
      { days: 7, fresh: false, compare: true, fixed: { start: "2026-09-01", end: "2026-09-30", mode: "fixed", dataState: "final" } },
      "2026-10-01",
      fake(calls),
    );
    expect(calls.some((c) => c.body.dataState === "all")).toBe(false);
    expect(r.previous?.window).toEqual({ start: "2026-08-02", end: "2026-08-31", mode: "fixed", dataState: "final" });
    expect(calls.some((c) => c.body.startDate === "2026-08-02" && c.body.endDate === "2026-08-31")).toBe(true);
  });
});

describe("round 2", () => {
  it("refuses --queries for Discover and Google News before any request", async () => {
    const calls: { site: string; body: QueryBody }[] = [];
    for (const type of ["discover", "googleNews"]) {
      await expect(
        siteReport("sc-domain:kweqoo.net", { days: 3, fresh: false, type, queries: 5 }, "2026-10-01", fake(calls)),
      ).rejects.toThrow(/cannot group .* by query/);
    }
    expect(calls).toHaveLength(0);
  });

  it("records where preliminary data starts in a fixed range read with --fresh", async () => {
    const calls: { site: string; body: QueryBody }[] = [];
    const r = await siteReport(
      "sc-domain:kweqoo.net",
      { days: 7, fresh: true, fixed: { start: "2026-09-25", end: "2026-10-01", mode: "fixed", dataState: "all" } },
      "2026-10-01",
      fake(calls),
    );
    expect(r.window).toEqual({ start: "2026-09-25", end: "2026-10-01", mode: "fixed", dataState: "all", incompleteFrom: "2026-09-30" });
    expect(calls.slice(1).every((c) => c.body.dataState === "all")).toBe(true);
  });

  it("reads the comparison range the same way as the current one", async () => {
    const calls: { site: string; body: QueryBody }[] = [];
    await siteReport("sc-domain:kweqoo.net", { days: 1, fresh: true, compare: true }, "2026-10-01", fake(calls));
    const prev = calls.find((c) => c.body.startDate === "2026-09-30" && !c.body.dimensions);
    expect(prev?.body.dataState).toBe("all");
  });

  it("records how many rows a top-n list was ranked from", async () => {
    const r = await siteReport("sc-domain:kweqoo.net", { days: 3, fresh: false, pages: 5 }, "2026-10-01", fake([]));
    expect(r.fetched).toEqual({ pages: { requested: 1000, returned: 1 } });
  });

  it("keeps the aggregation for every property in --all", async () => {
    const q: Query = async (_site, body) =>
      body.dimensions
        ? { rows: [], metadata: { firstIncompleteDate: "2026-09-30" } }
        : { rows: [{ clicks: 1, impressions: 2, ctr: 0.5, position: 3 }], responseAggregationType: "byProperty" };
    const rows = await allReports([{ siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" }], { days: 3, fresh: false }, "2026-10-01", q);
    expect(rows[0]?.aggregation).toBe("byProperty");
  });
});
