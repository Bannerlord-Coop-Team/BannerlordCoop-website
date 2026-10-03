import type { Metadata } from "next";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { getLocale, getMessages, getTranslations } from "@/app/lib/localization/server";
import ServerWireframe from "./ServerWireframe";

/** Localizes public demo metadata while preserving its no-index policy. */
export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getTranslations("server-wireframe");
    return {
        title: t("metadata.title"),
        description: t("metadata.description"),
        robots: { index: false, follow: false },
    };
}

/** Delivers only this route's messages to the interactive public demo. */
export default async function ServerWireframePage() {
    const locale = await getLocale();
    const messages = await getMessages(["server-wireframe"], locale);
    return <LocalizationProvider locale={locale} messages={messages}><ServerWireframe /></LocalizationProvider>;
}
