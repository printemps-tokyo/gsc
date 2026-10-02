# gsc

> Check Google Search Console clicks, impressions, CTR and position from the terminal, for one site or every site at once. Zero-dependency CLI.

[![CI](https://github.com/printemps-tokyo/gsc/actions/workflows/ci.yml/badge.svg)](https://github.com/printemps-tokyo/gsc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

```console
$ gsc --all --days 7
# Search Console — every property, last 7 days

| Property | Range | Clicks | Impressions | CTR | Position |
| --- | --- | ---: | ---: | ---: | ---: |
| sc-domain:example.com | 2026-09-23..2026-09-29 | 41 | 3,210 | 1.3% | 18.4 |
| https://blog.example.com/ | 2026-09-23..2026-09-29 | 7 | 902 | 0.8% | 24.1 |

Ranges are in Pacific Time and end on each property's last day of complete data.
```

It authenticates with a Google service account (a signed JWT exchanged for an
access token, all via Node's built-in `crypto`), calls the Search Console
API, and prints Markdown or JSON. No runtime dependencies.

## Requirements

- Node.js >= 20
- A Google service account that is a user of your Search Console properties
  (one-time setup below)

## One-time setup

1. In Google Cloud, create a service account and download its JSON key (or
   reuse one).
2. Enable the Google Search Console API for that project.
3. In Search Console, for each property: Settings -> Users and permissions ->
   Add user, with the service account's email
   (`...@...iam.gserviceaccount.com`).

## Install

Not published to npm yet; install from source:

```bash
git clone https://github.com/printemps-tokyo/gsc
cd gsc
npm install && npm run build
npm link   # optional: puts the `gsc` command on your PATH
```

## Usage

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
gsc --list                                   # properties you can see
gsc --all --days 7                           # every property, one row each
gsc --site example.com --days 28 --queries --pages   # one property in detail
gsc --site sc-domain:example.com --fresh     # include preliminary data
gsc --all --days 7 --compare                 # with the change from the 7 days before
gsc --site example.com --start 2026-09-01 --end 2026-09-30   # a fixed month
gsc --site blog.example.com                  # a subdomain of a Domain property
gsc --site example.com --type image          # image search instead of web
gsc --all --format json -o week.json
```

`<property>` is one of:

- a siteUrl as `gsc --list` prints it: `sc-domain:example.com` for a Domain
  property, `https://www.example.com/` for a URL-prefix property. A URL that
  normalizes to one (no trailing slash) is accepted; anything else that is a
  URL or `sc-domain:` must match exactly, because a different property covers
  different pages.
- a bare host such as `example.com`: its Domain property, or a URL-prefix
  property at the root of that host. More than one match is an error that
  lists them.
- a bare subdomain such as `blog.example.com` covered by a Domain property
  (`sc-domain:example.com`): that property, filtered to pages on the
  subdomain. The output says so; the numbers are then aggregated by page.

| Option | Description | Default |
| --- | --- | --- |
| `--list` | List the properties the credentials can see, with your permission level | |
| `--all` | One row per property: clicks, impressions, CTR, average position. Exits 1 if any property fails, after printing the rest | |
| `--site <property>` | One property: totals, a daily table, and optional top queries and pages (or `GSC_SITE`) | |
| `--days <n>` | Days to report | `7` |
| `--fresh` | End today (Pacific Time) and include preliminary data; with `--start`/`--end`, include preliminary data in that range | off |
| `--start <date>` `--end <date>` | A fixed range, `YYYY-MM-DD` in Pacific Time, both inclusive; replaces `--days`. Without `--fresh`, days that are not complete yet count as no data | |
| `--compare` | Also show the change against the same number of days just before the range | off |
| `--type <type>` | Search type: `web`, `image`, `video`, `news`, `discover`, `googleNews` | `web` |
| `--queries [n]` | With `--site`: top n queries by clicks, then impressions (at most 25,000) | `10` when given |
| `--pages [n]` | With `--site`: top n pages by clicks, then impressions (at most 25,000) | `10` when given |
| `--key-file <path>` | Service-account JSON key (or `GOOGLE_APPLICATION_CREDENTIALS`) | |
| `--token <token>` | Use an OAuth access token with the `webmasters.readonly` scope directly (or `GSC_ACCESS_TOKEN`) | |
| `--format <md\|json>` | Output format | `md` |
| `-o, --output <file>` | Write to a file | stdout |

Exactly one of `--list`, `--all` and `--site` is required; `GSC_SITE` stands
in for `--site` only when none of them is given. Credentials are taken in
this order: `--token`, `--key-file`, `GSC_ACCESS_TOKEN`,
`GOOGLE_APPLICATION_CREDENTIALS` (command-line options win; `--token` and
`--key-file` together are an error).

Exit codes: 0 on success, 1 on any error. With `--all`, a property that fails
is shown as an error row and listed under Errors, the rest are printed, and
the exit code is 1.

## How the date range is chosen

- Search Console dates are Pacific Time: the API takes `startDate` and
  `endDate` "in PT time (UTC - 7:00/8:00)"
  ([searchAnalytics.query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)).
- Newest data is preliminary: Search Console's help says collected data "is
  usually available in 2–3 days"
  ([Troubleshooting data discrepancies](https://support.google.com/webmasters/answer/17010575)).
  So by default the range ends on each property's last day of complete data.
  gsc finds that day by asking for fresh data once and reading
  `metadata.firstIncompleteDate`; the range ends the day before it. If Search
  Console does not report that date, the range ends yesterday and the output
  says the end is assumed, since its newest days may still change. With
  `--fresh` the range ends today and the output says from which date the data
  is preliminary. `--start`/`--end` use the range as given.
- `--days 7` is seven calendar days ending there. Days without data, which the
  API leaves out when grouping by date, show as zeros in the daily table.

## What the numbers mean

- Totals come from a query with no dimensions, so they are Search Console's
  own totals for the property, not a sum of rows.
- Query rows can add up to less than the totals: rare queries are
  "omitted from the table, but are included in the chart totals"
  ([Troubleshooting data discrepancies](https://support.google.com/webmasters/answer/17010575)).
- The API sorts rows by clicks and leaves ties in an arbitrary order. For a
  top-n list gsc fetches at least 1,000 rows (the API's maximum per request
  is 25,000) and re-sorts them by clicks, then impressions, then text. That
  makes the list stable on sites with few clicks, but it ranks only the rows
  fetched: a row tied on clicks beyond them is not considered.
- Data filtered or grouped by page is aggregated by page, which is why a
  subdomain's numbers do not add up to the Domain property's: "Data grouped
  by Pages or Search appearance is aggregated by page"
  ([Performance report](https://support.google.com/webmasters/answer/7576553)).
  The JSON output carries the aggregation Search Console reports
  (`aggregation`).
- Position is the average position; it shows as `-` when there were no
  impressions to average.

## Network behaviour

- Each request times out after 30 seconds. Server errors (5xx) and network
  failures are retried twice with a short backoff; other errors are not,
  since the same request fails the same way.
- When the quota is exceeded the error says to wait 15 minutes, as the
  [usage limits page](https://developers.google.com/webmaster-tools/limits)
  advises. `--all` queries four properties at a time.

## Security

- The service-account key grants read access to your Search Console data;
  keep it out of version control and restrict its file permissions.
- gsc reads the key only to mint a short-lived token and never writes it
  anywhere. All requests go directly to Google's APIs.

## Programmatic API

```ts
import { chooseWindow, todayPT, renderAllMarkdown } from "@printemps-tokyo/gsc";
```

The window, ranking and rendering functions are pure; `listSites`,
`querySite` and `requestAccessToken` are the only network calls.

## License

[MIT](./LICENSE) (c) printemps.tokyo
