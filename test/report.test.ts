import { describe, expect, it } from "vitest";
import {
  addDays,
  chooseWindow,
  dailyOf,
  datesBetween,
  probeBody,
  rankedOf,
  resolveSite,
  todayPT,
  totalsOf,
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

  it("probes back far enough with fresh data", () => {
    expect(probeBody(7, "2026-10-01")).toEqual({
      startDate: "2026-09-14",
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
      mode: "final",
      incompleteFrom: "2026-09-30",
    });
  });

  it("ends today in fresh mode", () => {
    expect(chooseWindow(probe, 3, "2026-10-01", true)).toMatchObject({ start: "2026-09-29", end: "2026-10-01", mode: "fresh" });
  });

  it("without an incomplete date, ends on the newest row, else yesterday", () => {
    expect(chooseWindow({ rows: probe.rows }, 1, "2026-10-01", false).end).toBe("2026-09-30");
    expect(chooseWindow({}, 1, "2026-10-01", false).end).toBe("2026-09-30");
  });
});

describe("rows", () => {
  const window = { start: "2026-09-27", end: "2026-09-29", mode: "final" as const };

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
    expect(totalsOf({})).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
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

  it("matches exactly, then by host", () => {
    expect(resolveSite("https://example.com/", sites).siteUrl).toBe("https://example.com/");
    expect(resolveSite("kweqoo.net", sites).siteUrl).toBe("sc-domain:kweqoo.net");
    expect(resolveSite("https://blog.example.com/x", sites).siteUrl).toBe("https://blog.example.com/");
  });

  it("refuses an ambiguous or unknown host", () => {
    expect(() => resolveSite("example.com", sites)).toThrow(/more than one property/);
    expect(() => resolveSite("nope.org", sites)).toThrow(/no Search Console property matches "nope.org"/);
  });
});
