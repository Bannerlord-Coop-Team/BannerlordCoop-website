import { ReleaseNotes } from "@/app/changelog/ReleaseNotes.tsx";
import { Footer } from "@/app/components/layout/Footer.tsx";
import { Navbar } from "@/app/components/layout/Navbar.tsx";
import {
    GITHUB_RELEASES_URL,
    getGitHubReleases,
} from "@/app/lib/github-releases.ts";
import { ArrowUpRight, CalendarDays, GitBranch } from "lucide-react";
import type { Metadata } from "next";
import { LocalizationProvider } from "@/app/lib/localization/client";
import { getLocale, getMessages, getTranslations } from "@/app/lib/localization/server";
import type { Translator } from "@/app/lib/localization/types";

/** Resolves page metadata from the same explicit locale as the page content. */
export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getTranslations("changelog");
    return {
        title: t("metadata.title"),
        description: t("metadata.description"),
    };
}

/** Localizes release presentation while retaining GitHub content and release links unchanged. */
export default async function ChangelogPage() {
    const locale = await getLocale();
    const [translator, messages, { releases, isAvailable }] = await Promise.all([
        getTranslations("changelog", locale),
        getMessages(["changelog"], locale),
        getGitHubReleases(),
    ]);
    const { t, number } = translator;

    return (
        <LocalizationProvider locale={locale} messages={messages}>
            <Navbar />

            <main className="min-h-svh bg-background">
                <section
                    className="relative isolate overflow-hidden border-b border-white/10"
                    aria-labelledby="changelog-heading"
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
                                id="changelog-heading"
                                className="mt-4 max-w-4xl font-display text-5xl font-semibold leading-[0.95] text-foreground sm:text-6xl lg:text-7xl"
                            >
                                {t("hero.title")}
                            </h1>

                            <p className="mt-7 max-w-3xl text-sm leading-7 text-foreground-muted sm:text-base">
                                {t("hero.description")}
                            </p>
                        </div>

                        <div className="lg:col-span-4 lg:flex lg:justify-end">
                            <a
                                href={GITHUB_RELEASES_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm border border-gold/40 bg-surface/70 px-5 font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                {t("links.githubReleases")}
                                <ArrowUpRight
                                    aria-hidden="true"
                                    className="size-4"
                                    strokeWidth={1.75}
                                />
                            </a>
                        </div>
                    </div>
                </section>

                <section
                    className="bg-surface"
                    aria-labelledby="release-history-heading"
                >
                    <div className="site-container py-16 sm:py-20 lg:py-24">
                        <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
                            <div className="lg:col-span-3">
                                <div className="lg:sticky lg:top-8">
                                    <p className="font-label text-xs font-semibold uppercase tracking-[0.22em] text-gold">
                                        {t("history.eyebrow")}
                                    </p>

                                    <h2
                                        id="release-history-heading"
                                        className="mt-3 font-display text-4xl font-semibold leading-tight text-foreground"
                                    >
                                        {t("history.title")}
                                    </h2>

                                    <p className="mt-5 text-sm leading-7 text-foreground-muted">
                                        {t("history.description")}
                                    </p>

                                    {releases.length > 0 && (
                                        <p className="mt-7 border-t border-white/10 pt-5 font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground-dim">
                                            {t("history.count", {
                                                count: releases.length,
                                                formattedCount: number(releases.length),
                                            })}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="lg:col-span-9">
                                {!isAvailable ? (
                                    <UnavailableState t={t} />
                                ) : releases.length === 0 ? (
                                    <EmptyState t={t} />
                                ) : (
                                    <ol className="space-y-8">
                                        {releases.map((release, index) => (
                                            <li key={release.id}>
                                                <article
                                                    className="border border-white/10 bg-background"
                                                    aria-labelledby={`release-${release.id}`}
                                                >
                                                    <div className="border-b border-white/10 px-6 py-6 sm:px-8 sm:py-7">
                                                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                                                            <div>
                                                                <div className="flex flex-wrap items-center gap-3">
                                                                    <span className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                                                                        {index === 0
                                                                            ? t("release.latest")
                                                                            : t("release.label")}
                                                                    </span>

                                                                    {release.prerelease && (
                                                                        <span className="border border-crimson/50 bg-crimson/10 px-2.5 py-1 font-label text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-foreground">
                                                                            {t("release.prerelease")}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <h3
                                                                    id={`release-${release.id}`}
                                                                    className="mt-3 font-display text-3xl font-semibold leading-tight text-foreground sm:text-4xl"
                                                                >
                                                                    {release.name}
                                                                </h3>
                                                            </div>

                                                            <span className="inline-flex w-fit items-center gap-2 border border-gold/25 bg-surface px-3 py-2 font-label text-xs font-semibold tracking-[0.12em] text-gold">
                                                                <GitBranch
                                                                    aria-hidden="true"
                                                                    className="size-3.5"
                                                                    strokeWidth={1.75}
                                                                />
                                                                {release.tagName}
                                                            </span>
                                                        </div>

                                                        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-foreground-dim">
                                                            <time
                                                                dateTime={
                                                                    release.publishedAt
                                                                }
                                                                className="inline-flex items-center gap-2"
                                                            >
                                                                <CalendarDays
                                                                    aria-hidden="true"
                                                                    className="size-4 text-gold-muted"
                                                                    strokeWidth={1.5}
                                                                />
                                                                {formatReleasePublication(
                                                                    release.publishedAt,
                                                                    translator,
                                                                )}
                                                            </time>

                                                            {release.author && (
                                                                <span>
                                                                    {t("release.author", { author: release.author })}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="px-6 py-7 sm:px-8 sm:py-9">
                                                        <ReleaseNotes
                                                            body={release.body}
                                                            emptyMessage={t("release.emptyNotes")}
                                                        />

                                                        <div className="mt-8 border-t border-white/10 pt-6">
                                                            <a
                                                                href={release.href}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.16em] text-gold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                                                            >
                                                                {t("links.fullRelease")}
                                                                <ArrowUpRight
                                                                    aria-hidden="true"
                                                                    className="size-4"
                                                                    strokeWidth={1.75}
                                                                />
                                                            </a>
                                                        </div>
                                                    </div>
                                                </article>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <Footer />
        </LocalizationProvider>
    );
}

/** Presents a translated GitHub availability failure without changing retry or fetch behavior. */
function UnavailableState({ t }: Pick<Translator, "t">) {
    return (
        <div
            className="border border-white/10 bg-background px-6 py-12 text-center sm:px-10"
            role="status"
        >
            <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                {t("unavailable.eyebrow")}
            </p>

            <h3 className="mt-3 font-display text-3xl font-semibold text-foreground">
                {t("unavailable.title")}
            </h3>

            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-foreground-muted">
                {t("unavailable.description")}
            </p>

            <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 border border-gold/40 px-5 font-label text-xs font-semibold uppercase tracking-[0.16em] text-gold transition-colors hover:border-gold hover:text-foreground"
            >
                {t("links.openGithubReleases")}
                <ArrowUpRight
                    aria-hidden="true"
                    className="size-4"
                    strokeWidth={1.75}
                />
            </a>
        </div>
    );
}

/** Presents the translated empty release history with its existing accessible status role. */
function EmptyState({ t }: Pick<Translator, "t">) {
    return (
        <div
            className="border border-white/10 bg-background px-6 py-12 text-center sm:px-10"
            role="status"
        >
            <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                {t("empty.eyebrow")}
            </p>

            <h3 className="mt-3 font-display text-3xl font-semibold text-foreground">
                {t("empty.title")}
            </h3>

            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-foreground-muted">
                {t("empty.description")}
            </p>
        </div>
    );
}

/** Formats a whole publication message, including invalid dates, in the selected locale. */
function formatReleasePublication(value: string, translator: Translator): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return translator.t("release.publishedUnknown");
    }

    return translator.t("release.published", {
        date: translator.date(date, { day: "numeric", month: "long", year: "numeric" }),
    });
}
