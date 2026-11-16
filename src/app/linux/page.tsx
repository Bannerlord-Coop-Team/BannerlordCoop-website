import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { getLocale, getOpenGraphLocale } from "@/app/lib/localization/server";
import { JsonLd, SITE_URL, organizationNode } from "@/app/lib/structured-data";
import type { Metadata } from "next";
import { LinuxGuide } from "./LinuxGuide";
import { guidePack } from "./messages";

const PAGE_PATH = "/linux";

/** Search title and description follow the site locale. Artwork stays the site banner. */
export async function generateMetadata(): Promise<Metadata> {
    const locale = await getLocale();
    const pack = guidePack(locale);
    return {
        title: { absolute: pack.title },
        description: pack.description,
        alternates: { canonical: PAGE_PATH },
        openGraph: {
            type: "article",
            locale: await getOpenGraphLocale(),
            url: PAGE_PATH,
            siteName: "Bannerlord Co-op",
            title: pack.title,
            description: pack.description,
            images: [{ url: "/images/banner.png", width: 1200, height: 630, alt: "Bannerlord Co-op" }],
        },
        twitter: {
            card: "summary_large_image",
            title: pack.title,
            description: pack.description,
            images: ["/images/banner.png"],
        },
    };
}

/** Linux setup guide, inside the site header and footer. */
export default async function LinuxPage() {
    const locale = await getLocale();
    const pack = guidePack(locale);
    return (
        <>
            <JsonLd
                data={{
                    "@graph": [
                        organizationNode,
                        {
                            "@type": "TechArticle",
                            "@id": `${SITE_URL}${PAGE_PATH}#guide`,
                            headline: pack.title,
                            description: pack.description,
                            inLanguage: locale,
                            url: `${SITE_URL}${PAGE_PATH}`,
                            about: "Mount & Blade II: Bannerlord Co-op mod",
                            isPartOf: { "@id": `${SITE_URL}/#organization` },
                        },
                    ],
                }}
            />
            <Navbar />
            <LinuxGuide pack={pack} />
            <Footer />
        </>
    );
}
