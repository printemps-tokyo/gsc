import { describe, expect, it } from "vitest";
import { querySite } from "../src/api.js";

const body = { startDate: "2026-09-01", endDate: "2026-09-02" };
const noSleep = async () => {};

function sequence(responses: (Response | Error)[]): { fetch: typeof fetch; calls: () => number } {
  let i = 0;
  return {
    fetch: (async () => {
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r!;
    }) as typeof fetch,
    calls: () => i,
  };
}

describe("querySite", () => {
  it("encodes the property into the path", async () => {
    let url = "";
    const f = (async (u: string | URL | Request) => {
      url = String(u);
      return new Response("{}");
    }) as typeof fetch;
    await querySite("sc-domain:kweqoo.net", body, "tok", f, noSleep);
    expect(url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Akweqoo.net/searchAnalytics/query");
  });

  it("retries server errors and network failures, then succeeds", async () => {
    const s = sequence([new Response("busy", { status: 503 }), new TypeError("fetch failed"), new Response('{"rows":[]}')]);
    expect(await querySite("sc-domain:a.example", body, "tok", s.fetch, noSleep)).toEqual({ rows: [] });
    expect(s.calls()).toBe(3);
  });

  it("does not retry client errors, and explains quota and permission errors", async () => {
    const quota = sequence([new Response('{"error":{"message":"Quota exceeded"}}', { status: 429 })]);
    await expect(querySite("sc-domain:a.example", body, "tok", quota.fetch, noSleep)).rejects.toThrow(/wait 15 minutes/);
    expect(quota.calls()).toBe(1);
    const denied = sequence([new Response('{"error":{"message":"User does not have sufficient permission"}}', { status: 403 })]);
    await expect(querySite("sc-domain:a.example", body, "tok", denied.fetch, noSleep)).rejects.toThrow(/add the service account/);
  });

  it("gives up after the retries", async () => {
    const s = sequence([new Response("x", { status: 500 }), new Response("x", { status: 500 }), new Response("x", { status: 500 })]);
    await expect(querySite("sc-domain:a.example", body, "tok", s.fetch, noSleep)).rejects.toThrow(/HTTP 500/);
    expect(s.calls()).toBe(3);
  });
});

describe("timeouts and retries cover the body and the token request", () => {
  it("retries when the connection drops while the body is read", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      if (n === 1) {
        return { status: 200, ok: true, text: async () => Promise.reject(new TypeError("terminated")) } as unknown as Response;
      }
      return new Response('{"rows":[]}');
    }) as typeof fetch;
    expect(await querySite("sc-domain:a.example", body, "tok", f, noSleep)).toEqual({ rows: [] });
    expect(n).toBe(2);
  });

  it("retries the token request on a server error", async () => {
    const { requestAccessToken } = await import("../src/auth.js");
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = { client_email: "x@y.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    const s = sequence([new Response("x", { status: 503 }), new Response('{"access_token":"t"}')]);
    expect(await requestAccessToken(sa, s.fetch, 1_700_000_000, noSleep)).toBe("t");
    expect(s.calls()).toBe(2);
  });
});
