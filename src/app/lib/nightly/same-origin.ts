/** Whether a form submission came from this site: Fetch Metadata first, then Origin against the served host. */
export function isSameOriginSubmission(headers: Headers): boolean {
    const site = headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin") return false;
    const origin = headers.get("origin");
    if (origin === null) return site === "same-origin";
    const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0]?.trim();
    if (!host) return false;
    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}
