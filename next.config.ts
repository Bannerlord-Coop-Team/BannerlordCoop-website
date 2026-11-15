import type { NextConfig } from "next";
import { NIGHTLY_GATEWAY_ORIGIN } from "./src/app/lib/nightly/links";

const nextConfig: NextConfig = {
    turbopack: {root: process.cwd()},
    experimental: { serverActions: { bodySizeLimit: "22mb" } },
    output: process.env.WORKERS_CI === "1" ? "standalone" : undefined,
    async redirects() {
        return [
            {
                source: "/server/install.ps1",
                destination: `${NIGHTLY_GATEWAY_ORIGIN}/install.ps1`,
                permanent: true,
            },
            {
                source: "/server/install.cmd",
                destination: `${NIGHTLY_GATEWAY_ORIGIN}/install.cmd`,
                permanent: true,
            },
            {
                source: "/server/install.sh",
                destination: `${NIGHTLY_GATEWAY_ORIGIN}/install.sh`,
                permanent: true,
            },
            {
                source: "/server/install-linux.sh",
                destination: `${NIGHTLY_GATEWAY_ORIGIN}/install-linux.sh`,
                permanent: true,
            },
            // Retired external-console links carry no managed identity, so they return to discovery.
            {
                source: "/servers/live/:serverId",
                destination: "/servers",
                permanent: false,
            },
        ];
    },
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "yt3.ggpht.com",
            },
            {
                protocol: "https",
                hostname: "i.ytimg.com",
            },
            {
                protocol: "https",
                hostname: "static-cdn.jtvnw.net",
            },
        ],
    },
};

export default nextConfig;
