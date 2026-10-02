/** A Google service-account key, as found in the downloaded JSON file. */
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

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
