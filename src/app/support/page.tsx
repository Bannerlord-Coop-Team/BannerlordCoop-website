import { Footer } from "@/app/components/layout/Footer";
import { Navbar } from "@/app/components/layout/Navbar";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { getLocale, getMessages, getTranslations } from "@/app/lib/localization/server";
import type { Metadata } from "next";

/** Resolves support metadata from the same explicit locale as the page. */
export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getTranslations("support");
    return {
        title: t("metadata.title"),
        description: t("metadata.description"),
    };
}

const supportOptions = [
    {
        name: "Patreon",
        descriptionKey: "options.patreon.description",
        href: "https://www.patreon.com/c/bannerlordcoop",
    },
    {
        name: "Buy Me a Coffee",
        descriptionKey: "options.buyMeACoffee.description",
        href: "https://buymeacoffee.com/bannerlordcoop",
    },
    {
        name: "PayPal",
        descriptionKey: "options.paypal.description",
        href: "https://www.paypal.com/donate/?hosted_button_id=KHBSK4FXQ9GKS",
    },
    {
        name: "Afdian (爱发电)",
        descriptionKey: "options.afdian.description",
        href: "https://ifdian.net/a/BannerlordCoop",
    },
    {
        name: "Boosty",
        descriptionKey: "options.boosty.description",
        href: "https://boosty.to/bannerlordcoop/donate",
    },
] as const;

const projectExpenses = ["development", "hosting", "servers", "distribution", "other"] as const;

const otherWaysToHelp = ["play", "report", "create", "share"] as const;

/** Renders all support prose in the request locale while preserving contribution destinations. */
export default async function SupportPage() {
    const locale = await getLocale();
    const messages = await getMessages(["support"], locale);
    const { t } = await getTranslations("support", locale);
    return (
        <LocalizationProvider locale={locale} messages={messages}>
            <Navbar />
            <main className="min-h-svh bg-background">
                <section
                    className="relative isolate overflow-hidden border-b border-white/10"
                    aria-labelledby="support-heading"
                >
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_78%_32%,rgba(170,151,96,0.11),transparent_28%),radial-gradient(circle_at_18%_90%,rgba(143,29,35,0.1),transparent_30%)]"
                    />
                    <div className="site-container grid gap-10 py-16 sm:py-20 lg:grid-cols-12 lg:items-end lg:gap-12 lg:py-24">
                        <div className="lg:col-span-8">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.24em] text-gold">
                                {t("hero.eyebrow")}
                            </p>
                            <h1
                                id="support-heading"
                                className="mt-4 max-w-4xl font-display text-5xl font-semibold leading-[0.95] text-foreground sm:text-6xl lg:text-7xl"
                            >
                                {t("hero.heading")}
                            </h1>
                            <ul className="mt-8 max-w-3xl divide-y divide-white/10 border border-white/10 bg-surface/75">
                                {supportOptions.map((option) => (
                                    <li key={option.name}>
                                        <a
                                            href={option.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="group flex min-h-18 items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-gold/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold sm:px-6"
                                        >
                                            <span className="min-w-0">
                                                <span className="block font-display text-2xl font-semibold text-foreground transition-colors group-hover:text-gold">
                                                    {option.name}
                                                </span>
                                                <span className="mt-1 block text-sm leading-5 text-foreground-muted">
                                                    {t(option.descriptionKey)}
                                                </span>
                                            </span>
                                            <span aria-hidden="true" className="shrink-0 font-display text-2xl text-gold">
                                                ↗
                                            </span>
                                            <span className="sr-only">{t("options.newTab")}</span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-8 max-w-2xl font-display text-2xl leading-8 text-foreground sm:text-3xl sm:leading-10">
                                {t("hero.promise")}
                            </p>
                            <p className="mt-5 max-w-2xl text-sm leading-7 text-foreground-muted sm:text-base">
                                {t("hero.description")}
                            </p>
                        </div>

                        <aside className="border-l-2 border-gold bg-gold/[0.06] px-6 py-6 lg:col-span-4 lg:px-7 lg:py-8">
                            <span
                                aria-hidden="true"
                                className="block size-5 rotate-45 border border-gold/60 bg-gold/10"
                            />
                            <p className="mt-5 font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                                {t("community.eyebrow")}
                            </p>
                            <p className="mt-3 font-display text-2xl font-semibold leading-8 text-foreground">
                                {t("community.description")}
                            </p>
                        </aside>
                    </div>
                </section>

                <section
                    className="border-b border-white/10 bg-surface"
                    aria-labelledby="expenses-heading"
                >
                    <div className="site-container py-14 sm:py-18 lg:py-20">
                        <div className="max-w-3xl">
                            <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                {t("expenses.eyebrow")}
                            </p>
                            <h2
                                id="expenses-heading"
                                className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl"
                            >
                                {t("expenses.heading")}
                            </h2>
                            <p className="mt-4 text-sm leading-7 text-foreground-muted sm:text-base">
                                {t("expenses.description")}
                            </p>
                        </div>

                        <ul className="mt-10 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
                            {projectExpenses.map((expense) => (
                                <li
                                    key={expense}
                                    className="bg-surface-raised px-5 py-6 sm:px-6"
                                >
                                    <span
                                        aria-hidden="true"
                                        className="block size-2 rotate-45 bg-gold-muted"
                                    />
                                    <h3 className="mt-5 font-display text-xl font-semibold text-foreground">
                                        {t(`expenses.${expense}.label`)}
                                    </h3>
                                    <p className="mt-2 text-sm leading-6 text-foreground-muted">
                                        {t(`expenses.${expense}.detail`)}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                <section
                    className="border-t border-white/10 bg-surface"
                    aria-labelledby="other-support-heading"
                >
                    <div className="site-container py-16 sm:py-20">
                        <div className="grid overflow-hidden border border-gold/20 bg-background lg:grid-cols-12">
                            <div className="border-b border-gold/20 px-6 py-8 sm:px-10 sm:py-10 lg:col-span-7 lg:border-r lg:border-b-0 lg:px-12 lg:py-12">
                                <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                    {t("otherSupport.eyebrow")}
                                </p>
                                <h2
                                    id="other-support-heading"
                                    className="mt-3 font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl"
                                >
                                    {t("otherSupport.heading")}
                                </h2>
                                <p className="mt-5 max-w-2xl text-sm leading-7 text-foreground-muted sm:text-base">
                                    {t("otherSupport.description")}
                                </p>
                            </div>

                            <div className="flex flex-col justify-between px-6 py-8 sm:px-10 sm:py-10 lg:col-span-5 lg:px-12 lg:py-12">
                                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                                    {otherWaysToHelp.map((way) => (
                                        <li
                                            key={way}
                                            className="flex items-center gap-3 text-sm text-foreground-muted"
                                        >
                                            <span
                                                aria-hidden="true"
                                                className="size-1.5 shrink-0 rotate-45 bg-gold"
                                            />
                                            {t(`otherSupport.${way}`)}
                                        </li>
                                    ))}
                                </ul>

                                <p className="mt-10 border-t border-white/10 pt-7 font-display text-2xl font-semibold leading-8 text-foreground">
                                    {t("otherSupport.thanks")}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
            <Footer />
        </LocalizationProvider>
    );
}
