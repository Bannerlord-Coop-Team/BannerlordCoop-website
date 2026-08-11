import { Swords } from "lucide-react";
import Link from "next/link";
import { MobileNavigation } from "@/app/components/layout/MobileNavigation";

const navigation = [
    {
        label: "Home",
        href: "/",
    },
    {
        label: "Wiki",
        href: "/wiki",
    },
    {
        label: "Changelog",
        href: "/changelog",
    },
    {
        label: "Support",
        href: "/support",
    },
] as const;

export function Navbar() {
    return (
        <header className="border-b border-white/10 bg-background">
            <div className="site-container flex h-15 items-center justify-between gap-4">
                <Link
                    href="/"
                    className="flex shrink-0 items-center gap-2 sm:gap-3"
                    aria-label="Bannerlord Coop home"
                >
                    <Swords
                        aria-hidden="true"
                        className="size-6 text-gold"
                        strokeWidth={3}
                    />

                    <span className="font-display text-sm font-black uppercase tracking-[0.06em] text-foreground transition-colors duration-300 hover:text-gold min-[380px]:text-base min-[380px]:tracking-[0.08em] sm:text-lg sm:tracking-[0.14em]">
                        Bannerlord Coop
                    </span>
                </Link>

                <nav aria-label="Primary navigation" className="hidden lg:block">
                    <ul className="flex items-center gap-8">
                        {navigation.map((item) => (
                            <li key={item.href}>
                                <Link
                                    href={item.href}
                                    className="font-sans text-xs uppercase tracking-[0.2em] text-foreground-muted transition-colors duration-300 hover:text-gold focus-visible:outline-none"
                                >
                                    {item.label}
                                </Link>
                            </li>
                        ))}

                        <li>
                            <a
                                href="https://discord.gg/bannerlordcoop"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-sans text-xs uppercase tracking-[0.2em] text-foreground-muted transition-colors hover:text-gold focus-visible:outline-none"
                            >
                                Discord
                            </a>
                        </li>

                        <li>
                            <a
                                href="#download"
                                className="inline-flex min-h-10 items-center rounded-sm border border-crimson bg-crimson px-3 py-2 font-sans text-xs uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-5 sm:py-2.5 sm:tracking-[0.16em]"
                            >
                                Download
                            </a>
                        </li>
                    </ul>
                </nav>
                <MobileNavigation />
            </div>
        </header>
    );
}