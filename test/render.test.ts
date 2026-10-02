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
  });

  it("renders a site report with totals, daily rows and top queries", () => {
    const r: SiteReport = {
      siteUrl: "sc-domain:kweqoo.net",
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
