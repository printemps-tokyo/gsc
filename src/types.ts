/** A Google service-account key, as found in the downloaded JSON file. */
export type { ServiceAccount } from "./shared/google-auth.js";

/**
 * The four Search Console metrics. `ctr` is 0..1; `position` is the average
 * position (1 = top), or null when Search Console returned none (no
 * impressions, or a search type without positions such as Discover).
 */
export interface Metrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

/** A Search Console property and the caller's permission on it. */
export interface Site {
  /** "https://www.example.com/" (URL-prefix property) or "sc-domain:example.com" (Domain property). */
  siteUrl: string;
  /** siteOwner, siteFullUser, siteRestrictedUser or siteUnverifiedUser. */
  permissionLevel: string;
}
