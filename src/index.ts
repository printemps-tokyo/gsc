/**
 * Public API for gsc: Google Search Console from the terminal.
 *
 * Authentication, the two API calls, the reporting window and the renderers
 * are exported for reuse. Everything except `requestAccessToken`,
 * `listSites` and `querySite` is pure.
 */

export type { ServiceAccount, Metrics, Site } from "./types.js";
export { base64url, buildJwtClaim, createAssertion, requestAccessToken, WEBMASTERS_SCOPE } from "./auth.js";
export { listSites, querySite } from "./api.js";
export type { QueryBody, QueryResponse, QueryRow } from "./api.js";
export {
  SEARCH_CONSOLE_TIME_ZONE,
  PROBE_DAYS,
  NO_QUERY_TYPES,
  hasPreliminary,
  fixedWindow,
  previousWindow,
  windowDays,
  hostFilter,
  todayPT,
  addDays,
  datesBetween,
  probeBody,
  chooseWindow,
  totalsOf,
  dailyOf,
  rankedOf,
  fetchSizeFor,
  resolveSite,
} from "./report.js";
export type { Window } from "./report.js";
export { siteReport, allReports, windowFor } from "./collect.js";
export type { Query, ReportOptions, SiteReport, AllRow } from "./collect.js";
export {
  describeWindow,
  renderSitesMarkdown,
  renderSitesJson,
  renderSiteMarkdown,
  renderSiteJson,
  renderAllMarkdown,
  renderAllJson,
} from "./render.js";
