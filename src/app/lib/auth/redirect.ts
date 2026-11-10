export function getSafeDestination(value: string | null, origin: string) {
    const fallback = new URL("/", origin);
    if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\x00-\x1f\x7f]/u.test(value)) {
        return fallback;
    }

    try {
        const destination = new URL(value, origin);
        const isSameOrigin = destination.origin === origin;
        const isSchemeRelativePath = destination.pathname.startsWith("//");

        return isSameOrigin && !isSchemeRelativePath ? destination : fallback;
    } catch {
        return fallback;
    }
}

/** Preserves an application destination through login, with query data encoded inside next. */
export function getLoginRedirect(pathname: string, params: Record<string, string | string[] | undefined>) {
    // This origin is used only to validate relative paths; the returned URL is always relative.
    const destination = getSafeDestination(pathname, "https://bannerlordcoop.com");
    for (const [key, value] of Object.entries(params)) {
        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
            destination.searchParams.append(key, item);
        }
    }
    const next = `${destination.pathname}${destination.search}${destination.hash}`;
    return `/login?${new URLSearchParams({ next })}`;
}
