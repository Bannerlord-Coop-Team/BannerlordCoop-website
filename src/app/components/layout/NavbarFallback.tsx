import { getTranslations } from "@/app/lib/localization/server";

/** Holds the navbar's height and announces its own localized loading label while the viewer-dependent navbar streams in. */
export async function NavbarFallback() {
    const { t } = await getTranslations("common");
    return <div role="status" aria-label={t("nav.loading")} className="h-16 border-b border-white/10 bg-background" />;
}
