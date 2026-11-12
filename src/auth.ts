/**
 * Service-account authentication for the Search Console API.
 *
 * The token exchange itself is shared with the sibling tools
 * (src/shared/google-auth.ts); this file only fixes the scope.
 */

import { requestServiceAccountToken, type ServiceAccount } from "./shared/google-auth.js";
import type { Sleep } from "./shared/http.js";

export { base64url, buildJwtClaim, createAssertion } from "./shared/google-auth.js";

/** Read-only Search Console access; enough for sites.list and searchAnalytics.query. */
export const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** Exchange a service-account assertion for an access token (network). */
export function requestAccessToken(
  sa: ServiceAccount,
  fetchFn: typeof fetch = fetch,
  iatSec: number = Math.floor(Date.now() / 1000),
  sleep?: Sleep,
): Promise<string> {
  return requestServiceAccountToken(sa, WEBMASTERS_SCOPE, fetchFn, iatSec, sleep);
}
