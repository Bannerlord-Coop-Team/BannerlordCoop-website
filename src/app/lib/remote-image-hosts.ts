// Remote images Next Image may load; next.config.ts uses these as its remotePatterns. Hostnames must be exact
// (no wildcards, ports or paths), because isRemoteImageAllowed compares them literally.
export const remoteImagePatterns: { protocol: "https"; hostname: string }[] = [
    { protocol: "https", hostname: "yt3.ggpht.com" },
    { protocol: "https", hostname: "i.ytimg.com" },
    { protocol: "https", hostname: "static-cdn.jtvnw.net" },
];

// Reports whether a URL matches one of the remote image patterns Next Image is configured to load.
export function isRemoteImageAllowed(url: string): boolean {
    if (!URL.canParse(url)) return false;

    const { protocol, hostname } = new URL(url);
    const scheme = protocol.slice(0, -1); // URL.protocol keeps the trailing colon ("https:"); patterns do not.
    return remoteImagePatterns.some((pattern) => pattern.protocol === scheme && pattern.hostname === hostname);
}
