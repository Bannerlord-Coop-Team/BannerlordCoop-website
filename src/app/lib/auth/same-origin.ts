/** Whether a browser request comes from this site (or a direct navigation); cross-site requests are refused. */
export function sameOriginRequest(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin" && site !== "none") return false;
    const origin = request.headers.get("origin");
    return origin === null || origin === new URL(request.url).origin;
}
