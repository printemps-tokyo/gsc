import { describe, expect, it } from "vitest";
import {
  describeWindow,
  renderAllJson,
  renderAllMarkdown,
  renderSiteMarkdown,
  renderSitesMarkdown,
} from "../src/render.js";
import type { SiteReport } from "../src/collect.js";

const m = (clicks: number, impressions: number, ctr: number, position: number) => ({ clicks, impressions, ctr, position });

describe("render", () => {
  it("lists properties, or explains how to get access", () => {
    expect(renderSitesMarkdown([{ siteUrl: "sc-domain:kweqoo.net", permissionLevel: "siteFullUser" }])).toContain(
      "| sc-domain:kweqoo.net | siteFullUser |",
    );
    expect(renderSitesMarkdown([])).toContain("Users and permissions");
  });

  it("describes the window", () => {
    expect(describeWindow({ start: "2026-09-27", end: "2026-09-29", mode: "final" })).toBe(
      "2026-09-27..2026-09-29 (complete data, Pacific Time)",
    );
    expect(describeWindow({ start: "2026-09-29", end: "2026-10-01", mode: "fresh", incompleteFrom: "2026-09-30" })).toContain(
      "includes preliminary data from 2026-09-30",
    );
    expect(describeWindow({ start: "2026-09-24", end: "2026-09-30", mode: "final", boundary: "assumed" })).toContain(
      "did not report where complete data ends",
    );
    expect(describeWindow({ start: "2026-09-01", end: "2026-09-30", mode: "fixed" })).toContain("as requested");
  });

  it("renders a site report with totals, daily rows and top queries", () => {
    const r: SiteReport = {
      siteUrl: "sc-domain:kweqoo.net",
      type: "web",
      window: { start: "2026-09-28", end: "2026-09-29", mode: "final" },
      totals: m(2, 1094, 0.00183, 15.65),
      daily: [
        { date: "2026-09-28", metrics: m(0, 0, 0, 0) },
        { date: "2026-09-29", metrics: m(2, 1094, 0.00183, 15.65) },
      ],
      queries: [{ key: "a | b", metrics: m(2, 10, 0.2, 3) }],
    };
    const md = renderSiteMarkdown(r);
    expect(md).toContain("- Impressions: 1,094");
    expect(md).toContain("- CTR: 0.2%");
    expect(md).toContain("- Average position: 15.7");
    expect(md).toContain("| 2026-09-28 | 0 | 0 | 0.0% | - |");
    expect(md).toContain("| # | Query | Clicks | Impressions | CTR | Position |\n| ---: | --- | ---: | ---: | ---: | ---: |");
    expect(md).toContain("| 1 | a \\| b | 2 | 10 | 20.0% | 3.0 |");
    expect(md.endsWith("\n")).toBe(true);
    expect(md).toContain("rare queries");
  });

  it("renders every property, with errors listed", () => {
    const rows = [
      {
        site: { siteUrl: "sc-domain:kweqoo.net", permissionLevel: "siteFullUser" },
        window: { start: "2026-09-27", end: "2026-09-29", mode: "final" as const },
        totals: m(0, 106, 0, 15.65),
      },
      { site: { siteUrl: "sc-domain:broken.example", permissionLevel: "siteFullUser" }, error: "HTTP 403" },
    ];
    const md = renderAllMarkdown(rows, 3);
    expect(md).toContain("| sc-domain:kweqoo.net | 2026-09-27..2026-09-29 | 0 | 106 | 0.0% | 15.7 |");
    expect(md).toContain("| sc-domain:broken.example | - | error | error | error | error |");
    expect(md).toContain("- sc-domain:broken.example: HTTP 403");
    const json = JSON.parse(renderAllJson(rows, 3));
    expect(json.properties[1]).toEqual({ siteUrl: "sc-domain:broken.example", permissionLevel: "siteFullUser", error: "HTTP 403" });
  });
});

describe("comparisons and scope", () => {
  const prevTotals = { clicks: 29, impressions: 3000, ctr: 0.011, position: 19.5 };
  const totals = { clicks: 41, impressions: 3210, ctr: 0.0128, position: 18.4 };

  it("shows changes against the previous period", () => {
    const md = renderAllMarkdown(
      [
        {
          site: { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
          window: { start: "2026-09-23", end: "2026-09-29", mode: "final", boundary: "reported" },
          totals,
          previous: { window: { start: "2026-09-16", end: "2026-09-22", mode: "final" }, totals: prevTotals },
        },
      ],
      7,
    );
    expect(md).toContain("| sc-domain:example.com | 2026-09-23..2026-09-29 | 41 (+12) | 3,210 (+210) | 1.3% (+0.2pt) | 18.4 (-1.1) |");
    expect(md).toContain("for position, lower is better");
  });

  it("marks preliminary and assumed ranges in the --all table", () => {
    const md = renderAllMarkdown(
      [
        {
          site: { siteUrl: "sc-domain:a.example", permissionLevel: "siteOwner" },
          window: { start: "2026-09-29", end: "2026-10-01", mode: "fresh", incompleteFrom: "2026-09-30" },
          totals,
        },
        {
          site: { siteUrl: "sc-domain:b.example", permissionLevel: "siteOwner" },
          window: { start: "2026-09-28", end: "2026-09-30", mode: "final", boundary: "assumed" },
          totals,
        },
      ],
      3,
    );
    expect(md).toContain("2026-09-29..2026-10-01 (preliminary from 2026-09-30)");
    expect(md).toContain("2026-09-28..2026-09-30 (end assumed)");
  });

  it("says when a report is narrowed to a subdomain or another search type", () => {
    const md = renderSiteMarkdown({
      siteUrl: "sc-domain:kweqoo.net",
      host: "kabuto-zukan.kweqoo.net",
      type: "image",
      window: { start: "2026-09-29", end: "2026-09-29", mode: "final", boundary: "reported" },
      totals,
      aggregation: "byPage",
      daily: [{ date: "2026-09-29", metrics: totals }],
    });
    expect(md).toContain("aggregated by page");
    expect(md).toContain("# kabuto-zukan.kweqoo.net — 1 days");
    expect(md).toContain("Pages on kabuto-zukan.kweqoo.net only (filtered from sc-domain:kweqoo.net). Search type: image.");
  });
});
