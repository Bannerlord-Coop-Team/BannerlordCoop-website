const WEBSITE_NIGHTLY_URL = "https://bannerlordcoop.com/nightly";

/** A browser redirect from a retired gateway page to its bannerlordcoop.com/nightly replacement. */
export type WebsiteRedirect = { location: string; status: 301 | 302 };

const PERMANENT_PAGES: Readonly<Record<string, string>> = Object.freeze({
    "/sponsor": "/sponsor",
    "/sponsor/login": "/sponsor/login",
    "/v1/sponsorship/claim": "/sponsor",
});

// Maps a gateway browser path that moved to the website onto its new URL, or null when the gateway still serves it.
// "/" and "/activate" are 302 (they may change again); the retired sponsor and OAuth pages are 301. Only "/" and
// "/activate" are limited to GET/HEAD; "/activate" and "/oauth/callback" keep their query string, so the callback is
// handled outside the PERMANENT_PAGES table.
export function websiteRedirectFor(method: string, url: URL): WebsiteRedirect | null {
    const readOnly = method === "GET" || method === "HEAD";
    if (readOnly && url.pathname === "/") return { location: WEBSITE_NIGHTLY_URL, status: 302 };
    if (readOnly && url.pathname === "/activate") {
        return { location: `${WEBSITE_NIGHTLY_URL}/activate${url.search}`, status: 302 };
    }
    if (url.pathname === "/oauth/callback") {
        return { location: `${WEBSITE_NIGHTLY_URL}/callback${url.search}`, status: 301 };
    }
    const page = PERMANENT_PAGES[url.pathname];
    if (page !== undefined) return { location: `${WEBSITE_NIGHTLY_URL}${page}`, status: 301 };
    if (url.pathname.startsWith("/v1/sponsor/")) return { location: `${WEBSITE_NIGHTLY_URL}/sponsor`, status: 301 };
    return null;
}
