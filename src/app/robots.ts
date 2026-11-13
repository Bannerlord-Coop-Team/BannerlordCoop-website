import { SITE_URL } from "@/app/lib/structured-data";
import type { MetadataRoute } from "next";

/**
 * Origin robots rules. Cloudflare's managed robots.txt adds its content signals and AI-crawler blocks
 * ahead of these, so this file only advertises the sitemap and keeps private areas out of the index.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: "*", allow: "/", disallow: ["/account", "/admin", "/api/", "/auth/"] },
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}
