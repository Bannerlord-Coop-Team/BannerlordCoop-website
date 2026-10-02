import { getTranslations } from "@/app/lib/localization/server";
import { GitPullRequestArrow, Swords } from "lucide-react";
import Link from "next/link";

const navigationLinks = [
    {
        label: "footer.features",
        href: "/#features",
    },
    {
        label: "footer.videos",
        href: "/#media",
    },
    {
        label: "footer.about",
        href: "/#about",
    },
    {
        label: "download.trigger",
        href: "/#download",
    },
    {
        label: "nav.cheats",
        href: "/cheats",
    },
    {
        label: "nav.changelog",
        href: "/changelog",
    }
];

const communityLinks = [
    {
        label: "Discord",
        href: "https://discord.gg/bannerlordcoop",
        external: true,
    },
    {
        label: "GitHub",
        href: "https://github.com/Bannerlord-Coop-Team/BannerlordCoop",
        external: true,
    },
];

/** Renders shared translated footer prose while retaining brand names and external destinations. */
export async function Footer() {
    const { t, number } = await getTranslations("common");
    return (
        <footer className="border-t border-white/10 bg-background">
            <div className="site-container">
                <div className="grid grid-cols-2 gap-x-6 gap-y-10 py-12 sm:gap-x-12 sm:py-14 lg:grid-cols-12 lg:items-start lg:py-16">
                    <div className="col-span-2 lg:col-span-6">
                        <Link
                            href="/"
                            aria-label={t("nav.homeLabel")}
                            className="inline-flex max-w-full items-center gap-1 text-foreground transition-colors duration-300 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                        >
                            <span className="flex size-10 items-center justify-center text-gold">
                                <Swords
                                    aria-hidden="true"
                                    className="size-6"
                                    strokeWidth={1.5}
                                />
                            </span>

                            <span className="font-display text-xl font-semibold uppercase tracking-[0.04em] sm:text-2xl">
                                Bannerlord Coop
                            </span>
                        </Link>

                        <p className="mt-5 max-w-md font-sans text-sm leading-6 text-foreground-muted">
                            {t("metadata.description")}
                        </p>
                    </div>

                    <nav
                        className="lg:col-span-3"
                        aria-label={t("footer.navigation")}
                    >
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                            {t("footer.explore")}
                        </p>

                        <ul className="mt-5 space-y-3">
                            {navigationLinks.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="font-sans text-sm text-foreground-muted transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                                    >
                                        {t(link.label)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    <nav
                        className="lg:col-span-3"
                        aria-label={t("footer.communityLinks")}
                    >
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                            {t("nav.community")}
                        </p>

                        <ul className="mt-5 space-y-3">
                            {communityLinks.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        target={link.external ? "_blank" : undefined}
                                        rel={link.external ? "noopener noreferrer" : undefined}
                                        className="inline-flex items-center gap-2 font-sans text-sm text-foreground-muted transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                                    >
                                        {link.label}

                                        {link.label === "GitHub" && (
                                            <GitPullRequestArrow
                                                aria-hidden="true"
                                                className="size-3.5"
                                                strokeWidth={1.5}
                                            />
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>

                <div className="flex flex-col gap-4 border-t border-white/10 py-6 sm:flex-row sm:items-center sm:justify-between">
                    <p className="font-sans text-xs leading-5 text-foreground-dim">
                        {t("footer.copyright", { year: number(new Date().getUTCFullYear(), { useGrouping: false }) })}
                    </p>

                    <p className="max-w-xl font-sans text-xs leading-5 text-foreground-dim sm:text-right">
                        {t("footer.disclaimer")}
                    </p>
                </div>
            </div>
        </footer>
    );
}

