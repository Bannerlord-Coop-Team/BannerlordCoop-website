export function getSafeDestination(value: string | null, origin: string) {
    const fallback = new URL("/", origin);
    if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
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
