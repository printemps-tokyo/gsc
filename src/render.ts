/** Markdown and JSON output for the three modes. Pure. */

import type { AllRow, SiteReport } from "./collect.js";
import { hasPreliminary, windowDays, type Window } from "./report.js";
import type { Metrics, Site } from "./types.js";

function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function pct(ctr: number): string {
  return `${(ctr * 100).toFixed(1)}%`;
}

/** Average position; "-" when there is none (no impressions, or a search type without positions). */
function pos(m: Metrics): string {
  return m.impressions > 0 && m.position !== null ? m.position.toFixed(1) : "-";
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
  const position =
    m.impressions > 0 && prev.impressions > 0 && m.position !== null && prev.position !== null
      ? ` (${signed(m.position - prev.position, 1)})`
      : "";
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
  if (hasPreliminary(w)) return `${range} (includes preliminary data from ${w.incompleteFrom}, Pacific Time)`;
  if (w.mode === "fixed") {
    return w.dataState === "all" ? `${range} (as requested, with preliminary data, Pacific Time)` : `${range} (as requested, complete data only, Pacific Time)`;
  }
  if (w.mode === "fresh") return `${range} (Pacific Time)`;
  return w.boundary === "assumed"
    ? `${range} (Pacific Time; Search Console did not report where complete data ends, so the newest days may still change)`
    : `${range} (complete data, Pacific Time)`;
}

/** The range cell of the --all table, with a short note when it is not plain complete data. */
function rangeCell(w: Window): string {
  const range = `${w.start}..${w.end}`;
  if (hasPreliminary(w)) return `${range} (preliminary from ${w.incompleteFrom})`;
  if (w.boundary === "assumed") return `${range} (end assumed)`;
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
    ...(r.previous ? ["", `Changes are against ${describeWindow(r.previous.window)}.`] : []),
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
  const capped = (["queries", "pages"] as const).filter((k) => {
    const f = r.fetched?.[k];
    return f !== undefined && f.returned >= f.requested;
  });
  if (capped.length > 0) {
    lines.push(
      `The ${capped.join(" and ")} list is ranked from the first ${r.fetched?.[capped[0]!]?.requested.toLocaleString("en-US")} rows Search Console returned; more rows exist beyond them.`,
    );
  }
  return lines.join("\n").replace(/\n*$/, "\n");
}

export function renderSiteJson(r: SiteReport): string {
  return JSON.stringify(r, null, 2) + "\n";
}

export function renderAllMarkdown(rows: AllRow[], days: number, type = "web"): string {
  const lines = [`# Search Console — every property, ${days} days`, ""];
  if (type !== "web") lines.push(`Search type: ${type}.`, "");
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
  const windows = rows.flatMap((r) => (r.window ? [r.window] : []));
  const mode = windows[0]?.mode;
  const note =
    mode === "fresh"
      ? "Ranges are in Pacific Time and include preliminary data, which can still change."
      : mode === "fixed"
        ? `Ranges are in Pacific Time, as requested${windows[0]?.dataState === "all" ? ", with preliminary data" : ", complete data only"}.`
        : windows.some((w) => w.boundary === "assumed")
          ? "Ranges are in Pacific Time. Each ends on the property's last day of complete data, except where marked \"end assumed\": Search Console did not report that day, so the range ends yesterday and its newest days may still change."
          : "Ranges are in Pacific Time and end on each property's last day of complete data.";
  lines.push("", note);
  if (rows.some((r) => r.aggregation === "byPage")) {
    lines.push("Some properties report numbers aggregated by page; see aggregation in the JSON output.");
  }
  if (rows.some((r) => r.previous)) {
    lines.push(
      "Changes in parentheses are against the same number of days just before each range; CTR in percentage points; for position, lower is better.",
    );
  }
  return lines.join("\n") + "\n";
}

export function renderAllJson(rows: AllRow[], days: number, type = "web"): string {
  return (
    JSON.stringify(
      {
        days,
        type,
        properties: rows.map((r) => ({
          siteUrl: r.site.siteUrl,
          permissionLevel: r.site.permissionLevel,
          ...(r.window ? { window: r.window } : {}),
          ...(r.totals ? { totals: r.totals } : { error: r.error ?? "unknown error" }),
          ...(r.aggregation ? { aggregation: r.aggregation } : {}),
          ...(r.previous ? { previous: r.previous } : {}),
        })),
      },
      null,
      2,
    ) + "\n"
  );
}
