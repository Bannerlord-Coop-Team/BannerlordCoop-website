import { ProfileDropdown } from "@/app/components/layout/ProfileDropdown";
import { MobileNavigation } from "@/app/components/layout/MobileNavigation";
import { CommunityDropdown } from "@/app/components/layout/CommunityDropdown";
import { accountDisplayName } from "@/app/lib/auth/account-display";
import { hasAdminAccess } from "@/app/lib/auth/access";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { Server, Swords, TerminalSquare } from "lucide-react";
import Link from "next/link";
import {DownloadModal} from "@/app/components/home/modulesection/DownloadModal.tsx";

const navigationLinkClassName = "inline-flex min-h-10 items-center px-2 font-label text-sm font-semibold uppercase leading-none tracking-[0.16em] text-foreground-muted transition-colors duration-300 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export async function Navbar() {
    let isAuthenticated = false;
    let isAdmin = false;
    let accountName = "Your account";

    try {
        const supabase = await getSupabaseServerClient();
        const { data } = await supabase.auth.getUser();
        isAuthenticated = data.user !== null;
        if (data.user) accountName = accountDisplayName(data.user);
        isAdmin = data.user ? hasAdminAccess(data.user) : false;
    } catch {}

    return (
            <header className="relative z-50 border-b border-white/10 bg-background">
                <div className="site-container relative flex h-16 items-center justify-between gap-4">
                    <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label="Bannerlord Coop home">
                        <Swords aria-hidden="true" className="size-6 text-gold" strokeWidth={3}/>
                        <span className="font-display text-sm font-black uppercase tracking-[0.06em] text-foreground transition-colors duration-300 hover:text-gold min-[380px]:text-base min-[380px]:tracking-[0.08em] sm:text-lg sm:tracking-[0.14em]">
                        Bannerlord Coop
                    </span>
                    </Link>

                    <nav aria-label="Primary navigation" className="absolute left-1/2 hidden -translate-x-1/2 xl:block">
                        <ul className="flex min-h-10 items-center gap-3 xl:gap-5">
                            <li className="flex items-center">
                                <Link href="/" className={navigationLinkClassName}>
                                    Home
                                </Link>
                            </li>
                            <li className="flex items-center">
                                <Link href="/servers" prefetch={false} className={`${navigationLinkClassName} gap-2`}>
                                    <Server aria-hidden="true" className="size-4 shrink-0" />
                                    Servers
                                </Link>
                            </li>
                            <li className="flex items-center">
                                <Link href="/cheats" className={`${navigationLinkClassName} gap-2`}>
                                    <TerminalSquare aria-hidden="true" className="size-4 shrink-0" />
                                    Cheats
                                </Link>
                            </li>
                            <li className="relative flex items-center">
                                <CommunityDropdown />
                            </li>
                        </ul>
                    </nav>

                    <div className="hidden shrink-0 items-center gap-3 xl:flex">
                        <DownloadModal trigger="navbar" />
                        <span aria-hidden="true" className="h-9 w-0.5 shrink-0 bg-foreground-muted/20" />
                        {isAuthenticated ? (
                            <ProfileDropdown accountName={accountName} isAdmin={isAdmin} />
                        ) : (
                            <Link href="/login" className="inline-flex min-h-10 items-center rounded-sm bg-background/70 px-2.5 font-label text-sm font-semibold uppercase leading-none tracking-[0.16em] text-foreground transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                                Sign in
                            </Link>
                        )}
                    </div>

                    <MobileNavigation accountName={accountName} isAdmin={isAdmin} isAuthenticated={isAuthenticated}/>
                </div>
            </header>
    );
}
