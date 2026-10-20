/** `URL.hostname` spellings of the loopback hosts; an IPv6 hostname keeps its brackets. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether a URL names a loopback host. */
export function isLoopbackUrl(url: URL): boolean {
    return LOOPBACK_HOSTNAMES.has(url.hostname);
}

/** Whether an origin's scheme is allowed: `https:` always, `http:` only for a loopback host under `next dev`. */
export function isPermittedOriginScheme(url: URL, nodeEnv: string | undefined): boolean {
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return nodeEnv === "development" && isLoopbackUrl(url);
}
