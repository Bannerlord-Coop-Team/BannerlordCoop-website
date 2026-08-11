import { Swords } from "lucide-react";
import Link from "next/link";

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
            <div className="site-container flex h-15 items-center justify-between">
                <Link
                    href="/"
                    className="flex items-center gap-3"
                    aria-label="Bannerlord Coop home"
                >
                    <Swords
                        aria-hidden="true"
                        className="size-6 text-gold"
                        strokeWidth={3}
                    />

                    <span className="font-display text-lg font-black uppercase tracking-[0.14em] text-foreground transition-colors duration-300 hover:text-gold">
                        Bannerlord Coop
                    </span>
                </Link>

                <nav aria-label="Primary navigation">
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
                                className="rounded-sm border border-crimson bg-crimson px-5 py-2.5 font-sans text-xs uppercase tracking-[0.16em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                Download
                            </a>
                        </li>
                    </ul>
                </nav>
            </div>
        </header>
    );
}