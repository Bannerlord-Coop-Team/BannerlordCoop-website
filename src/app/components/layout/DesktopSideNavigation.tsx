"use client";

import {CircleHelp, History, Server, ShieldCheck, TerminalSquare, type LucideIcon,} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavigationItem = {
    label: string;
    href: string;
    icon: LucideIcon;
    prefetch?: boolean;
};

const navigation: readonly NavigationItem[] = [
    {
        label: "Servers",
        href: "/servers",
        icon: Server,
        prefetch: false,
    },
    {
        label: "Cheats",
        href: "/cheats",
        icon: TerminalSquare,
    },
    {
        label: "Changelog",
        href: "/changelog",
        icon: History,
    },
    {
        label: "Support",
        href: "/support",
        icon: CircleHelp,
    },
];

function isActiveRoute(pathname: string, href: string) { return pathname === href || pathname.startsWith(`${href}/`);}

export function DesktopSideNavigation({isAdmin,}: { isAdmin: boolean; }) {
    const pathname = usePathname();

    return (
        <aside aria-label="Site navigation" className="group fixed left-4 top-1/2 z-40 hidden w-16 -translate-y-1/2 overflow-hidden rounded-2xl border-2 border-crimson/30 bg-surface-raised/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-md transition-[width,box-shadow,border-color] duration-300 ease-out hover:w-48 hover:border-gold/30 hover:shadow-black/60 lg:block">
            <nav aria-label="Side navigation">
                <ul className="space-y-1">
                    {navigation.map((item) => {
                        const Icon = item.icon;
                        const isActive = isActiveRoute(pathname, item.href,);

                        return (
                            <li key={item.href}>
                                <Link href={item.href} prefetch={item.prefetch}
                                      aria-current={ isActive ? "page" : undefined }
                                      className={`group/link flex h-11 w-full items-center gap-3 rounded-lg px-3 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson ${isActive
                                          ? "bg-crimson/10 text-crimson group-hover:bg-gold/15 group-hover:text-gold"
                                          : "text-foreground-muted hover:bg-white/6 hover:text-gold focus-visible:bg-white/6"}`
                                }>

                                    <Icon aria-hidden="true" className={`size-5 shrink-0 transition-[color,filter,transform] duration-200 ${isActive
                                        ? "scale-110 text-crimson drop-shadow-[0_0_7px_rgba(143,29,35,0.95)] group-hover:text-gold group-hover:drop-shadow-[0_0_7px_rgba(170,151,96,0.95)]"
                                        : "group-hover/link:text-gold"}`} strokeWidth={isActive ? 2.25 : 1.75}/>

                                    <span className={`min-w-0 translate-x-1 whitespace-nowrap font-label text-xs font-semibold uppercase tracking-[0.14em] opacity-0 transition-[color,opacity,transform] delay-0 duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-hover:delay-75 ${isActive ? "text-crimson group-hover:text-gold" : ""}`}>
                                        {item.label}
                                    </span>
                                </Link>
                            </li>
                        );
                    })}

                    {isAdmin && (
                        <>
                            <li aria-hidden="true" className="mx-2 my-2 border-t border-white/10"/>
                            <li>
                                {(() => {
                                    const isActive = isActiveRoute(pathname, "/admin",);
                                    return (
                                        <Link href="/admin" aria-current={ isActive ? "page" : undefined } className={`group/link flex h-11 w-full items-center gap-3 rounded-lg px-3 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson ${isActive ? "bg-crimson/10 text-crimson group-hover:bg-gold/15 group-hover:text-gold" : "text-gold hover:bg-white/6"}`}>
                                            <ShieldCheck
                                                aria-hidden="true"
                                                className={`size-5 shrink-0 transition-[color,filter,transform] duration-200 ${ isActive ? "scale-110 text-crimson drop-shadow-[0_0_7px_rgba(143,29,35,0.95)] group-hover:text-gold group-hover:drop-shadow-[0_0_7px_rgba(170,151,96,0.95)]" : "text-gold"}`}
                                                strokeWidth={isActive ? 2.25 : 1.75
                                                }
                                            />

                                            <span className={`min-w-0 translate-x-1 whitespace-nowrap font-label text-xs font-semibold uppercase tracking-[0.14em] opacity-0 transition-[color,opacity,transform] delay-0 duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-hover:delay-75 ${
                                                    isActive ? "text-crimson group-hover:text-gold" : "text-gold"}`}>
                                                Admin
                                            </span>
                                        </Link>
                                    );
                                })()}
                            </li>
                        </>
                    )}
                </ul>
            </nav>
        </aside>
    );
}