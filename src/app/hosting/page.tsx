import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { HOSTING_OFFER_PRICE_USD, HOSTING_OFFER_TIER, PATREON_HOSTING_CHECKOUT_URL } from "@/app/lib/hosting/patreon-checkout";
import { localizedContinentLabel, localizedRegionLabel } from "@/app/lib/hosting/region-labels";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { getLocale, getMessages, getOpenGraphLocale, getTranslations } from "@/app/lib/localization/server";
import type { Translator } from "@/app/lib/localization/types";
import { JsonLd, SITE_URL, organizationNode } from "@/app/lib/structured-data";
import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import { HOSTING_CONTINENTS, HOSTING_REGIONS } from "../../../supabase/functions/_shared/hosting-regions";

const PAGE_PATH = "/hosting";

const includedFeatures = ["official", "versions", "backups", "control", "managers", "support"] as const;
const steps = ["join", "connect", "play"] as const;
const questions = ["different", "selfHost", "friends", "saves", "mods"] as const;

/** Formats the tier price as whole US dollars in the request locale. */
function formatPrice(number: Translator["number"]): string {
    return number(HOSTING_OFFER_PRICE_USD, { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Gives the hosting landing page its own search title, description and canonical URL. */
export async function generateMetadata(): Promise<Metadata> {
    const { t, number } = await getTranslations("hosting");
    const title = t("metadata.title");
    const description = t("metadata.description", { price: formatPrice(number) });
    return {
        title: { absolute: title },
        description,
        alternates: { canonical: PAGE_PATH },
        openGraph: {
            type: "website",
            locale: await getOpenGraphLocale(),
            url: PAGE_PATH,
            siteName: "Bannerlord Co-op",
            title,
            description,
            images: [{ url: "/images/banner.png", width: 1200, height: 630, alt: "Bannerlord Co-op" }],
        },
        twitter: { card: "summary_large_image", title, description, images: ["/images/banner.png"] },
    };
}

/** Patreon checkout button; the screen-reader note says it leaves the site. */
function CheckoutLink({ label, newTab }: { label: string; newTab: string }) {
    return (
        <a
            href={PATREON_HOSTING_CHECKOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-sm border border-crimson bg-crimson px-6 font-label text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors duration-200 hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto [&:lang(zh-CN)]:normal-case [&:lang(zh-CN)]:tracking-normal"
        >
            {label}
            <span className="sr-only">{` ${newTab}`}</span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </a>
    );
}

/** Landing page for managed hosting: what a rented Co-op server includes and how to get one. */
export default async function HostingPage() {
    const locale = await getLocale();
    const [messages, { t, rich, number }, servers] = await Promise.all([
        getMessages(["hosting"], locale),
        getTranslations("hosting", locale),
        getTranslations("servers", locale),
    ]);
    const price = formatPrice(number);
    const regionGroups = HOSTING_CONTINENTS
        .map((continent) => ({ continent, regions: HOSTING_REGIONS.filter((region) => region.continent === continent) }))
        .filter((group) => group.regions.length > 0);

    const structuredData = {
        "@graph": [
            organizationNode,
            {
                "@type": "Product",
                "@id": `${SITE_URL}${PAGE_PATH}#hosting`,
                name: t("hero.heading"),
                description: t("metadata.description", { price }),
                url: `${SITE_URL}${PAGE_PATH}`,
                image: `${SITE_URL}/images/banner.png`,
                brand: { "@id": organizationNode["@id"] },
                offers: {
                    "@type": "Offer",
                    url: `${SITE_URL}${PAGE_PATH}`,
                    price: HOSTING_OFFER_PRICE_USD.toFixed(2),
                    priceCurrency: "USD",
                    availability: "https://schema.org/InStock",
                    seller: { "@id": organizationNode["@id"] },
                    priceSpecification: {
                        "@type": "UnitPriceSpecification",
                        price: HOSTING_OFFER_PRICE_USD.toFixed(2),
                        priceCurrency: "USD",
                        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
                    },
                },
            },
            {
                "@type": "FAQPage",
                mainEntity: questions.map((question) => ({
                    "@type": "Question",
                    name: t(`faq.${question}.question`),
                    acceptedAnswer: { "@type": "Answer", text: t(`faq.${question}.answer`) },
                })),
            },
        ],
    };

    return (
        <LocalizationProvider locale={locale} messages={messages}>
            <JsonLd data={structuredData} />
            <Navbar />
            <main className="min-h-svh bg-background">
                <section className="relative isolate overflow-hidden border-b border-white/10" aria-labelledby="hosting-heading">
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_78%_32%,rgba(170,151,96,0.11),transparent_28%),radial-gradient(circle_at_18%_90%,rgba(143,29,35,0.1),transparent_30%)]"
                    />
                    <div className="site-container grid gap-10 py-16 sm:py-20 lg:grid-cols-12 lg:items-center lg:gap-12 lg:py-24">
                        <div className="lg:col-span-7">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.24em] text-gold">{t("hero.eyebrow")}</p>
                            <h1
                                id="hosting-heading"
                                className="mt-4 max-w-4xl font-display text-5xl font-semibold leading-[0.95] text-foreground sm:text-6xl lg:text-7xl"
                            >
                                {t("hero.heading")}
                            </h1>
                            <p className="mt-7 max-w-2xl text-sm leading-7 text-foreground-muted sm:text-base">{t("hero.description")}</p>
                        </div>

                        <aside className="border border-white/10 bg-surface px-6 py-7 sm:px-8 lg:col-span-5" aria-label={t("hero.cta")}>
                            <p className="flex items-baseline gap-1 text-sm text-foreground-muted">
                                {rich("hero.price", {
                                    price: <span className="font-display text-5xl font-semibold leading-none lining-nums text-foreground">{price}</span>,
                                })}
                            </p>
                            <p className="mt-2 font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground-muted">
                                {rich("hero.tier", { tier: <span className="text-gold">{HOSTING_OFFER_TIER}</span> })}
                            </p>
                            <div className="mt-6">
                                <CheckoutLink label={t("hero.cta")} newTab={t("hero.newTab")} />
                            </div>
                            <p className="mt-3 text-xs text-foreground-muted">{t("hero.finePrint")}</p>
                        </aside>
                    </div>
                </section>

                <section className="border-b border-white/10 bg-surface" aria-labelledby="included-heading">
                    <div className="site-container py-14 sm:py-18 lg:py-20">
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">{t("included.eyebrow")}</p>
                        <h2 id="included-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                            {t("included.heading")}
                        </h2>
                        <ul className="mt-10 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
                            {includedFeatures.map((feature) => (
                                <li key={feature} className="bg-surface-raised px-5 py-6 sm:px-6">
                                    <span aria-hidden="true" className="flex size-5 items-center justify-center border border-gold/45 bg-gold/10 text-gold">
                                        <Check className="size-3.5" strokeWidth={3} />
                                    </span>
                                    <h3 className="mt-4 font-display text-xl font-semibold text-foreground">{t(`included.${feature}.title`)}</h3>
                                    <p className="mt-2 text-sm leading-6 text-foreground-muted">{t(`included.${feature}.description`)}</p>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                <section className="border-b border-white/10" aria-labelledby="steps-heading">
                    <div className="site-container grid gap-12 py-14 sm:py-18 lg:grid-cols-12 lg:py-20">
                        <div className="lg:col-span-7">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">{t("steps.eyebrow")}</p>
                            <h2 id="steps-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                                {t("steps.heading")}
                            </h2>
                            <ol className="mt-8 space-y-6">
                                {steps.map((step, index) => (
                                    <li key={step} className="flex gap-5">
                                        <span aria-hidden="true" className="font-display text-3xl font-semibold leading-none text-gold lining-nums">
                                            {number(index + 1)}
                                        </span>
                                        <div>
                                            <h3 className="font-display text-xl font-semibold text-foreground">{t(`steps.${step}.title`)}</h3>
                                            <p className="mt-1.5 text-sm leading-6 text-foreground-muted">{t(`steps.${step}.description`, { price })}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </div>

                        <div className="lg:col-span-5" aria-labelledby="regions-heading" role="region">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">{t("regions.eyebrow")}</p>
                            <h2 id="regions-heading" className="mt-3 font-display text-3xl font-semibold text-foreground sm:text-4xl">
                                {t("regions.heading")}
                            </h2>
                            <p className="mt-3 text-sm leading-6 text-foreground-muted">{t("regions.description")}</p>
                            <dl className="mt-6 divide-y divide-white/10 border border-white/10 bg-surface">
                                {regionGroups.map(({ continent, regions }) => (
                                    <div key={continent} className="px-5 py-4">
                                        <dt className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-gold">
                                            {localizedContinentLabel(servers.t, continent)}
                                        </dt>
                                        <dd className="mt-1.5 text-sm leading-6 text-foreground">
                                            {regions.map((region) => localizedRegionLabel(servers.t, region.key)).join(" · ")}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    </div>
                </section>

                <section className="border-b border-white/10 bg-surface" aria-labelledby="faq-heading">
                    <div className="site-container py-14 sm:py-18 lg:py-20">
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">{t("faq.eyebrow")}</p>
                        <h2 id="faq-heading" className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
                            {t("faq.heading")}
                        </h2>
                        <dl className="mt-10 grid gap-px border border-white/10 bg-white/10 lg:grid-cols-2">
                            {questions.map((question) => (
                                <div key={question} className="bg-surface-raised px-5 py-6 sm:px-6 lg:last:odd:col-span-2">
                                    <dt className="font-display text-xl font-semibold text-foreground">{t(`faq.${question}.question`)}</dt>
                                    <dd className="mt-2 text-sm leading-6 text-foreground-muted">{t(`faq.${question}.answer`)}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </section>

                <section aria-labelledby="hosting-cta-heading">
                    <div className="site-container flex flex-col gap-6 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
                        <div className="max-w-2xl">
                            <h2 id="hosting-cta-heading" className="font-display text-4xl font-semibold text-foreground sm:text-5xl">
                                {t("cta.heading")}
                            </h2>
                            <p className="mt-3 text-sm leading-7 text-foreground-muted sm:text-base">{t("cta.description")}</p>
                        </div>
                        <CheckoutLink label={t("hero.cta")} newTab={t("hero.newTab")} />
                    </div>
                </section>
            </main>
            <Footer />
        </LocalizationProvider>
    );
}
