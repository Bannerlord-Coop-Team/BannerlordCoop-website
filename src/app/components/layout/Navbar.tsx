import { ProfileDropdown } from "@/app/components/layout/ProfileDropdown";
import { MobileNavigation } from "@/app/components/layout/MobileNavigation";
import { CommunityDropdown } from "@/app/components/layout/CommunityDropdown";
import { accountDisplayName } from "@/app/lib/auth/account-display";
import { hasAdminAccess } from "@/app/lib/auth/access";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { Server, Swords, TerminalSquare } from "lucide-react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import {DownloadModal} from "@/app/components/home/modulesection/DownloadModal.tsx";

import { getTranslations } from "@/app/lib/localization/server";
import { LocaleSelector } from "./LocaleSelector";

const navigationLinkClassName = "inline-flex min-h-10 items-center px-2 font-label text-sm font-semibold uppercase leading-none tracking-[0.16em] text-foreground-muted transition-colors duration-300 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Renders localized navigation with unchanged viewer names; shared verified viewers are never retained across renders. */
export async function Navbar({ viewer }: { viewer?: Promise<{ user: User | null }> } = {}) {
    const { t } = await getTranslations("common");
    let isAuthenticated = false;
    let isAdmin = false;
    let accountName = t("account.defaultName");

    try {
        const { user } = viewer
            ? await viewer
            : (await (await getSupabaseServerClient()).auth.getUser()).data;
        isAuthenticated = user !== null;
        if (user) accountName = accountDisplayName(user, t("account.defaultName"));
        isAdmin = user ? hasAdminAccess(user) : false;
    } catch {}

    return (
            <header className="relative z-50 border-b border-white/10 bg-background">
                <div className="site-container relative flex h-16 items-center justify-between gap-4">
                    <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label={t("nav.homeLabel")}>
                        <Swords aria-hidden="true" className="size-6 text-gold" strokeWidth={3}/>
                        <span className="font-display text-sm font-black uppercase tracking-[0.06em] text-foreground transition-colors duration-300 hover:text-gold min-[380px]:text-base min-[380px]:tracking-[0.08em] sm:text-lg sm:tracking-[0.14em]">
                        Bannerlord Coop
                    </span>
                    </Link>

                    <nav aria-label={t("nav.primary")} className="hidden xl:block">
                        <ul className="flex min-h-10 items-center gap-3 xl:gap-5">
                            <li className="flex items-center">
                                <Link href="/" className={navigationLinkClassName}>
                                    {t("nav.home")}
                                </Link>
                            </li>
                            <li className="flex items-center">
                                <Link href="/servers" prefetch={false} className={`${navigationLinkClassName} gap-2`}>
                                    <Server aria-hidden="true" className="size-4 shrink-0" />
                                    {t("nav.servers")}
                                </Link>
                            </li>
                            <li className="flex items-center">
                                <Link href="/cheats" className={`${navigationLinkClassName} gap-2`}>
                                    <TerminalSquare aria-hidden="true" className="size-4 shrink-0" />
                                    {t("nav.cheats")}
                                </Link>
                            </li>
                            <li className="relative flex items-center">
                                <CommunityDropdown />
                            </li>
                        </ul>
                    </nav>

                    <div className="hidden shrink-0 items-center gap-3 xl:flex">
                        <LocaleSelector variant="desktop" />
                        <DownloadModal trigger="navbar" />
                        <span aria-hidden="true" className="h-9 w-0.5 shrink-0 bg-foreground-muted/20" />
                        {isAuthenticated ? (
                            <ProfileDropdown accountName={accountName} isAdmin={isAdmin} />
                        ) : (
                            <Link href="/login" className="inline-flex min-h-10 items-center rounded-sm bg-background/70 px-2.5 font-label text-sm font-semibold uppercase leading-none tracking-[0.16em] text-foreground transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                                {t("nav.signIn")}
                            </Link>
                        )}
                    </div>

                    <MobileNavigation accountName={accountName} isAdmin={isAdmin} isAuthenticated={isAuthenticated}/>
                </div>
            </header>
    );
}
