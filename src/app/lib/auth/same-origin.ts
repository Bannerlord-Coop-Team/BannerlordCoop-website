/**
 * How much proof of origin a request must carry. `request` (route handlers) also accepts direct navigations
 * (`Sec-Fetch-Site: none`) and Origin-less requests; `submission` (server-action form posts) refuses direct
 * navigations and needs `Sec-Fetch-Site: same-origin` or an Origin on the served host.
 */
type OriginStrictness = "request" | "submission";

/** Whether a browser request comes from this site (or a direct navigation); cross-site requests are refused. */
export function sameOriginRequest(request: Request): boolean {
    const servedOrigin = new URL(request.url).origin;
    return fromThisSite(request.headers, (origin) => origin === servedOrigin, "request");
}

/** Whether a form post came from this site: Fetch Metadata `same-origin`, or an Origin on the host the post was served on. */
export function sameOriginSubmission(headers: Headers): boolean {
    const host = servedHost(headers);
    if (!host) return false;
    return fromThisSite(headers, (origin) => hostOf(origin) === host, "submission");
}

/** The host a request was served on, as the proxy forwarded it (first `X-Forwarded-Host`, else `Host`). */
function servedHost(headers: Headers): string | null {
    const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0]?.trim();
    return host || null;
}

/** The one same-origin rule: Fetch Metadata first, then the Origin header against the served site. */
function fromThisSite(headers: Headers, isServedOrigin: (origin: string) => boolean, strictness: OriginStrictness): boolean {
    const site = headers.get("sec-fetch-site");
    const lenient = strictness === "request";
    const siteAllowed = site === null || site === "same-origin" || (lenient && site === "none");
    if (!siteAllowed) return false;
    const origin = headers.get("origin");
    // Without an Origin, a route-handler request passes, and a submission passes only on Fetch Metadata `same-origin`.
    if (origin === null) return lenient || site === "same-origin";
    return isServedOrigin(origin);
}

/** The host of an Origin header value, or null when it is not a URL (such as `null`). */
function hostOf(origin: string): string | null {
    try {
        return new URL(origin).host;
    } catch {
        return null;
    }
}
