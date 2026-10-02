/** Markdown and JSON output for the three modes. Pure. */

import type { AllRow, SiteReport } from "./collect.js";
import type { Window } from "./report.js";
import type { Metrics, Site } from "./types.js";

function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function pct(ctr: number): string {
  return `${(ctr * 100).toFixed(1)}%`;
}

/** Average position; "-" when there were no impressions to average. */
function pos(m: Metrics): string {
  return m.impressions > 0 ? m.position.toFixed(1) : "-";
}

function cells(m: Metrics): string[] {
  return [int(m.clicks), int(m.impressions), pct(m.ctr), pos(m)];
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/** "2026-09-23..2026-09-29 (complete data)" or "... (includes preliminary data from 2026-09-30)". */
export function describeWindow(w: Window): string {
  const range = `${w.start}..${w.end}`;
  if (w.mode === "final") return `${range} (complete data, Pacific Time)`;
  return w.incompleteFrom && w.incompleteFrom <= w.end
    ? `${range} (includes preliminary data from ${w.incompleteFrom}, Pacific Time)`
    : `${range} (Pacific Time)`;
}

const METRIC_HEAD = "| Clicks | Impressions | CTR | Position |";
const METRIC_RULE = "| ---: | ---: | ---: | ---: |";

export function renderSitesMarkdown(sites: Site[]): string {
  const lines = ["# Search Console properties", ""];
  if (sites.length === 0) {
    lines.push(
      "No properties are visible to these credentials. Add the service account's email as a user in Search Console (Settings -> Users and permissions).",
    );
    return lines.join("\n") + "\n";
  }
  lines.push("| Property | Permission |", "| --- | --- |");
  for (const s of sites) lines.push(`| ${cell(s.siteUrl)} | ${s.permissionLevel} |`);
  return lines.join("\n") + "\n";
}

export function renderSitesJson(sites: Site[]): string {
  return JSON.stringify({ sites }, null, 2) + "\n";
}

function ranked(title: string, label: string, rows: { key: string; metrics: Metrics }[]): string[] {
  const lines = [`## ${title}`, ""];
  if (rows.length === 0) {
    lines.push("No data.", "");
    return lines;
  }
  lines.push(`| # | ${label} ${METRIC_HEAD}`, `| ---: | --- ${METRIC_RULE}`);
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${cell(r.key)} | ${cells(r.metrics).join(" | ")} |`));
  lines.push("");
  return lines;
}

export function renderSiteMarkdown(r: SiteReport): string {
  const t = r.totals;
  const lines = [
    `# ${r.siteUrl} — last ${r.daily.length} days`,
    "",
    describeWindow(r.window),
    "",
    "## Totals",
    `- Clicks: ${int(t.clicks)}`,
    `- Impressions: ${int(t.impressions)}`,
    `- CTR: ${pct(t.ctr)}`,
    `- Average position: ${pos(t)}`,
    "",
    "## Daily",
    "",
    `| Date ${METRIC_HEAD}`,
    `| --- ${METRIC_RULE}`,
    ...r.daily.map((d) => `| ${d.date} | ${cells(d.metrics).join(" | ")} |`),
    "",
  ];
  if (r.queries) lines.push(...ranked("Top queries", "Query", r.queries));
  if (r.pages) lines.push(...ranked("Top pages", "Page", r.pages));
  if (r.queries) {
    lines.push(
      "Search Console leaves rare queries out of query rows to protect privacy, so the query rows can add up to less than the totals.",
    );
  }
  return lines.join("\n").replace(/\n*$/, "\n");
}

export function renderSiteJson(r: SiteReport): string {
  return JSON.stringify(r, null, 2) + "\n";
}

export function renderAllMarkdown(rows: AllRow[], days: number): string {
  const lines = [`# Search Console — every property, last ${days} days`, ""];
  if (rows.length === 0) {
    lines.push("No properties are visible to these credentials.");
    return lines.join("\n") + "\n";
  }
  lines.push(`| Property | Range ${METRIC_HEAD}`, `| --- | --- ${METRIC_RULE}`);
  for (const r of rows) {
    const range = r.window ? `${r.window.start}..${r.window.end}` : "-";
    const values = r.totals ? cells(r.totals) : ["error", "error", "error", "error"];
    lines.push(`| ${cell(r.site.siteUrl)} | ${range} | ${values.join(" | ")} |`);
  }
  const failed = rows.filter((r) => r.error);
  if (failed.length > 0) {
    lines.push("", "## Errors");
    for (const r of failed) lines.push(`- ${r.site.siteUrl}: ${r.error}`);
  }
  const fresh = rows.some((r) => r.window?.mode === "fresh");
  lines.push(
    "",
    fresh
      ? "Ranges are in Pacific Time and include preliminary data, which can still change."
      : "Ranges are in Pacific Time and end on each property's last day of complete data.",
  );
  return lines.join("\n") + "\n";
}

export function renderAllJson(rows: AllRow[], days: number): string {
  return (
    JSON.stringify(
      {
        days,
        properties: rows.map((r) => ({
          siteUrl: r.site.siteUrl,
          permissionLevel: r.site.permissionLevel,
          ...(r.window ? { window: r.window } : {}),
          ...(r.totals ? { totals: r.totals } : { error: r.error ?? "unknown error" }),
        })),
      },
      null,
      2,
    ) + "\n"
  );
}
