import type { Translator } from "@/app/lib/localization/types";
import { hostingRegionLabel, isHostingRegionKey, type HostingContinent } from "../../../../supabase/functions/_shared/hosting-regions";

/** Localized region name from a `servers` translator: `region.<key>` for website catalog keys, else the English fallback label. */
export function localizedRegionLabel(t: Translator["t"], region: string): string {
    if (!isHostingRegionKey(region)) return hostingRegionLabel(region);
    return t(`region.${region}`);
}

/** Localized continent name from a `servers` translator. */
export function localizedContinentLabel(t: Translator["t"], continent: HostingContinent): string {
    return t(`continent.${continent}`);
}
