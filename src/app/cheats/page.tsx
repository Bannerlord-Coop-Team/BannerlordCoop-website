import { type CheatCommand } from "@/app/cheats/CheatsDirectory";
import { CheatsView } from "@/app/cheats/CheatsView";
import commandsData from "@/app/cheats/commands.json";
import { isPublishedCheat } from "@/app/cheats/debugOnly";
import { HOSTING_OFFER_COOKIE, isHostingOfferHidden } from "@/app/cheats/hostingOfferCookie";
import { getCheatsLocalization } from "@/app/cheats/localization";
import { parseCheatsQuery } from "@/app/cheats/query";
import { translateCheat } from "@/app/cheats/translation";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { getTranslations } from "@/app/lib/localization/server";
import { getEnabledLocales } from "@/app/lib/localization/registry";
import type { Metadata } from "next";
import { cookies } from "next/headers";

type CheatsPageProps = {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Gives explicit cheats share links the same content language in metadata and the directory. */
export async function generateMetadata({ searchParams }: CheatsPageProps): Promise<Metadata> {
    const { locale, translator: { t }, openGraphLocale } = await getCheatsLocalization((await searchParams).lang);
    const canonical = `/cheats?lang=${locale}`;

    return {
        title: t("ui.metadataTitle"),
        description: t("ui.metadataDescription"),
        alternates: {
            canonical,
            languages: Object.fromEntries(
                [...new Set([...getEnabledLocales().map((option) => option.locale), "zh-CN"])].map(
                    (language) => [language, `/cheats?lang=${language}`],
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
    // Keep producer provenance out of client props, retaining prose for missing translations and English search.
    const commands = publishedCommands.map((command) => {
        return {
            command: command.command,
            name: command.name,
            category: command.category,
            summary: command.summary,
            usage: command.usage,
            side: command.side,
            kind: command.kind,
            aliases: command.aliases,
            arguments: command.arguments.map((argument) => ({
                name: argument.name,
                required: argument.required,
                description: argument.description,
            })),
            sourceSearch: locale === "en" ? undefined : [
                translateCheat(english.t, `command.${command.command}.summary`, command.summary),
                ...command.arguments.map((argument) => translateCheat(english.t, `command.${command.command}.argument.${argument.name}`, argument.description)),
            ].join(" "),
        };
    }) as CheatCommand[];
    // Resolving dismissal on the server keeps the first client render identical, so the offer never flashes.
    const showHostingOffer = !isHostingOfferHidden((await cookies()).get(HOSTING_OFFER_COOKIE)?.value);

    return (
        <>
            <Navbar />
            <LocalizationProvider locale={locale} messages={messages}>
                <CheatsView commands={commands} initialQuery={parseCheatsQuery(params)} showHostingOffer={showHostingOffer} />
            </LocalizationProvider>
            <Footer />
        </>
    );
}
