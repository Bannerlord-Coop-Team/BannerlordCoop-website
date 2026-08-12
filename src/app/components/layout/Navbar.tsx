import { signOut } from "@/app/auth/actions";
import { MobileNavigation } from "@/app/components/layout/MobileNavigation";
import { getMemberRole, hasAdminAccess } from "@/app/lib/auth/access";
import { hasServerDashboardAccess } from "@/app/lib/auth/roles";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
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

export async function Navbar() {
    let isAuthenticated = false;
    let isAdmin = false;
    let hasServerAccess = false;

    try {
        const supabase = await getSupabaseServerClient();
        const { data } = await supabase.auth.getUser();
        isAuthenticated = data.user !== null;
        isAdmin = data.user ? hasAdminAccess(data.user) : false;
        hasServerAccess = data.user
            ? hasServerDashboardAccess(getMemberRole(data.user))
            : false;
    } catch {
        // Keep public navigation usable when authentication is not configured.
    }

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
                    <ul className="flex items-center gap-5 xl:gap-8">
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

                        {hasServerAccess && (
                            <li>
                                <Link
                                    href="/servers"
                                    className="font-sans text-xs uppercase tracking-[0.2em] text-gold transition-colors duration-300 hover:text-foreground focus-visible:outline-none"
                                >
                                    Servers
                                </Link>
                            </li>
                        )}

                        {isAdmin && (
                            <li>
                                <Link
                                    href="/admin"
                                    className="font-sans text-xs uppercase tracking-[0.2em] text-gold transition-colors duration-300 hover:text-foreground focus-visible:outline-none"
                                >
                                    Admin
                                </Link>
                            </li>
                        )}

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

                        <li className="flex items-center gap-3">
                            <a
                                href="#download"
                                className="inline-flex min-h-10 items-center rounded-sm border border-crimson bg-crimson px-3 py-2 font-sans text-xs uppercase tracking-[0.12em] text-white transition-colors hover:border-crimson-hover hover:bg-crimson-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background xl:px-5 xl:py-2.5 xl:tracking-[0.16em]"
                            >
                                Download
                            </a>

                            {isAuthenticated ? (
                                <form action={signOut}>
                                    <button
                                        type="submit"
                                        className="inline-flex min-h-10 items-center rounded-sm border border-crimson bg-transparent px-3 py-2 font-sans text-xs uppercase tracking-[0.12em] text-foreground transition-colors hover:border-crimson-hover hover:bg-crimson/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background xl:px-5 xl:py-2.5 xl:tracking-[0.16em]"
                                    >
                                        Log out
                                    </button>
                                </form>
                            ) : (
                                <Link
                                    href="/login"
                                    className="inline-flex min-h-10 items-center rounded-sm border border-crimson bg-transparent px-3 py-2 font-sans text-xs uppercase tracking-[0.12em] text-foreground transition-colors hover:border-crimson-hover hover:bg-crimson/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background xl:px-5 xl:py-2.5 xl:tracking-[0.16em]"
                                >
                                    Sign in
                                </Link>
                            )}
                        </li>
                    </ul>
                </nav>
                <MobileNavigation
                    hasServerAccess={hasServerAccess}
                    isAdmin={isAdmin}
                    isAuthenticated={isAuthenticated}
                />
            </div>
        </header>
    );
}