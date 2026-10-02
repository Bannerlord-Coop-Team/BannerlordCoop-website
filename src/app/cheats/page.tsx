import { type CheatCommand } from "@/app/cheats/CheatsDirectory";
import { CheatsView } from "@/app/cheats/CheatsView";
import commandsData from "@/app/cheats/commands.json";
import { isPublishedCheat } from "@/app/cheats/debugOnly";
import { getCheatsLocalization } from "@/app/cheats/localization";
import { parseCheatsQuery } from "@/app/cheats/query";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { getTranslations } from "@/app/lib/localization/server";
import { getEnabledLocales } from "@/app/lib/localization/registry";
import type { Metadata } from "next";

type CheatsPageProps = {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Gives explicit cheats share links the same content language in metadata and the directory. */
export async function generateMetadata({ searchParams }: CheatsPageProps): Promise<Metadata> {
    const { locale, translator: { t }, openGraphLocale } = await getCheatsLocalization((await searchParams).lang);
    const canonical = locale === "en" ? "/cheats" : `/cheats?lang=${locale}`;

    return {
        title: t("ui.metadataTitle"),
        description: t("ui.metadataDescription"),
        alternates: {
            canonical,
            languages: Object.fromEntries(
                [...new Set([...getEnabledLocales().map((option) => option.locale), "zh-CN"])].map(
                    (language) => [language, language === "en" ? "/cheats" : `/cheats?lang=${language}`],
                ),
            ),
        },
        openGraph: {
            type: "website",
            url: canonical,
            locale: openGraphLocale,
            title: t("ui.metadataTitle"),
            description: t("ui.metadataDescription"),
        },
        twitter: {
            card: "summary_large_image",
            title: t("ui.metadataTitle"),
            description: t("ui.metadataDescription"),
        },
    };
}

const publishedCommands = commandsData.commands.filter(isPublishedCheat);

/** Delivers only cheats messages to its client subtree; chrome keeps the root cookie locale. */
export default async function CheatsPage({ searchParams }: CheatsPageProps) {
    const params = await searchParams;
    const { locale, messages } = await getCheatsLocalization(params.lang);
    const english = await getTranslations("cheats", "en");
    // Retain English-prose searching in translated views without using catalog prose as display copy.
    const commands = publishedCommands.map(({ summary: _summary, arguments: args, ...command }) => ({
        ...command,
        arguments: args.map(({ description: _description, ...argument }) => argument),
        sourceSearch: locale === "en" ? undefined : [
            english.t(`command.${command.command}.name`),
            english.t(`command.${command.command}.summary`),
            ...args.map((argument) => english.t(`command.${command.command}.argument.${argument.name}`)),
        ].join(" "),
    })) as CheatCommand[];

    return (
        <>
            <Navbar />
            <LocalizationProvider locale={locale} messages={messages}>
                <CheatsView commands={commands} initialQuery={parseCheatsQuery(params)} />
            </LocalizationProvider>
            <Footer />
        </>
    );
}
