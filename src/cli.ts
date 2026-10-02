#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";

import { requestAccessToken } from "./auth.js";
import { listSites, querySite } from "./api.js";
import { allReports, siteReport, type ReportOptions } from "./collect.js";
import { resolveSite, todayPT } from "./report.js";
import {
  renderAllJson,
  renderAllMarkdown,
  renderSiteJson,
  renderSiteMarkdown,
  renderSitesJson,
  renderSitesMarkdown,
} from "./render.js";
import type { ServiceAccount } from "./types.js";

const HELP = `gsc - check Google Search Console from the terminal

Usage:
  gsc --list                       Properties these credentials can see
  gsc --site <property> [options]  One property: totals, daily, top queries/pages
  gsc --all [options]              Every property, one row each

<property> is a siteUrl as Search Console lists it ("sc-domain:example.com"
or "https://www.example.com/"), or a bare host ("example.com") when that
matches exactly one property.

Options:
  --days <n>          Days to report (default: 7). The range ends on the last
                      day of complete data, in Pacific Time.
  --fresh             End today (PT) instead, including preliminary data
  --queries [n]       With --site: also list the top n queries (default: 10)
  --pages [n]         With --site: also list the top n pages (default: 10)
  --key-file <path>   Service-account JSON key (or env GOOGLE_APPLICATION_CREDENTIALS)
  --token <token>     Use this OAuth access token directly (or env GSC_ACCESS_TOKEN)
  --format <md|json>  Output format (default: md)
  -o, --output <file> Write to a file (default: stdout)
  -h, --help          Show this help
  -v, --version       Show version

Setup: enable the Google Search Console API in the key's Google Cloud project
and add the service account's email as a user of each property in Search
Console (Settings -> Users and permissions).
`;

async function readVersion(): Promise<string> {
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = await readFile(join(here, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

async function resolveToken(keyFile: string | undefined, token: string | undefined): Promise<string> {
  const explicit = token ?? process.env.GSC_ACCESS_TOKEN;
  if (explicit) return explicit;
  const path = keyFile ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    throw new Error(
      "no credentials: pass --token, or --key-file / GOOGLE_APPLICATION_CREDENTIALS pointing to a service-account JSON key",
    );
  }
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(await readFile(path, "utf8")) as ServiceAccount;
  } catch (err) {
    throw new Error(`cannot read service-account key "${path}": ${(err as Error).message}`);
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error(`"${path}" is not a service-account key (missing client_email/private_key)`);
  }
  return requestAccessToken(sa);
}

/** Options that take an optional count: insert the default when no number follows. */
function withOptionalCounts(argv: string[], names: string[], fallback: string): string[] {
  const out = [...argv];
  for (const name of names) {
    const at = out.indexOf(name);
    if (at !== -1) {
      const next = out[at + 1];
      if (next === undefined || !/^\d+$/.test(next)) out.splice(at + 1, 0, fallback);
    }
  }
  return out;
}

function positiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

async function emit(output: string, file: string | undefined): Promise<void> {
  if (file) {
    await writeFile(file, output, "utf8");
    process.stderr.write(`gsc: wrote ${file}\n`);
  } else {
    process.stdout.write(output);
  }
}

async function main(): Promise<number> {
  const raw = process.argv.slice(2);
  if (raw.includes("-h") || raw.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (raw.includes("-v") || raw.includes("--version")) {
    process.stdout.write((await readVersion()) + "\n");
    return 0;
  }

  let values;
  try {
    values = parseArgs({
      args: withOptionalCounts(raw, ["--queries", "--pages"], "10"),
      allowPositionals: false,
      options: {
        list: { type: "boolean" },
        all: { type: "boolean" },
        site: { type: "string" },
        days: { type: "string" },
        fresh: { type: "boolean" },
        queries: { type: "string" },
        pages: { type: "string" },
        "key-file": { type: "string" },
        token: { type: "string" },
        format: { type: "string" },
        output: { type: "string", short: "o" },
      },
    }).values;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\nrun 'gsc --help' for usage.\n`);
    return 1;
  }

  const site = values.site ?? process.env.GSC_SITE;
  const modes = [values.list, values.all, site !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    process.stderr.write("error: pass exactly one of --list, --all or --site <property>\nrun 'gsc --help' for usage.\n");
    return 1;
  }
  const format = values.format ?? "md";
  if (format !== "md" && format !== "json") {
    process.stderr.write("error: --format must be md or json\n");
    return 1;
  }

  let opts: ReportOptions;
  try {
    opts = {
      days: positiveInt(values.days, "--days") ?? 7,
      fresh: values.fresh === true,
      queries: positiveInt(values.queries, "--queries"),
      pages: positiveInt(values.pages, "--pages"),
    };
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }
  if (!site && (opts.queries || opts.pages)) {
    process.stderr.write("error: --queries and --pages work with --site only\n");
    return 1;
  }
  if (values.list && (values.days || values.fresh)) {
    process.stderr.write("error: --list takes no --days or --fresh\n");
    return 1;
  }

  try {
    const token = await resolveToken(values["key-file"], values.token);
    const sites = await listSites(token);
    const query = (siteUrl: string, body: Parameters<typeof querySite>[1]) => querySite(siteUrl, body, token);
    const today = todayPT();

    if (values.list) {
      await emit(format === "json" ? renderSitesJson(sites) : renderSitesMarkdown(sites), values.output);
      return 0;
    }
    if (values.all) {
      const rows = await allReports(sites, opts, today, query);
      await emit(format === "json" ? renderAllJson(rows, opts.days) : renderAllMarkdown(rows, opts.days), values.output);
      return rows.some((r) => r.error) ? 1 : 0;
    }
    const target = resolveSite(site!, sites);
    const report = await siteReport(target.siteUrl, opts, today, query);
    await emit(format === "json" ? renderSiteJson(report) : renderSiteMarkdown(report), values.output);
    return 0;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
