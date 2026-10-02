/** Markdown and JSON output for the three modes. Pure. */

import type { AllRow, SiteReport } from "./collect.js";
import { windowDays, type Window } from "./report.js";
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

function signed(n: number, digits = 0): string {
  const fixed = digits === 0 ? int(Math.abs(n)) : Math.abs(n).toFixed(digits);
  if (Number(fixed.replace(/,/g, "")) === 0) return "±0";
  return `${n > 0 ? "+" : "-"}${fixed}`;
}

/**
 * Cells with the change from `prev` in parentheses: counts as a difference,
 * CTR in percentage points, position as a difference (negative is better).
 */
function cellsWithChange(m: Metrics, prev: Metrics | undefined): string[] {
  if (!prev) return cells(m);
  const position = m.impressions > 0 && prev.impressions > 0 ? ` (${signed(m.position - prev.position, 1)})` : "";
  return [
    `${int(m.clicks)} (${signed(m.clicks - prev.clicks)})`,
    `${int(m.impressions)} (${signed(m.impressions - prev.impressions)})`,
    `${pct(m.ctr)} (${signed((m.ctr - prev.ctr) * 100, 1)}pt)`,
    `${pos(m)}${position}`,
  ];
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/** The range and what kind of data it holds, in one line. */
export function describeWindow(w: Window): string {
  const range = `${w.start}..${w.end}`;
  const preliminary = w.incompleteFrom && w.incompleteFrom <= w.end ? w.incompleteFrom : undefined;
  if (w.mode === "fixed") return `${range} (as requested, Pacific Time)`;
  if (w.mode === "fresh") {
    return preliminary
      ? `${range} (includes preliminary data from ${preliminary}, Pacific Time)`
      : `${range} (Pacific Time)`;
  }
  return w.boundary === "assumed"
    ? `${range} (Pacific Time; Search Console did not report where complete data ends, so the newest days may still change)`
    : `${range} (complete data, Pacific Time)`;
}

/** The range cell of the --all table, with a short note when it is not plain complete data. */
function rangeCell(w: Window): string {
  const range = `${w.start}..${w.end}`;
  if (w.mode === "fresh" && w.incompleteFrom && w.incompleteFrom <= w.end) return `${range} (preliminary from ${w.incompleteFrom})`;
  if (w.mode === "final" && w.boundary === "assumed") return `${range} (end assumed)`;
  return range;
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
  const [clicks, impressions, ctr, position] = cellsWithChange(r.totals, r.previous?.totals);
  const scopeLine = [
    r.host ? `Pages on ${r.host} only (filtered from ${r.siteUrl}).` : "",
    r.type !== "web" ? `Search type: ${r.type}.` : "",
    // Search Console help: data grouped or filtered by page is aggregated by
    // page, so it does not match the property-level numbers.
    r.aggregation === "byPage"
      ? "Numbers are aggregated by page, so they are not comparable with the property's own totals."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [
    `# ${r.host ?? r.siteUrl} — ${windowDays(r.window)} days`,
    "",
    describeWindow(r.window),
    ...(scopeLine ? ["", scopeLine] : []),
    "",
    "## Totals",
    `- Clicks: ${clicks}`,
    `- Impressions: ${impressions}`,
    `- CTR: ${ctr}`,
    `- Average position: ${position}`,
    ...(r.previous ? ["", `Changes are against ${r.previous.window.start}..${r.previous.window.end}.`] : []),
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
  const lines = [`# Search Console — every property, ${days} days`, ""];
  if (rows.length === 0) {
    lines.push("No properties are visible to these credentials.");
    return lines.join("\n") + "\n";
  }
  lines.push(`| Property | Range ${METRIC_HEAD}`, `| --- | --- ${METRIC_RULE}`);
  for (const r of rows) {
    const range = r.window ? rangeCell(r.window) : "-";
    const values = r.totals ? cellsWithChange(r.totals, r.previous?.totals) : ["error", "error", "error", "error"];
    lines.push(`| ${cell(r.site.siteUrl)} | ${range} | ${values.join(" | ")} |`);
  }
  const failed = rows.filter((r) => r.error);
  if (failed.length > 0) {
    lines.push("", "## Errors");
    for (const r of failed) lines.push(`- ${r.site.siteUrl}: ${r.error}`);
  }
  const mode = rows.find((r) => r.window)?.window?.mode;
  lines.push(
    "",
    mode === "fresh"
      ? "Ranges are in Pacific Time and include preliminary data, which can still change."
      : mode === "fixed"
        ? "Ranges are in Pacific Time, as requested."
        : "Ranges are in Pacific Time and end on each property's last day of complete data.",
  );
  if (rows.some((r) => r.previous)) {
    lines.push(
      "Changes in parentheses are against the same number of days just before each range; CTR in percentage points; for position, lower is better.",
    );
  }
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
          ...(r.previous ? { previous: r.previous } : {}),
        })),
      },
      null,
      2,
    ) + "\n"
  );
}
