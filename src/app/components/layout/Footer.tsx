import { GitPullRequestArrow, Swords } from "lucide-react";
import Link from "next/link";

const navigationLinks = [
    {
        label: "Features",
        href: "/#features",
    },
    {
        label: "Videos",
        href: "/#media",
    },
    {
        label: "About",
        href: "/#about",
    },
    {
        label: "Download",
        href: "/#download",
    },
    {
        label: "Cheats",
        href: "/cheats",
    },
    {
        label: "Changelog",
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

export function Footer() {
    return (
        <footer className="border-t border-white/10 bg-background">
            <div className="site-container">
                <div className="grid grid-cols-2 gap-x-6 gap-y-10 py-12 sm:gap-x-12 sm:py-14 lg:grid-cols-12 lg:items-start lg:py-16">
                    <div className="col-span-2 lg:col-span-6">
                        <Link
                            href="/"
                            aria-label="Bannerlord Coop home"
                            className="inline-flex max-w-full items-center gap-3 text-foreground transition-colors duration-300 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                        >
                            <span className="flex size-10 items-center justify-center border border-gold/35 text-gold">
                                <Swords
                                    aria-hidden="true"
                                    className="size-5"
                                    strokeWidth={1.5}
                                />
                            </span>

                            <span className="font-display text-xl font-semibold uppercase tracking-[0.04em] sm:text-2xl">
                                Bannerlord Coop
                            </span>
                        </Link>

                        <p className="mt-5 max-w-md font-sans text-sm leading-6 text-foreground-muted">
                            Play the Mount &amp; Blade II: Bannerlord campaign with
                            friends in a shared multiplayer world.
                        </p>
                    </div>

                    <nav
                        className="lg:col-span-3"
                        aria-label="Footer navigation"
                    >
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                            Explore
                        </p>

                        <ul className="mt-5 space-y-3">
                            {navigationLinks.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="font-sans text-sm text-foreground-muted transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    <nav
                        className="lg:col-span-3"
                        aria-label="Community links"
                    >
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                            Community
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
                        © {new Date().getFullYear()} Bannerlord Coop. All rights
                        reserved.
                    </p>

                    <p className="max-w-xl font-sans text-xs leading-5 text-foreground-dim sm:text-right">
                        An independent community project. Not affiliated with or
                        endorsed by TaleWorlds Entertainment.
                    </p>
                </div>
            </div>
        </footer>
    );
}

