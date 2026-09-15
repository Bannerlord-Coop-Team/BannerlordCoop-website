import { ProfileDropdown } from "@/app/components/layout/ProfileDropdown";
import { MobileNavigation } from "@/app/components/layout/MobileNavigation";
import { accountDisplayName } from "@/app/lib/auth/account-display";
import { hasAdminAccess } from "@/app/lib/auth/access";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { Swords } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import {DownloadModal} from "@/app/components/home/modulesection/DownloadModal.tsx";
import { DesktopSideNavigation } from "@/app/components/layout/DesktopSideNavigation";


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
        <>
            <header className="border-b border-white/10 bg-background">
                <div className="site-container flex h-15 items-center justify-between gap-4">
                    <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label="Bannerlord Coop home">
                        <Swords aria-hidden="true" className="size-6 text-gold" strokeWidth={3}/>
                        <span className="font-display text-sm font-black uppercase tracking-[0.06em] text-foreground transition-colors duration-300 hover:text-gold min-[380px]:text-base min-[380px]:tracking-[0.08em] sm:text-lg sm:tracking-[0.14em]">
                        Bannerlord Coop
                    </span>
                    </Link>

                    <nav aria-label="Primary navigation" className="hidden lg:block">
                        <ul className="flex items-center gap-5 xl:gap-8">
                            <li>
                                <Link href="/" className="font-sans text-xs uppercase font-semibold tracking-[0.2em] text-foreground-muted transition-colors duration-300 hover:text-gold focus-visible:outline-none">
                                    Home
                                </Link>
                            </li>

                            <li>
                                <a
                                    href="https://discord.gg/bannerlordcoop"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label="Join the Bannerlord Coop Discord server"
                                    title="Join our Discord"
                                    className="group inline-flex size-10 items-center justify-center rounded-full transition-colors duration-300 hover:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                >
                                    <span
                                        aria-hidden="true"
                                        className="block size-7 bg-foreground-muted transition-[background-color,transform] duration-300 group-hover:scale-105 group-hover:bg-gold"
                                        style={{
                                            WebkitMaskImage: "url('/images/discordlogo.svg')",
                                            maskImage: "url('/images/discordlogo.svg')",
                                            WebkitMaskRepeat: "no-repeat",
                                            maskRepeat: "no-repeat",
                                            WebkitMaskPosition: "center",
                                            maskPosition: "center",
                                            WebkitMaskSize: "contain",
                                            maskSize: "contain",
                                        }}
                                    />
                                </a>
                            </li>

                            <li className="flex items-center gap-3">
                                <DownloadModal trigger="navbar" />

                                {isAuthenticated ? (<ProfileDropdown accountName={accountName}/>) :
                                    (
                                    <Link href="/login" className="inline-flex min-h-10 items-center rounded-sm border border-white/20 bg-background/70 px-3 py-2 font-sans text-xs uppercase tracking-[0.12em] text-foreground transition-colors hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-background xl:px-5 xl:py-2.5 xl:tracking-[0.16em]">
                                        Sign in
                                    </Link>
                                )}
                            </li>
                        </ul>
                    </nav>

                    <MobileNavigation accountName={accountName} isAdmin={isAdmin} isAuthenticated={isAuthenticated}/>
                </div>
            </header>

            <DesktopSideNavigation isAdmin={isAdmin} />
        </>
    );
}
