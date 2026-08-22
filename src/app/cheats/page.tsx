import { type CheatCommand } from "@/app/cheats/CheatsDirectory";
import { CheatsView } from "@/app/cheats/CheatsView";
import commandsData from "@/app/cheats/commands.json";
import { isPublishedCheat } from "@/app/cheats/debugOnly";
import { CHEATS_LOCALE_COOKIE, parseCheatsLocale } from "@/app/cheats/locale";
import { getCheatsMessages } from "@/app/cheats/locales";
import { parseCheatsQuery } from "@/app/cheats/query";
import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import type { Metadata } from "next";
import { cookies } from "next/headers";

type CheatsPageProps = {
    searchParams: Promise<{
        q?: string;
        tab?: string;
        type?: string;
        side?: string;
        cheat?: string;
        lang?: string;
    }>;
};

function first(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value[0];
    return value;
}

async function resolveCheatsLocale(searchParams: CheatsPageProps["searchParams"]) {
    const params = await searchParams;
    const cookieStore = await cookies();
    return parseCheatsLocale(first(params.lang) || cookieStore.get(CHEATS_LOCALE_COOKIE)?.value);
}

export async function generateMetadata({ searchParams }: CheatsPageProps): Promise<Metadata> {
    const locale = await resolveCheatsLocale(searchParams);
    const { ui } = getCheatsMessages(locale);

    return {
        title: ui.metadataTitle,
        description: ui.metadataDescription,
        alternates: {
            languages: {
                en: "/cheats",
                "zh-CN": "/cheats?lang=zh-CN",
            },
        },
    };
}

const publishedCommands = (commandsData.commands as CheatCommand[]).filter(isPublishedCheat);

export default async function CheatsPage({ searchParams }: CheatsPageProps) {
    const params = await searchParams;
    const cookieStore = await cookies();
    const initialQuery = parseCheatsQuery({
        ...params,
        lang: first(params.lang) || cookieStore.get(CHEATS_LOCALE_COOKIE)?.value,
    });

    return (
        <>
            <Navbar />
            <CheatsView commands={publishedCommands} initialQuery={initialQuery} />
            <Footer />
        </>
    );
}
