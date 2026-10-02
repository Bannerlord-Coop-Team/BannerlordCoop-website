import { PageLoadingState } from "@/app/components/ui/PageLoadingState";

import { getTranslations } from "@/app/lib/localization/server";

/** Presents the global loading status in the explicitly selected locale. */
export default async function Loading() {
    const { t } = await getTranslations("common");
    return (
        <PageLoadingState label={t("loading.site")} fullScreen/>
    );
}