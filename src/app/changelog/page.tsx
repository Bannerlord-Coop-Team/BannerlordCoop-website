import { ReleaseNotes } from "@/app/changelog/ReleaseNotes.tsx";
import { Footer } from "@/app/components/layout/Footer.tsx";
import { Navbar } from "@/app/components/layout/Navbar.tsx";
import {
    GITHUB_RELEASES_URL,
    getGitHubReleases,
} from "@/app/lib/github-releases.ts";
import { ArrowUpRight, CalendarDays, GitBranch } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Changelog",
    description:
        "Read the latest Bannerlord Coop releases, improvements, and bug fixes.",
};

const dateFormatter = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
});

export default async function ChangelogPage() {
    const { releases, isAvailable } = await getGitHubReleases();

    return (
        <>
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
                                Development updates
                            </p>

                            <h1
                                id="changelog-heading"
                                className="mt-4 max-w-4xl font-display text-5xl font-semibold leading-[0.95] text-foreground sm:text-6xl lg:text-7xl"
                            >
                                Bannerlord Coop Changelog
                            </h1>

                            <p className="mt-7 max-w-3xl text-sm leading-7 text-foreground-muted sm:text-base">
                                Here are all the latest versions, gameplay improvements, technical changes, and fixes published by the Bannerlord Coop development team.
                            </p>
                        </div>

                        <div className="lg:col-span-4 lg:flex lg:justify-end">
                            <a
                                href={GITHUB_RELEASES_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm border border-gold/40 bg-surface/70 px-5 font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                View releases on GitHub
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
                                        Release history
                                    </p>

                                    <h2
                                        id="release-history-heading"
                                        className="mt-3 font-display text-4xl font-semibold leading-tight text-foreground"
                                    >
                                        What changed?
                                    </h2>

                                    <p className="mt-5 text-sm leading-7 text-foreground-muted">
                                        Release information is loaded directly from
                                        the project&apos;s public GitHub repository
                                        and refreshed every hour.
                                    </p>

                                    {releases.length > 0 && (
                                        <p className="mt-7 border-t border-white/10 pt-5 font-label text-xs font-semibold uppercase tracking-[0.16em] text-foreground-dim">
                                            Showing {releases.length}{" "}
                                            {releases.length === 1
                                                ? "release"
                                                : "releases"}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="lg:col-span-9">
                                {!isAvailable ? (
                                    <UnavailableState />
                                ) : releases.length === 0 ? (
                                    <EmptyState />
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
                                                                            ? "Latest release"
                                                                            : "Release"}
                                                                    </span>

                                                                    {release.prerelease && (
                                                                        <span className="border border-crimson/50 bg-crimson/10 px-2.5 py-1 font-label text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-foreground">
                                                                            Pre-release
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
                                                                Published{" "}
                                                                {formatReleaseDate(
                                                                    release.publishedAt,
                                                                )}
                                                            </time>

                                                            {release.author && (
                                                                <span>
                                                                    By {release.author}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="px-6 py-7 sm:px-8 sm:py-9">
                                                        <ReleaseNotes
                                                            body={release.body}
                                                        />

                                                        <div className="mt-8 border-t border-white/10 pt-6">
                                                            <a
                                                                href={release.href}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-2 font-label text-xs font-semibold uppercase tracking-[0.16em] text-gold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                                                            >
                                                                View full release
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
        </>
    );
}

function UnavailableState() {
    return (
        <div
            className="border border-white/10 bg-background px-6 py-12 text-center sm:px-10"
            role="status"
        >
            <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                GitHub unavailable
            </p>

            <h3 className="mt-3 font-display text-3xl font-semibold text-foreground">
                The changelog could not be loaded.
            </h3>

            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-foreground-muted">
                GitHub may be temporarily unavailable or the API request may have
                reached its rate limit. You can still view the releases directly on
                GitHub.
            </p>

            <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 border border-gold/40 px-5 font-label text-xs font-semibold uppercase tracking-[0.16em] text-gold transition-colors hover:border-gold hover:text-foreground"
            >
                Open GitHub releases
                <ArrowUpRight
                    aria-hidden="true"
                    className="size-4"
                    strokeWidth={1.75}
                />
            </a>
        </div>
    );
}

function EmptyState() {
    return (
        <div
            className="border border-white/10 bg-background px-6 py-12 text-center sm:px-10"
            role="status"
        >
            <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                No releases yet
            </p>

            <h3 className="mt-3 font-display text-3xl font-semibold text-foreground">
                The release history is currently empty.
            </h3>

            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-foreground-muted">
                Published GitHub releases will automatically appear here.
            </p>
        </div>
    );
}

function formatReleaseDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "on an unknown date";
    }

    return dateFormatter.format(date);
}