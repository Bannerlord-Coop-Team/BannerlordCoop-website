import type { NextConfig } from "next";

const GATEWAY_ORIGIN = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";

const nextConfig: NextConfig = {
  /* config options here */
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
        ],
    },
};

export default nextConfig;
