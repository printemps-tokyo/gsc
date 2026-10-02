import { describe, expect, it } from "vitest";
import {
  addDays,
  chooseWindow,
  dailyOf,
  datesBetween,
  fixedWindow,
  hostFilter,
  isDate,
  previousWindow,
  probeBody,
  rankedOf,
  resolveSite,
  todayPT,
  totalsOf,
  windowDays,
} from "../src/report.js";

describe("dates", () => {
  it("uses Pacific Time for today", () => {
    // 2026-10-02 05:49 UTC is still 2026-10-01 in Los Angeles (PDT, UTC-7).
    expect(todayPT(new Date("2026-10-02T05:49:00Z"))).toBe("2026-10-01");
    expect(todayPT(new Date("2026-10-02T08:00:00Z"))).toBe("2026-10-02");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(datesBetween("2026-09-29", "2026-10-01")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
  });

  it("probes the recent days with fresh data", () => {
    // The probe covers the last 10 days whatever --days is.
    expect(probeBody("2026-10-01")).toEqual({
      startDate: "2026-09-22",
      endDate: "2026-10-01",
      dimensions: ["date"],
      dataState: "all",
    });
  });
});

describe("chooseWindow", () => {
  // Shaped like a real probe: rows up to today, complete data up to 09-29.
  const probe = {
    rows: [
      { keys: ["2026-09-28"], impressions: 36 },
      { keys: ["2026-09-30"], impressions: 114 },
    ],
    metadata: { firstIncompleteDate: "2026-09-30" },
  };

  it("ends the day before the first incomplete date", () => {
    expect(chooseWindow(probe, 3, "2026-10-01", false)).toEqual({
      start: "2026-09-27",
      end: "2026-09-29",
      mode: "final", dataState: "final",
      incompleteFrom: "2026-09-30",
      boundary: "reported",
    });
  });

  it("ends today in fresh mode", () => {
    expect(chooseWindow(probe, 3, "2026-10-01", true)).toMatchObject({ start: "2026-09-29", end: "2026-10-01", mode: "fresh", dataState: "all" });
  });

  it("without an incomplete date, ends yesterday and says the end is assumed", () => {
    // Days without data are left out of date rows, so an old newest row must
    // not pull the window back.
    const sparse = { rows: [{ keys: ["2026-09-20"], impressions: 1 }] };
    expect(chooseWindow(sparse, 7, "2026-10-01", false)).toEqual({
      start: "2026-09-24",
      end: "2026-09-30",
      mode: "final", dataState: "final",
      boundary: "assumed",
    });
    expect(chooseWindow({}, 1, "2026-10-01", false)).toMatchObject({ end: "2026-09-30", boundary: "assumed" });
  });
});

describe("fixed and previous windows", () => {
  it("validates --start/--end", () => {
    expect(fixedWindow("2026-09-01", "2026-09-30", "2026-10-01")).toEqual({ start: "2026-09-01", end: "2026-09-30", mode: "fixed", dataState: "final" });
    expect(() => fixedWindow("2026-09-31", "2026-09-30", "2026-10-01")).toThrow(/YYYY-MM-DD/);
    expect(() => fixedWindow("2026-09-30", "2026-09-01", "2026-10-01")).toThrow(/not be after/);
    expect(() => fixedWindow("2026-09-01", "2026-10-02", "2026-10-01")).toThrow(/future/);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
  });

  it("compares against the same number of days just before", () => {
    const w = { start: "2026-09-23", end: "2026-09-29", mode: "final" as const, dataState: "final" as const, boundary: "reported" as const };
    expect(windowDays(w)).toBe(7);
    expect(previousWindow(w)).toEqual({
      start: "2026-09-16",
      end: "2026-09-22",
      mode: "final",
      dataState: "final",
      boundary: "reported",
    });
    // Read the same way as the current range, preliminary marker kept only when it reaches back that far.
    const fresh = { start: "2026-10-01", end: "2026-10-01", mode: "fresh" as const, dataState: "all" as const, incompleteFrom: "2026-09-30" };
    expect(previousWindow(fresh)).toEqual({
      start: "2026-09-30",
      end: "2026-09-30",
      mode: "fresh",
      dataState: "all",
      incompleteFrom: "2026-09-30",
    });
  });
});

describe("rows", () => {
  const window = { start: "2026-09-27", end: "2026-09-29", mode: "final" as const, dataState: "final" as const };

  it("fills days Search Console omitted with zeros", () => {
    const daily = dailyOf({ rows: [{ keys: ["2026-09-28"], clicks: 1, impressions: 36, ctr: 0.03, position: 12 }] }, window);
    expect(daily.map((d) => [d.date, d.metrics.impressions])).toEqual([
      ["2026-09-27", 0],
      ["2026-09-28", 36],
      ["2026-09-29", 0],
    ]);
  });

  it("reads totals and ranked rows", () => {
    expect(totalsOf({ rows: [{ clicks: 0, impressions: 106, ctr: 0, position: 15.65 }] })).toEqual({
      clicks: 0,
      impressions: 106,
      ctr: 0,
      position: 15.65,
    });
    // No position in the response (no impressions, or Discover) stays null, not 0.
    expect(totalsOf({})).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: null });
    expect(totalsOf({ rows: [{ clicks: 1, impressions: 50, ctr: 0.02 }] }).position).toBeNull();
    expect(rankedOf({ rows: [{ keys: ["kweqoo"], clicks: 3 }] })[0]?.key).toBe("kweqoo");
    // Ties on clicks are broken by impressions, then by key, and cut to n.
    const ranked = rankedOf(
      {
        rows: [
          { keys: ["b"], clicks: 0, impressions: 1 },
          { keys: ["c"], clicks: 0, impressions: 3 },
          { keys: ["a"], clicks: 0, impressions: 1 },
          { keys: ["d"], clicks: 1, impressions: 1 },
        ],
      },
      3,
    );
    expect(ranked.map((r) => r.key)).toEqual(["d", "c", "a"]);
  });
});

describe("resolveSite", () => {
  const sites = [
    { siteUrl: "sc-domain:kweqoo.net", permissionLevel: "siteFullUser" },
    { siteUrl: "https://blog.example.com/", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
    { siteUrl: "https://example.com/", permissionLevel: "siteOwner" },
  ];

  it("matches exactly, or a URL that normalizes to the same one", () => {
    expect(resolveSite("https://example.com/", sites)).toEqual({ site: sites[3] });
    expect(resolveSite("https://example.com", sites)).toEqual({ site: sites[3] });
    expect(resolveSite("kweqoo.net", sites)).toEqual({ site: sites[0] });
    expect(resolveSite("blog.example.com", sites)).toEqual({ site: sites[1] });
  });

  it("never swaps an explicit URL or sc-domain for a different property", () => {
    expect(() => resolveSite("https://blog.example.com/x", sites)).toThrow(/no Search Console property is exactly/);
    expect(() => resolveSite("http://example.com/", sites)).toThrow(/is exactly/);
    expect(() => resolveSite("sc-domain:other.example", sites)).toThrow(/is exactly/);
  });

  it("refuses an ambiguous or unknown host", () => {
    expect(() => resolveSite("example.com", sites)).toThrow(/more than one property/);
    expect(() => resolveSite("nope.org", sites)).toThrow(/no Search Console property matches "nope.org"/);
  });

  it("narrows a Domain property to a subdomain it covers", () => {
    expect(resolveSite("kabuto-zukan.kweqoo.net", sites)).toEqual({ site: sites[0], host: "kabuto-zukan.kweqoo.net" });
    expect(hostFilter("kabuto-zukan.kweqoo.net")).toEqual({
      dimension: "page",
      operator: "includingRegex",
      expression: "^https?://kabuto-zukan\\.kweqoo\\.net(:[0-9]+)?(/|$)",
    });
    const re = new RegExp(hostFilter("blog.example.com").expression);
    expect(re.test("https://blog.example.com:8443/a")).toBe(true);
    expect(re.test("https://blog.example.com")).toBe(true);
    expect(re.test("https://blog.example.com.evil.test/")).toBe(false);
    expect(re.test("https://xblog.example.com/")).toBe(false);
  });
});
