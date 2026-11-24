import { getEnabledLocales } from "@/app/lib/localization/registry";
import { SITE_URL } from "@/app/lib/structured-data";
import type { MetadataRoute } from "next";

/**
 * Public, indexable pages at their canonical URLs. Cheats is canonical per `?lang=`, so each enabled
 * language is listed; account, admin, login and individual server pages are left out.
 */
export default function sitemap(): MetadataRoute.Sitemap {
    return [
        { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
        { url: `${SITE_URL}/hosting`, changeFrequency: "monthly", priority: 0.9 },
        { url: `${SITE_URL}/servers`, changeFrequency: "daily", priority: 0.7 },
        { url: `${SITE_URL}/changelog`, changeFrequency: "weekly", priority: 0.6 },
        { url: `${SITE_URL}/support`, changeFrequency: "monthly", priority: 0.5 },
        ...getEnabledLocales().map(({ locale }) => ({
            url: `${SITE_URL}/cheats?lang=${locale}`,
            changeFrequency: "monthly" as const,
            priority: 0.5,
        })),
    ];
}
