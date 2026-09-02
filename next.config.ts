import type { NextConfig } from "next";

const GATEWAY_ORIGIN = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";

const nextConfig: NextConfig = {
  /* config options here */
    output: process.env.WORKERS_CI === "1" ? "standalone" : undefined,
    async redirects() {
        return [
            {
                source: "/server/install.ps1",
                destination: `${GATEWAY_ORIGIN}/install.ps1`,
                permanent: true,
            },
            {
                source: "/server/install.cmd",
                destination: `${GATEWAY_ORIGIN}/install.cmd`,
                permanent: true,
            },
            {
                source: "/server/install.sh",
                destination: `${GATEWAY_ORIGIN}/install.sh`,
                permanent: true,
            },
            {
                source: "/server/install-linux.sh",
                destination: `${GATEWAY_ORIGIN}/install-linux.sh`,
                permanent: true,
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
